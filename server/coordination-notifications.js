import { buildPushPayload } from "@block65/webcrypto-web-push";
import { hash, seal, unseal } from "./google-auth.js";
import { CoordinationError, DAY } from "../src/client-workflow.js";
import { applyResendEvents } from "./resend-events.js";

const emailPattern = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;
const countChanges = (r) => r?.meta?.changes === 1;
const limit = (env, now = Date.now()) => {
  const base = Number(env.RESEND_DAILY_LIMIT),
    temporary = Number(env.RESEND_TEST_DAILY_LIMIT),
    expires = Date.parse(env.RESEND_TEST_DAILY_LIMIT_UNTIL || "");
  return env.STREAMLION_PAYMENTS_MODE === "test" &&
    Number.isSafeInteger(base) &&
    base > 0 &&
    Number.isSafeInteger(temporary) &&
    temporary > base &&
    temporary <= 100 &&
    expires > now
    ? temporary
    : base;
};
const approvedResendRecipient = (env, to) =>
  emailPattern.test(to || "") &&
  (env.STREAMLION_PAYMENTS_MODE !== "test" ||
    env.RESEND_TEST_RECIPIENTS?.split(",")
      .map((x) => x.trim().toLowerCase())
      .includes(to.toLowerCase()));
export function resendReady(env) {
  return (
    env.ENABLE_RESEND_EMAIL === "true" &&
    Boolean(env.RESEND_API_KEY) &&
    emailPattern.test(env.RESEND_FROM_EMAIL || "") &&
    Number.isInteger(limit(env)) &&
    limit(env) > 0 &&
    limit(env) <= 50000 &&
    Number.isInteger(Number(env.RESEND_MONTHLY_LIMIT)) &&
    Number(env.RESEND_MONTHLY_LIMIT) > 0 &&
    Number(env.RESEND_MONTHLY_LIMIT) <= 1000000 &&
    ["test", "live"].includes(env.STREAMLION_PAYMENTS_MODE) &&
    (env.STREAMLION_PAYMENTS_MODE !== "test" ||
      Boolean(env.RESEND_TEST_RECIPIENTS?.trim()))
  );
}
export const emailReady = (env) =>
  resendReady(env) ||
  (env.STREAMLION_PAYMENTS_MODE === "test" && Boolean(env.COORDINATION_MAILER));
// Read-only guidance. The dispatcher still claims every attempt atomically;
// this never reserves, resets or increases a send allowance.
export async function emailDeliveryStatus(env, now = Date.now()) {
  if (!emailReady(env)) return { email: false, reason: "configuration" };
  if (!resendReady(env)) return { email: true };
  const date = new Date(now),
    day = Math.floor(now / DAY),
    monthStart = Math.floor(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY,
    );
  try {
    const used = await env.GOOGLE_SESSIONS.prepare(
      "SELECT COALESCE(SUM(CASE WHEN day=? THEN attempts ELSE 0 END),0) AS daily,COALESCE(SUM(attempts),0) AS monthly FROM streamlion_coordination_email_budget_v1 WHERE day>=?",
    )
      .bind(day, monthStart)
      .first();
    if (
      !used ||
      ![used.daily, used.monthly].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      )
    )
      return { email: false, reason: "unavailable" };
    if (used.monthly >= Number(env.RESEND_MONTHLY_LIMIT))
      return {
        email: false,
        reason: "monthly_limit",
        retryAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
      };
    if (used.daily >= limit(env, now))
      return { email: false, reason: "daily_limit", retryAt: (day + 1) * DAY };
    return { email: true };
  } catch {
    return { email: false, reason: "unavailable" };
  }
}
export const pushReady = (env) =>
  env.ENABLE_WEB_PUSH === "true" &&
  /^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY || "") &&
  /^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY || "") &&
  /^mailto:[^\s]+@[^\s]+$/.test(env.VAPID_SUBJECT || "");
