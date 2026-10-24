import { getSession, hash } from "./google-auth.js";
import { boundedText } from "./request-body.js";
import {
  adminInstalled,
  OWNER_EMAIL,
  CREDIT_UNIT,
  localDate,
  listUsers,
  userDetails,
  overview,
  creditActivity,
} from "./admin-data.js";
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, private, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
const reply = (v, status = 200) => Response.json(v, { status, headers });
const fail = (status, message) => Object.assign(Error(message), { status });
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function operation(b) {
  if (
    !b ||
    !uuid.test(b.operationId || "") ||
    !["grant", "reversal"].includes(b.type) ||
    typeof b.target !== "string" ||
    b.target.length < 1 ||
    b.target.length > 255 ||
    !Number.isFinite(b.credits) ||
    b.credits <= 0 ||
    b.credits > 800 ||
    (b.type === "grant" && !Number.isSafeInteger(b.credits)) ||
    Math.round(b.credits * CREDIT_UNIT) < 1 ||
    !Number.isSafeInteger(Math.round(b.credits * CREDIT_UNIT)) ||
    Math.abs(b.credits * CREDIT_UNIT - Math.round(b.credits * CREDIT_UNIT)) >
      1e-7 ||
    typeof b.reason !== "string" ||
    !b.reason.trim() ||
    b.reason.trim().length > 500
  )
    throw fail(400, "Check recipient, credits and reason.");
  return {
    operationId: b.operationId,
    type: b.type,
    target: b.target,
    credits: Math.round(b.credits * CREDIT_UNIT) / CREDIT_UNIT,
    reason: b.reason.trim(),
  };
}
const digest = (op, mode, actor) =>
  hash(
    JSON.stringify([
      1,
      mode,
      actor,
      op.operationId,
      op.type,
      op.target,
      op.credits,
      op.reason,
    ]),
  );
