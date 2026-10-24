import { getSession } from "./google-auth.js";
import { paymentMode, hasPurchase } from "./purchase-access.js";
import { pilotAccess } from "./pilot-access.js";
import { boundedText } from "./request-body.js";
import { reserveGoogleRequest } from "./google-limits.js";
export { pilotAccess } from "./pilot-access.js";
const DAY = 86400000;
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const fail = (status, error) => Object.assign(new Error(error), { status });
const text = (v, max, required = false) => {
  if (typeof v !== "string" || v.trim().length > max || (required && !v.trim()))
    throw fail(400, "Check the form fields.");
  return v.trim();
};
const select = (env, q, ...v) =>
  env.GOOGLE_SESSIONS.prepare(q)
    .bind(...v)
    .first();
const run = (env, q, ...v) =>
  env.GOOGLE_SESSIONS.prepare(q)
    .bind(...v)
    .run();
// D1 changes includes audit-trigger writes. RETURNING identifies the actual row.
const change = (env, q, ...v) =>
  select(env, q + " RETURNING google_subject", ...v);
const open = (p, now) =>
  [p.application_start, p.application_end, p.closes_at].every(
    (v) => Number.isSafeInteger(v) && v > 0,
  ) &&
  p.application_start < p.application_end &&
  p.application_end < p.closes_at &&
  p.admissions_open === 1 &&
  p.application_start <= now &&
  now < p.application_end &&
  now + p.duration_days * DAY < p.closes_at;
const publicPolicy = (p, now) => ({
  enabled: true,
  interestOpen: p.interest_open === 1,
  applicationsOpen: open(p, now),
  durationDays: p.duration_days,
  closesAt: p.closes_at,
  terms: "free-pilot-v1",
  meteredSpendUSD: 0,
});
const state = (r, now) =>
  r?.state === "active" && r.ends_at <= now
    ? "expired"
    : ["approved", "invited"].includes(r?.state) && r.invite_until <= now
      ? "invitation_expired"
      : r?.state || "none";