export async function notificationsSchema(env) {
  try {
    return Boolean(
      await env.GOOGLE_SESSIONS.prepare(
        "SELECT version FROM streamlion_coordination_notifications_schema_v1 WHERE version=1",
      ).first(),
    );
  } catch {
    return false;
  }
}
const pushHost = (host) =>
  host === "fcm.googleapis.com" ||
  host === "updates.push.services.mozilla.com" ||
  host.endsWith(".push.services.mozilla.com") ||
  host.endsWith(".push.apple.com") ||
  host.endsWith(".notify.windows.com");
export function validateSubscription(value) {
  let url;
  try {
    url = new URL(value?.endpoint);
  } catch {
    throw new CoordinationError("Invalid notification subscription.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !pushHost(url.hostname) ||
    url.href.length > 2048 ||
    !/^[A-Za-z0-9_-]{87}$/.test(value?.keys?.p256dh || "") ||
    !/^[A-Za-z0-9_-]{22}$/.test(value?.keys?.auth || "")
  )
    throw new CoordinationError("Unsupported notification subscription.");
  const decode = (s) =>
    Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
  if (decode(value.keys.p256dh)[0] !== 4)
    throw new CoordinationError("Invalid notification key.");
  return {
    endpoint: url.href,
    expirationTime: null,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
  };
}
export async function notificationSettings(env, principal, request, body) {
  if (!(await notificationsSchema(env)))
    throw new CoordinationError("Notifications are awaiting activation.", 503);
  const db = env.GOOGLE_SESSIONS;
  const owner =
    principal.role === "provider"
      ? "provider:" + principal.connection.id
      : "client:" + principal.jobId;
  if (request.method === "POST") {
    if (body?.action === "subscribe") {
      if (!pushReady(env))
        throw new CoordinationError(
          "Push notifications are awaiting activation.",
          503,
        );
      const subscription = validateSubscription(body.subscription);
      // Validate the actual elliptic-curve point before storing it.
      try {
        await crypto.subtle.importKey(
          "raw",
          Uint8Array.from(
            atob(
              subscription.keys.p256dh
                .replaceAll("-", "+")
                .replaceAll("_", "/"),
            ),
            (c) => c.charCodeAt(0),
          ),
          { name: "ECDH", namedCurve: "P-256" },
          false,
          [],
        );
      } catch {
        throw new CoordinationError("Invalid notification key.");
      }
      const id = await hash(subscription.endpoint);
      await db
        .prepare(
          "DELETE FROM streamlion_coordination_push_subscriptions_v1 WHERE id=? AND (expires_at<=? OR NOT EXISTS(SELECT 1 FROM streamlion_coordination_connections_v1 c WHERE c.id=connection_id AND c.revoked=0 AND c.expires_at>?))",
        )
        .bind(id, Date.now(), Date.now())
        .run();
      const existing = await db
        .prepare(
          "SELECT owner_key FROM streamlion_coordination_push_subscriptions_v1 WHERE id=?",
        )
        .bind(id)
        .first();
      if (existing && existing.owner_key !== owner)
        throw new CoordinationError(
          "This device is linked to another session. Turn off its previous notifications first.",
          409,
        );
      const devices = await db
        .prepare(
          "SELECT COUNT(*) AS count FROM streamlion_coordination_push_subscriptions_v1 WHERE owner_key=? AND expires_at>?",
        )
        .bind(owner, Date.now())
        .first();
      if (!existing && devices.count >= 3)
        throw new CoordinationError(
          "Up to three devices can receive these notifications.",
          409,
        );
      await db
        .prepare(
          "INSERT INTO streamlion_coordination_push_subscriptions_v1(id,owner_key,connection_id,job_id,role,grant_hash,payload,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,grant_hash=excluded.grant_hash WHERE owner_key=excluded.owner_key",
        )
        .bind(
          id,
          owner,
          principal.connection.id,
          principal.jobId || null,
          principal.role,
          principal.grantHash || null,
          await seal(env, subscription, "push:" + id),
          Math.min(principal.expiresAt, Date.now() + 90 * DAY),
          Date.now(),
        )
        .run();
    } else if (body?.action === "unsubscribe") {
      const id = await hash(String(body.endpoint || ""));
      const existing = await db
        .prepare(
          "SELECT owner_key FROM streamlion_coordination_push_subscriptions_v1 WHERE id=?",
        )
        .bind(id)
        .first();
      if (existing && existing.owner_key !== owner)
        throw new CoordinationError(
          "This subscription belongs to another session.",
          403,
        );
      await db
        .prepare(
          "DELETE FROM streamlion_coordination_push_subscriptions_v1 WHERE id=? AND owner_key=?",
        )
        .bind(id, owner)
        .run();
    } else throw new CoordinationError("Unknown notification action.");
  }
  const devices = await db
    .prepare(
      "SELECT id,expires_at FROM streamlion_coordination_push_subscriptions_v1 WHERE owner_key=? AND expires_at>? AND (role='provider' OR grant_hash=?)",
    )
    .bind(owner, Date.now(), principal.grantHash || null)
    .all();
  return {
    enabled: pushReady(env),
    publicKey: pushReady(env) ? env.VAPID_PUBLIC_KEY : null,
    devices: devices.results,
  };
}
export async function rememberProviderEmail(env, connection, email) {
  if (!emailPattern.test(email || "") || !(await notificationsSchema(env)))
    return;
  await env.GOOGLE_SESSIONS.prepare(
    "UPDATE streamlion_coordination_connections_v1 SET notification_email=? WHERE id=?",
  )
    .bind(
      await seal(env, email, "connection-email:" + connection.id),
      connection.id,
    )
    .run();
}
export async function enqueueNotice(env, row, id, message, role = "client") {
  const modern = await notificationsSchema(env);
  const connection =
    role === "provider"
      ? await env.GOOGLE_SESSIONS.prepare(
          "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
        )
          .bind(row.connection_id)
          .first()
      : null;
  const email =
    role === "provider"
      ? connection?.notification_email
        ? await unseal(
            env,
            connection.notification_email,
            "connection-email:" + connection.id,
          )
        : null
      : await unseal(env, row.client_email, "job-email:" + row.id);
  const payload = await seal(env, { to: email, ...message }, "mail:" + id);
  const kind = message.expiresAt ? "invite" : message.kind || "action";
  const now = Date.now();
  if (modern) {
    await env.GOOGLE_SESSIONS.prepare(
      "INSERT OR IGNORE INTO streamlion_coordination_outbox_v1(id,job_id,payload,created_at,recipient_role,kind,next_attempt_at) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        row.id,
        payload,
        now,
        role,
        kind,
        kind === "routine" ? now + 60000 : now,
      )
      .run();
    // Coalesce only unattempted routine changes. Invitations and action requests keep their identity.
    if (kind === "routine") {
      const previous = await env.GOOGLE_SESSIONS.prepare(
        "SELECT id FROM streamlion_coordination_outbox_v1 WHERE job_id=? AND recipient_role=? AND kind='routine' AND status='queued' AND attempts=0 AND id!=? AND created_at<=? LIMIT 100",
      )
        .bind(row.id, role, id, now)
        .all();
      for (const old of previous.results)
        await env.GOOGLE_SESSIONS.prepare(
          "UPDATE streamlion_coordination_outbox_v1 SET status='skipped',sent_at=?,payload=? WHERE id=? AND attempts=0 AND status='queued'",
        )
          .bind(
            now,
            await seal(env, { skipped: true }, "mail:" + old.id),
            old.id,
          )
          .run();
    }
    if (kind !== "invite" && pushReady(env)) {
      const devices = await env.GOOGLE_SESSIONS.prepare(
        "SELECT id FROM streamlion_coordination_push_subscriptions_v1 WHERE connection_id=? AND role=? AND (job_id IS NULL OR job_id=?) AND expires_at>? LIMIT 3",
      )
        .bind(row.connection_id, role, row.id, now)
        .all();
      for (const device of devices.results)
        await env.GOOGLE_SESSIONS.prepare(
          "INSERT OR IGNORE INTO streamlion_coordination_push_outbox_v1(id,notice_id,subscription_id,job_id,created_at) VALUES(?,?,?,?,?)",
        )
          .bind(await hash(id + ":" + device.id), id, device.id, row.id, now)
          .run();
    }
  } else if (role === "client") {
    await env.GOOGLE_SESSIONS.prepare(
      "INSERT OR IGNORE INTO streamlion_coordination_outbox_v1(id,job_id,payload,created_at) VALUES(?,?,?,?)",
    )
      .bind(id, row.id, payload, now)
      .run();
  }
}
const backoff = (attempts) =>
  Math.min(3600000, 30000 * 2 ** Math.min(attempts, 7));
async function grantFor(db, jobId, now, mode) {
  return db
    .prepare(
      "SELECT j.*,c.revoked,c.expires_at,c.mode,c.google_subject FROM streamlion_coordination_jobs_v1 j JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id WHERE j.id=? AND c.revoked=0 AND c.expires_at>? AND c.mode=? AND j.archived=0 AND (j.archive_at IS NULL OR j.archive_at>?) AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 p WHERE p.google_subject=c.google_subject AND p.mode=c.mode AND p.status='paid')",
    )
    .bind(jobId, now, mode, now)
    .first();
}
export async function sendResend(env, id, payload) {
  if (!resendReady(env)) throw new Error("email_not_configured");
  if (!emailPattern.test(payload.to || ""))
    throw new Error("email_recipient_unavailable");
  if (!approvedResendRecipient(env, payload.to))
    throw new Error("email_recipient_not_approved");
  const url = new URL(payload.url);
  if (
    url.origin !== env.GOOGLE_AUTH_ORIGIN ||
    !["/api/client-portal", "/api/client-requests"].includes(url.pathname)
  )
    throw new Error("email_link_invalid");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": "streamlion/" + id,
    },
    body: JSON.stringify({
      from: "StreamLion <" + env.RESEND_FROM_EMAIL + ">",
      to: [payload.to],
      subject: payload.subject,
      text: payload.text + "\n\n" + payload.url,
    }),
  });
  if (!response.ok) throw new Error("email_not_accepted");
  const receipt = await response.json();
  if (
    typeof receipt.id !== "string" ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(receipt.id)
  )
    throw new Error("email_receipt_invalid");
  return receipt.id;
}
export async function dispatchNotifications(
  env,
  now = Date.now(),
  maximum = 20,
) {
  const counts = { sent: 0, skipped: 0, retained: 0, pushed: 0 };
  if (
    env.ENABLE_CLIENT_COORDINATION !== "true" ||
    env.STREAMLION_AI_CREDITS_MODE !== env.STREAMLION_PAYMENTS_MODE ||
    !(await notificationsSchema(env)) ||
    (!emailReady(env) && !pushReady(env))
  )
    return counts;
  const policy = await env.GOOGLE_SESSIONS.prepare(
    "SELECT active FROM streamlion_coordination_policy_v1 WHERE mode=?",
  )
    .bind(env.STREAMLION_PAYMENTS_MODE)
    .first();
  if (policy?.active !== 1) return counts;
  const db = env.GOOGLE_SESSIONS,
    token = crypto.randomUUID();
  const acquired = await db
    .prepare(
      "UPDATE streamlion_coordination_delivery_lock_v1 SET token=?,expires_at=? WHERE id=1 AND expires_at<=?",
    )
    .bind(token, now + 120000, now)
    .run();
  if (!countChanges(acquired)) return counts;
  const start = Date.now();
  try {
    if (emailReady(env)) {
      const mail = await db
        .prepare(
          "SELECT o.* FROM streamlion_coordination_outbox_v1 o JOIN streamlion_coordination_jobs_v1 j ON j.id=o.job_id JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id WHERE c.mode=? AND o.status='queued' AND o.sent_at IS NULL AND o.attempts<10 AND o.next_attempt_at<=? ORDER BY CASE o.kind WHEN 'invite' THEN 0 WHEN 'action' THEN 1 ELSE 2 END,o.created_at LIMIT ?",
        )
        .bind(env.STREAMLION_PAYMENTS_MODE, now, maximum)
        .all();
      for (const row of mail.results) {
        if (Date.now() - start > 20000) break;
        try {
          const payload = await unseal(env, row.payload, "mail:" + row.id);
          if (
            !(await grantFor(
              db,
              row.job_id,
              now,
              env.STREAMLION_PAYMENTS_MODE,
            )) ||
            (payload.expiresAt && payload.expiresAt <= now) ||
            !payload.to ||
            (resendReady(env) && !approvedResendRecipient(env, payload.to))
          ) {
            await db
              .prepare(
                "UPDATE streamlion_coordination_outbox_v1 SET status='skipped',sent_at=?,payload=? WHERE id=? AND status='queued'",
              )
              .bind(
                now,
                await seal(env, { skipped: true }, "mail:" + row.id),
                row.id,
              )
              .run();
            counts.skipped++;
            continue;
          }
          if (row.kind === "routine" && pushReady(env)) {
            const accepted = await db
              .prepare(
                "SELECT s.* FROM streamlion_coordination_push_outbox_v1 o JOIN streamlion_coordination_push_subscriptions_v1 s ON s.id=o.subscription_id WHERE o.notice_id=? AND o.accepted=1 AND s.expires_at>? LIMIT 1",
              )
              .bind(row.id, now)
              .first();
            const live =
              accepted?.role === "client"
                ? await db
                    .prepare(
                      "SELECT hash FROM streamlion_coordination_sessions_v1 WHERE hash=? AND revoked=0 AND expires_at>?",
                    )
                    .bind(accepted.grant_hash, now)
                    .first()
                : accepted;
            if (live) {
              await db
                .prepare(
                  "UPDATE streamlion_coordination_outbox_v1 SET status='skipped',sent_at=?,payload=? WHERE id=? AND status='queued'",
                )
                .bind(
                  now,
                  await seal(
                    env,
                    { routinePushPreferred: true },
                    "mail:" + row.id,
                  ),
                  row.id,
                )
                .run();
              counts.skipped++;
              continue;
            }
          }
          if (
            row.first_attempt_at &&
            now - row.first_attempt_at >= 23 * 3600000
          ) {
            await db
              .prepare(
                "UPDATE streamlion_coordination_outbox_v1 SET status='uncertain',attempts=10 WHERE id=? AND status='queued'",
              )
              .bind(row.id)
              .run();
            counts.retained++;
            continue;
          }
          if (resendReady(env)) {
            const date = new Date(now);
            const monthStart = Math.floor(
              Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / DAY,
            );
            const budget = await db
              .prepare(
                "INSERT INTO streamlion_coordination_email_budget_v1(day,attempts) SELECT ?,1 WHERE (SELECT COALESCE(SUM(attempts),0) FROM streamlion_coordination_email_budget_v1 WHERE day>=?)<? ON CONFLICT(day) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts",
              )
              .bind(
                Math.floor(now / DAY),
                monthStart,
                Number(env.RESEND_MONTHLY_LIMIT),
                limit(env, now),
              )
              .first();
            if (!budget) {
              counts.retained++;
              break;
            }
          }
          const claimed = await db
            .prepare(
              "UPDATE streamlion_coordination_outbox_v1 SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),next_attempt_at=? WHERE id=? AND status='queued' AND attempts=?",
            )
            .bind(now, now + backoff(row.attempts), row.id, row.attempts)
            .run();
          if (!countChanges(claimed)) continue;
          let receipt;
          if (resendReady(env))
            receipt = await sendResend(env, row.id, payload);
          else {
            const response = await env.COORDINATION_MAILER.fetch(
              new Request("https://mailer.internal/send", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Idempotency-Key": row.id,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10000),
              }),
            );
            const value = await response.json();
            if (
              !response.ok ||
              value.accepted !== true ||
              value.idempotencyKey !== row.id
            )
              throw new Error("email_not_accepted");
            receipt = null;
          }
          await db
            .prepare(
              "UPDATE streamlion_coordination_outbox_v1 SET status='accepted',sent_at=?,provider_id=?,payload=? WHERE id=? AND status='queued'",
            )
            .bind(
              now,
              receipt,
              await seal(env, { accepted: true }, "mail:" + row.id),
              row.id,
            )
            .run();
          if (receipt) await applyResendEvents(db, receipt);
          counts.sent++;
          // Resend defaults to a low request rate; one durable dispatcher paces the entire account.
          if (resendReady(env) && mail.results.length > 1)
            await new Promise((resolve) => setTimeout(resolve, 600));
        } catch {
          counts.retained++;
        }
      }
    }
    if (pushReady(env)) {
      const rows = await db
        .prepare(
          "SELECT o.* FROM streamlion_coordination_push_outbox_v1 o JOIN streamlion_coordination_jobs_v1 j ON j.id=o.job_id JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id WHERE c.mode=? AND o.sent_at IS NULL AND o.attempts<5 AND o.next_attempt_at<=? ORDER BY o.created_at LIMIT ?",
        )
        .bind(env.STREAMLION_PAYMENTS_MODE, now, maximum)
        .all();
      for (const row of rows.results) {
        if (Date.now() - start > 20000) break;
        try {
          const sub = await db
            .prepare(
              "SELECT * FROM streamlion_coordination_push_subscriptions_v1 WHERE id=? AND expires_at>?",
            )
            .bind(row.subscription_id, now)
            .first();
          const grant = await grantFor(
            db,
            row.job_id,
            now,
            env.STREAMLION_PAYMENTS_MODE,
          );
          const session =
            sub?.role === "client"
              ? await db
                  .prepare(
                    "SELECT job_id FROM streamlion_coordination_sessions_v1 WHERE hash=? AND revoked=0 AND expires_at>?",
                  )
                  .bind(sub.grant_hash, now)
                  .first()
              : null;
          if (
            !sub ||
            !grant ||
            sub.connection_id !== grant.connection_id ||
            (sub.role === "client" && session?.job_id !== row.job_id)
          ) {
            await db
              .prepare(
                "UPDATE streamlion_coordination_push_outbox_v1 SET sent_at=? WHERE id=?",
              )
              .bind(now, row.id)
              .run();
            continue;
          }
          await db
            .prepare(
              "UPDATE streamlion_coordination_push_outbox_v1 SET attempts=attempts+1,next_attempt_at=? WHERE id=?",
            )
            .bind(now + backoff(row.attempts), row.id)
            .run();
          const subscription = validateSubscription(
            await unseal(env, sub.payload, "push:" + sub.id),
          );
          const path =
            sub.role === "client"
              ? "/api/client-portal?job="
              : "/api/client-requests?job=";
          const options = await buildPushPayload(
            {
              data: JSON.stringify({
                title: "StreamLion",
                body: "A project has an update. Open StreamLion to review it.",
                url: path + encodeURIComponent(row.job_id),
                tag: row.notice_id,
              }),
              options: { ttl: 300 },
            },
            subscription,
            {
              subject: env.VAPID_SUBJECT,
              publicKey: env.VAPID_PUBLIC_KEY,
              privateKey: env.VAPID_PRIVATE_KEY,
            },
          );
          const response = await fetch(subscription.endpoint, {
            ...options,
            redirect: "manual",
            signal: AbortSignal.timeout(10000),
          });
          if ([404, 410].includes(response.status))
            await db
              .prepare(
                "DELETE FROM streamlion_coordination_push_subscriptions_v1 WHERE id=?",
              )
              .bind(sub.id)
              .run();
          else if (!response.ok) throw new Error("push_not_accepted");
          await db
            .prepare(
              "UPDATE streamlion_coordination_push_outbox_v1 SET sent_at=?,accepted=? WHERE id=?",
            )
            .bind(now, response.ok ? 1 : 0, row.id)
            .run();
          if (response.ok) counts.pushed++;
        } catch {
          counts.retained++;
        }
      }
    }
  } finally {
    await db
      .prepare(
        "UPDATE streamlion_coordination_delivery_lock_v1 SET token=NULL,expires_at=0 WHERE id=1 AND token=?",
      )
      .bind(token)
      .run();
  }
  return counts;
}