async function receipt(db, op, mode, actor, payload) {
  const table =
    op.type === "grant"
      ? "streamlion_admin_grants_v1"
      : "streamlion_admin_reversals_v1";
  const prior = await db
    .prepare(`SELECT payload_hash,actor FROM ${table} WHERE id=?`)
    .bind(op.operationId)
    .first();
  if (!prior) return null;
  if (prior.actor !== actor || prior.payload_hash !== payload)
    throw fail(
      409,
      "This operation ID already belongs to a different request.",
    );
  const a = await db
    .prepare(
      "SELECT id,mode,target,action,amount_micros,reason,created_at,reference,balance_before,balance_after FROM streamlion_admin_audit_v1 WHERE id=? AND mode=?",
    )
    .bind((op.type === "grant" ? "grant:" : "reverse:") + op.operationId, mode)
    .first();
  if (!a)
    throw fail(
      503,
      "The receipt could not be verified. Do not submit another operation.",
    );
  return {
    id: a.id,
    mode: a.mode,
    target: a.target,
    action: a.action,
    amountCredits: a.amount_micros / CREDIT_UNIT,
    reason: a.reason,
    createdAt: a.created_at,
    reference: a.reference,
    balanceBefore: a.balance_before / CREDIT_UNIT,
    balanceAfter: a.balance_after / CREDIT_UNIT,
  };
}
export async function handleAdmin(
  { request, env, params },
  { now = Date.now } = {},
) {
  const db = env.GOOGLE_SESSIONS?.withSession
      ? env.GOOGLE_SESSIONS.withSession("first-primary")
      : env.GOOGLE_SESSIONS,
    mode = env.STREAMLION_PAYMENTS_MODE;
  const path = Array.isArray(params?.path)
    ? params.path.join("/")
    : params?.path || "session";
  try {
    if (!["test", "live"].includes(mode) || !(await adminInstalled(db)))
      return reply({ error: "Admin portal is unavailable." }, 404);
    const method = ["authorize", "grants", "reversals", "close"].includes(path)
      ? "POST"
      : "GET";
    if (request.method !== method) throw fail(405, "Method not allowed.");
    if (
      new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
      request.headers.get("Sec-Fetch-Site") === "cross-site" ||
      (method === "POST" &&
        request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
    )
      throw fail(403, "Open StreamLion to continue.");
    const session = await getSession(request, { ...env, GOOGLE_SESSIONS: db });
    if (!session) throw fail(401, "Sign in with the owner Google account.");
    const owner = await db
      .prepare(
        "SELECT o.google_subject FROM streamlion_admin_owners_v1 o JOIN streamlion_admin_policy_v1 p ON p.mode=o.mode WHERE o.mode=? AND o.google_subject=? AND o.email=? AND o.enabled=1 AND p.enabled=1",
      )
      .bind(mode, session.google_subject, OWNER_EMAIL)
      .first();
    if (!owner || session.email !== OWNER_EMAIL)
      throw fail(403, "Owner access required.");
    if (
      method === "POST" &&
      request.headers.get("X-StreamLion-Account") !== session.google_subject
    )
      throw fail(403, "Account changed. Sign in again.");
    const time = now(),
      w = await db
        .prepare(
          "SELECT * FROM streamlion_admin_windows_v1 WHERE id=? AND google_subject=? AND mode=?",
        )
        .bind(session.session_hash, session.google_subject, mode)
        .first();
    const valid = Boolean(
        w && w.last_seen_at + 900000 > time && w.created_at + 3600000 > time,
      ),
      fresh = Boolean(
        valid && w.verified_at + 300000 > time && w.verified_at <= time + 30000,
      );
    if (path === "session")
      return reply({
        authorized: true,
        account: session.email,
        subject: session.google_subject,
        mode,
        locked: !valid,
        canAuthorize: fresh,
        idleExpiresInMs: valid ? w.last_seen_at + 900000 - time : 0,
        absoluteExpiresInMs: valid ? w.created_at + 3600000 - time : 0,
        reason: fresh
          ? null
          : "Complete an owner sign-in with verifiable recent authentication to change credits.",
      });
    if (!valid) throw fail(401, "Admin session expired. Sign in again.");
    if (path === "close") {
      await db
        .prepare(
          "DELETE FROM streamlion_admin_authorizations_v1 WHERE window_id=?",
        )
        .bind(w.id)
        .run();
      await db
        .prepare("DELETE FROM streamlion_admin_windows_v1 WHERE id=?")
        .bind(w.id)
        .run();
      return reply({ closed: true });
    }
    // A fixed per-window rate budget, bounded storage and no new runtime binding.
    const rate = await db
      .prepare(
        "SELECT COUNT(*) n FROM streamlion_admin_authorizations_v1 WHERE window_id=? AND expires_at>?",
      )
      .bind(w.id, time)
      .first();
    await db
      .prepare(
        "UPDATE streamlion_admin_windows_v1 SET last_seen_at=MAX(last_seen_at,?) WHERE id=?",
      )
      .bind(time, w.id)
      .run();
    const url = new URL(request.url);
    if (path.startsWith("operations/")) {
      const id = path.slice(11);
      if (!uuid.test(id)) throw fail(400, "Invalid operation.");
      const a = await db
        .prepare(
          "SELECT id,mode,target,action,amount_micros,reason,created_at,reference,balance_before,balance_after FROM streamlion_admin_audit_v1 WHERE mode=? AND id IN (?,?)",
        )
        .bind(mode, "grant:" + id, "reverse:" + id)
        .first();
      if (a)
        return reply({
          state: "complete",
          receipt: {
            id: a.id,
            mode: a.mode,
            target: a.target,
            action: a.action,
            amountCredits: a.amount_micros / CREDIT_UNIT,
            reason: a.reason,
            createdAt: a.created_at,
            reference: a.reference,
            balanceBefore: a.balance_before / CREDIT_UNIT,
            balanceAfter: a.balance_after / CREDIT_UNIT,
          },
        });
      const pending = await db
        .prepare(
          "SELECT MAX(expires_at) expires,MAX(used) used FROM streamlion_admin_authorizations_v1 WHERE mode=? AND actor=? AND operation_id=?",
        )
        .bind(mode, session.google_subject, id)
        .first();
      if (pending?.used)
        throw fail(
          503,
          "This operation needs receipt reconciliation before another credit change.",
        );
      return reply({
        state: pending?.expires > time ? "pending" : "not_committed",
      });
    }
    if (path === "activity")
      return reply(await creditActivity(db, mode, url.searchParams, time));
    if (path === "users")
      return reply(await listUsers(db, mode, url.searchParams, time));
    if (path === "overview") {
      const days = Number(url.searchParams.get("days") || 30);
      if (![7, 30, 90].includes(days))
        throw fail(400, "Choose 7, 30 or 90 days.");
      return reply(await overview(db, mode, time, days));
    }
    if (path.startsWith("users/")) {
      const target = decodeURIComponent(path.slice(6));
      if (target.length > 255 || target.includes("/"))
        throw fail(400, "Invalid account.");
      const detail = await userDetails(
        db,
        mode,
        target,
        time,
        [7, 30, 90].includes(Number(url.searchParams.get("days")))
          ? Number(url.searchParams.get("days"))
          : 30,
      );
      if (!detail) throw fail(404, "Account not found.");
      return reply(detail);
    }
    if (!["authorize", "grants", "reversals"].includes(path))
      throw fail(404, "Not found.");
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      throw fail(415, "Use JSON.");
    let input;
    try {
      input = JSON.parse(await boundedText(request, 4096));
    } catch {
      throw fail(400, "Invalid request.");
    }
    const op = operation(input),
      payload = await digest(op, mode, session.google_subject);
    if (path !== "authorize" && (path === "grants") !== (op.type === "grant"))
      throw fail(400, "Wrong credit action.");
    const prior = await receipt(db, op, mode, session.google_subject, payload);
    if (prior) return reply(prior);
    const policy = await db
      .prepare(
        "SELECT grants_enabled FROM streamlion_admin_policy_v1 WHERE mode=?",
      )
      .bind(mode)
      .first();
    if (!policy?.grants_enabled) throw fail(503, "Credit changes are paused.");
    if (path === "authorize") {
      if (rate.n >= 12)
        throw fail(429, "Please wait before preparing another credit change.");
      if (!fresh)
        throw fail(
          403,
          "Recent owner authentication could not be verified. Sign in again; credit changes remain locked.",
        );
      const id = crypto.randomUUID(),
        expires = Math.min(time + 60000, w.verified_at + 300000);
      await db
        .prepare(
          "INSERT INTO streamlion_admin_authorizations_v1 VALUES(?,?,?,?,?,?,0,?)",
        )
        .bind(
          id,
          mode,
          session.google_subject,
          w.id,
          payload,
          expires,
          op.operationId,
        )
        .run();
      await db
        .prepare(
          "DELETE FROM streamlion_admin_authorizations_v1 WHERE expires_at<?",
        )
        .bind(time - 86400000)
        .run();
      return reply({ authorization: id, expiresAt: expires });
    }
    if (!uuid.test(input.authorization || ""))
      throw fail(403, "Confirm this credit change first.");
    const a = await db
      .prepare(
        "SELECT id FROM streamlion_admin_authorizations_v1 WHERE id=? AND window_id=? AND payload_hash=? AND actor=? AND mode=? AND used=0 AND expires_at>?",
      )
      .bind(
        input.authorization,
        w.id,
        payload,
        session.google_subject,
        mode,
        time,
      )
      .first();
    if (!a)
      throw fail(
        403,
        "Confirmation expired or changed. Review the exact change again.",
      );
    try {
      if (op.type === "grant")
        await db
          .prepare(
            "INSERT INTO streamlion_admin_grants_v1 VALUES(?,?,?,?,?,?,?,?,?,?,1)",
          )
          .bind(
            op.operationId,
            mode,
            op.target,
            session.google_subject,
            Math.round(op.credits * CREDIT_UNIT),
            localDate(time).slice(0, 7),
            time,
            op.reason,
            input.authorization,
            payload,
          )
          .run();
      else {
        const g = await db
          .prepare(
            "SELECT id FROM streamlion_admin_grants_v1 WHERE id=? AND mode=?",
          )
          .bind(op.target, mode)
          .first();
        if (!g) throw fail(404, "Grant not found.");
        await db
          .prepare(
            "INSERT INTO streamlion_admin_reversals_v1 VALUES(?,?,?,?,?,?,?,?,1)",
          )
          .bind(
            op.operationId,
            g.id,
            session.google_subject,
            Math.round(op.credits * CREDIT_UNIT),
            op.reason,
            time,
            input.authorization,
            payload,
          )
          .run();
      }
    } catch (e) {
      const settled = await receipt(
        db,
        op,
        mode,
        session.google_subject,
        payload,
      );
      if (settled) return reply(settled);
      if (e.status) throw e;
      const message = String(e.message || "");
      if (message.includes("admin_authorization"))
        throw fail(403, "Confirmation expired. Sign in and review again.");
      if (/admin_(grant_cap|account_cap|month_cap)/.test(message))
        throw fail(
          409,
          "This change exceeds the grant, account-month or global-month allowance.",
        );
      if (message.includes("admin_reversal_balance"))
        throw fail(
          409,
          "Only unused, unreserved credits from this grant can be reversed. Refresh the account.",
        );
      if (message.includes("admin_eligibility"))
        throw fail(
          409,
          "Valid paid access and an unrestricted purchased balance are required.",
        );
      throw e;
    }
    return reply(await receipt(db, op, mode, session.google_subject, payload));
  } catch (e) {
    return reply(
      {
        error: e.status
          ? e.message
          : "Admin request unavailable. Check the account receipt before retrying a credit change.",
      },
      e.status || 503,
    );
  }
}