export async function handleFreePilot({ request, env, params }) {
  const route = Array.isArray(params.path)
    ? params.path.join("/")
    : params.path || "";
  if (env.ENABLE_FREE_PILOT !== "true")
    return reply(
      { enabled: false },
      ["config", "status"].includes(route) && request.method === "GET"
        ? 200
        : 404,
    );
  try {
    const method = ["config", "status", "admin/list"].includes(route)
      ? "GET"
      : [
            "apply",
            "activate",
            "feedback",
            "admin/approve",
            "admin/invite",
            "admin/revoke",
            "admin/extend",
          ].includes(route)
        ? "POST"
        : null;
    if (!method) return reply({ error: "Not found." }, 404);
    if (request.method !== method)
      return reply({ error: "Method not allowed." }, 405);
    const mode = paymentMode(env),
      now = Date.now();
    if (!["test", "live"].includes(mode))
      throw fail(503, "Pilot configuration is unavailable.");
    if (
      new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
      request.headers.get("Sec-Fetch-Site") === "cross-site" ||
      (method === "POST" &&
        request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
    )
      throw fail(403, "Open StreamLion to continue.");
    const p = await select(
      env,
      "SELECT p.* FROM streamlion_free_pilot_policy_v1 p JOIN streamlion_free_pilot_schema_v1 s ON s.version=1 WHERE p.mode=?",
      mode,
    );
    if (!p) throw fail(503, "Pilot configuration is unavailable.");
    const policy = publicPolicy(p, now);
    if (policy.applicationsOpen) {
      const counts = await select(
        env,
        "SELECT SUM(CASE WHEN admitted_at IS NOT NULL THEN 1 ELSE 0 END) AS admitted,SUM(CASE WHEN (state='active' AND ends_at>?) OR (state IN ('approved','invited') AND invite_until>?) THEN 1 ELSE 0 END) AS occupied FROM streamlion_free_pilot_accounts_v1 WHERE mode=?",
        now,
        now,
        mode,
      );
      policy.applicationsOpen =
        Number(counts.admitted || 0) < p.admission_cap &&
        Number(counts.occupied || 0) < p.active_cap;
    }
    if (route === "config") return reply(policy);
    const session = await getSession(request, env);
    if (!session)
      return route === "status"
        ? reply({ ...policy, connected: false })
        : reply({ error: "Sign in with your verified Google account." }, 401);
    const subject = session.google_subject;
    if (
      method === "POST" &&
      request.headers.get("X-StreamLion-Account") !== subject
    )
      throw fail(403, "Your account changed. Reload before continuing.");
    const admin = Boolean(
      await select(
        env,
        "SELECT 1 AS ok FROM streamlion_free_pilot_admins_v1 WHERE mode=? AND google_subject=?",
        mode,
        subject,
      ),
    );
    if (route.startsWith("admin/") && !admin)
      throw fail(403, "Administrator access required.");
    const own = () =>
      select(
        env,
        "SELECT * FROM streamlion_free_pilot_accounts_v1 WHERE mode=? AND google_subject=?",
        mode,
        subject,
      );
    if (route === "status") {
      const r = await own(),
        access = await pilotAccess(env, subject, now);
      return reply({
        ...policy,
        connected: true,
        account: session.email,
        subject,
        admin,
        state: state(r, now),
        active: Boolean(access),
        startsAt: r?.starts_at || null,
        endsAt: r?.ends_at || null,
        inviteUntil: r?.invite_until || null,
        invitedDurationDays: r?.duration_days || null,
        feedback: r
          ? {
              onboarding: !!r.onboarding,
              workflow: !!r.workflow,
              feedback: r.feedback,
              support: r.support,
              willingness: r.willingness,
            }
          : null,
      });
    }
    if (route === "admin/list") {
      const counts = await select(
        env,
        "SELECT COUNT(*) AS applications,SUM(CASE WHEN admitted_at IS NOT NULL THEN 1 ELSE 0 END) AS admissions,SUM(CASE WHEN state='active' AND starts_at<=? AND ends_at>? THEN 1 ELSE 0 END) AS active,SUM(CASE WHEN state IN ('approved','invited') AND invite_until>? THEN 1 ELSE 0 END) AS reserved,SUM(onboarding) AS onboarded,SUM(workflow) AS workflows FROM streamlion_free_pilot_accounts_v1 WHERE mode=?",
        now,
        now,
        now,
        mode,
      );
      const offset = Number(
        new URL(request.url).searchParams.get("offset") || 0,
      );
      if (!Number.isSafeInteger(offset) || offset < 0)
        throw fail(400, "Invalid page.");
      const rows = await env.GOOGLE_SESSIONS.prepare(
        "SELECT * FROM streamlion_free_pilot_accounts_v1 WHERE mode=? ORDER BY applied_at,google_subject LIMIT 50 OFFSET ?",
      )
        .bind(mode, offset)
        .all();
      return reply({
        policy: p,
        counts,
        accounts: rows.results.map((r) => ({ ...r, state: state(r, now) })),
        nextOffset: rows.results.length === 50 ? offset + 50 : null,
        meteredSpendUSD: 0,
        costBasis:
          "Pilot grants no metered processing; infrastructure usage is separate.",
      });
    }
    if (
      !(request.headers.get("Content-Type") || "").startsWith(
        "application/json",
      )
    )
      throw fail(415, "Use JSON.");
    let b;
    try {
      b = JSON.parse(await boundedText(request, 4096));
    } catch (e) {
      throw fail(e.status === 413 ? 413 : 400, "Invalid or oversized form.");
    }
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw fail(400, "Invalid form.");
    const capacity = await reserveGoogleRequest(
      env.GOOGLE_SESSIONS,
      subject,
      "POST",
    );
    if (!capacity.allowed)
      throw fail(429, "Too many requests. Wait a minute and retry.");
    if (route === "apply") {
      if (p.interest_open !== 1)
        throw fail(409, "Interest registration is closed.");
      if (b.contact !== true || typeof b.marketing !== "boolean")
        throw fail(
          400,
          "Pilot contact permission is required; marketing is optional.",
        );
      const name = text(b.name, 100, true),
        business = text(b.business, 100),
        fit = text(b.fit, 500, true);
      // Identity is server-derived. A retry never rewrites an admitted account.
      await run(
        env,
        "INSERT INTO streamlion_free_pilot_accounts_v1(mode,google_subject,email,name,business,fit,contact,marketing,applied_at,updated_at,actor,action,reason) VALUES(?,?,?,?,?,?,1,?,?,?,?, 'apply','Pilot contact consent; free-pilot-v1') ON CONFLICT(mode,google_subject) DO NOTHING",
        mode,
        subject,
        session.email,
        name,
        business,
        fit,
        b.marketing ? 1 : 0,
        now,
        now,
        subject,
      );
      return reply({ registered: true, accessGranted: false });
    }
    if (route === "activate") {
      if (b.ready !== true || b.terms !== "free-pilot-v1")
        throw fail(
          400,
          "Confirm readiness and the pilot terms before activation.",
        );
      if (await hasPurchase(env, subject))
        throw fail(
          409,
          "Your paid access is already available. No pilot grant is needed.",
        );
      await run(
        env,
        "UPDATE streamlion_free_pilot_accounts_v1 SET state='active',starts_at=?,ends_at=?+duration_days*86400000,original_end=?+duration_days*86400000,terms='free-pilot-v1',updated_at=?,actor=?,action='activate',reason='Participant confirmed readiness and terms' WHERE mode=? AND google_subject=? AND state='invited' AND starts_at IS NULL AND invite_until>? AND EXISTS(SELECT 1 FROM streamlion_free_pilot_policy_v1 p WHERE p.mode=? AND p.admissions_open=1 AND p.application_start<=? AND p.application_end>? AND p.closes_at>=?+duration_days*86400000 AND (SELECT COUNT(*) FROM streamlion_free_pilot_accounts_v1 a WHERE a.mode=p.mode AND a.state='active' AND a.ends_at>?)<p.active_cap)",
        now,
        now,
        now,
        now,
        subject,
        mode,
        subject,
        now,
        mode,
        now,
        now,
        now,
        now,
      );
      const access = await pilotAccess(env, subject);
      if (!access)
        throw fail(
          409,
          "Invitation unavailable, capacity full or pilot closed. Ask the owner to review.",
        );
      return reply({ active: true, ...access });
    }
    if (route === "feedback") {
      const r = await own();
      if (!r?.starts_at)
        throw fail(
          409,
          "Feedback is available after activation, including after expiry.",
        );
      if (
        typeof b.onboarding !== "boolean" ||
        typeof b.workflow !== "boolean" ||
        !["unanswered", "yes", "maybe", "no"].includes(b.willingness)
      )
        throw fail(400, "Check feedback choices.");
      await run(
        env,
        "UPDATE streamlion_free_pilot_accounts_v1 SET onboarding=MAX(onboarding,?),workflow=MAX(workflow,?),feedback=?,support=?,willingness=?,updated_at=? WHERE mode=? AND google_subject=?",
        +b.onboarding,
        +b.workflow,
        text(b.feedback, 1000),
        text(b.support, 1000),
        b.willingness,
        now,
        mode,
        subject,
      );
      return reply({ saved: true });
    }
    const target = text(b.subject, 255, true),
      reason = text(b.reason, 500, true);
    let result;
    if (route === "admin/approve") {
      // A single conditional write reserves a place AND consumes cumulative admission.
      // The database serializes competing writes; no JS read-then-increment counter.
      result = await change(
        env,
        "UPDATE streamlion_free_pilot_accounts_v1 SET state='approved',admitted_at=?,invite_until=MIN(?+172800000,(SELECT MIN(application_end,closes_at-duration_days*86400000) FROM streamlion_free_pilot_policy_v1 WHERE mode=?)),duration_days=(SELECT duration_days FROM streamlion_free_pilot_policy_v1 WHERE mode=?),updated_at=?,actor=?,action='approve',reason=? WHERE mode=? AND google_subject=? AND state='applied' AND admitted_at IS NULL AND EXISTS(SELECT 1 FROM streamlion_free_pilot_policy_v1 p WHERE p.mode=? AND p.admissions_open=1 AND p.application_start<=? AND p.application_end>? AND p.closes_at>?+p.duration_days*86400000 AND (SELECT COUNT(*) FROM streamlion_free_pilot_accounts_v1 a WHERE a.mode=p.mode AND a.admitted_at IS NOT NULL)<p.admission_cap AND (SELECT COUNT(*) FROM streamlion_free_pilot_accounts_v1 a WHERE a.mode=p.mode AND ((a.state='active' AND a.ends_at>?) OR (a.state IN ('approved','invited') AND a.invite_until>?)))<p.active_cap)",
        now,
        now,
        mode,
        mode,
        now,
        subject,
        reason,
        mode,
        target,
        mode,
        now,
        now,
        now,
        now,
        now,
      );
    } else if (route === "admin/invite") {
      result = await change(
        env,
        "UPDATE streamlion_free_pilot_accounts_v1 SET state='invited',updated_at=?,actor=?,action='invite',reason=? WHERE mode=? AND google_subject=? AND state='approved' AND invite_until>? AND EXISTS(SELECT 1 FROM streamlion_free_pilot_policy_v1 WHERE mode=? AND admissions_open=1 AND application_end>?)",
        now,
        subject,
        reason,
        mode,
        target,
        now,
        mode,
        now,
      );
    } else if (route === "admin/revoke") {
      result = await change(
        env,
        "UPDATE streamlion_free_pilot_accounts_v1 SET state='revoked',updated_at=?,actor=?,action='revoke',reason=? WHERE mode=? AND google_subject=? AND state!='revoked'",
        now,
        subject,
        reason,
        mode,
        target,
      );
    } else if (route === "admin/extend") {
      if (!Number.isSafeInteger(b.endsAt) || b.endsAt <= now)
        throw fail(400, "Choose a future expiry.");
      const r = await select(
        env,
        "SELECT * FROM streamlion_free_pilot_accounts_v1 WHERE mode=? AND google_subject=?",
        mode,
        target,
      );
      if (r && b.endsAt > r.original_end + 7 * DAY)
        throw fail(400, "Extensions are limited to seven extra days in total.");
      result = await change(
        env,
        "UPDATE streamlion_free_pilot_accounts_v1 SET ends_at=?,updated_at=?,actor=?,action='extend',reason=? WHERE mode=? AND google_subject=? AND state='active' AND ends_at=original_end AND ends_at>? AND ends_at<? AND ?<=original_end+604800000 AND EXISTS(SELECT 1 FROM streamlion_free_pilot_policy_v1 WHERE mode=? AND closes_at>=?)",
        b.endsAt,
        now,
        subject,
        reason,
        mode,
        target,
        now,
        b.endsAt,
        b.endsAt,
        mode,
        b.endsAt,
      );
    }
    if (result?.google_subject !== target)
      throw fail(
        409,
        "No change: state, dates or admission limits prevented this action.",
      );
    return reply({ updated: true });
  } catch (e) {
    return reply(
      {
        error: e.status
          ? e.message
          : "Pilot is unavailable. No access was granted. Please retry later.",
      },
      e.status || 503,
    );
  }
}
