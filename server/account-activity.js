import { getSession } from "./google-auth.js";
import { boundedText } from "./request-body.js";
import {
  adminInstalled,
  observeAccount,
  observeActivity,
  localDate,
} from "./admin-data.js";
const response = (v, status = 200) =>
  Response.json(v, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function handleActivity(
  { request, env },
  { now = Date.now } = {},
) {
  try {
    if (request.method !== "POST")
      return response({ error: "Method not allowed." }, 405);
    if (
      new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
      request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN ||
      request.headers.get("Sec-Fetch-Site") === "cross-site"
    )
      return response({ error: "Open StreamLion." }, 403);
    if (!(await adminInstalled(env.GOOGLE_SESSIONS)))
      return response({ recorded: false });
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return response({ error: "Use JSON." }, 415);
    const s = await getSession(request, env);
    if (!s) return response({ error: "Sign in." }, 401);
    const b = JSON.parse(await boundedText(request, 1024)),
      time = now(),
      mode = env.STREAMLION_PAYMENTS_MODE;
    if (
      b.subject !== s.google_subject ||
      request.headers.get("X-StreamLion-Account") !== s.google_subject
    )
      return response({ error: "Account changed." }, 403);
    if (
      !["test", "live"].includes(mode) ||
      !Number.isSafeInteger(b.occurredAt) ||
      b.occurredAt > time + 30000 ||
      b.occurredAt < time - 7 * 86400000
    )
      return response({ error: "Invalid activity time." }, 400);
    const prior = await env.GOOGLE_SESSIONS.prepare(
      "SELECT last_received_at n FROM streamlion_account_days_v1 WHERE mode=? AND google_subject=? AND reporting_date=?",
    )
      .bind(mode, s.google_subject, localDate(b.occurredAt))
      .first();
    if (prior?.n > time - 60000) return response({ recorded: true });
    await observeAccount(env.GOOGLE_SESSIONS, s, mode, time, {
      historical: true,
      source: "authenticated_activity",
    });
    await observeActivity(
      env.GOOGLE_SESSIONS,
      mode,
      s.google_subject,
      b.occurredAt,
      time,
    );
    return response({ recorded: true });
  } catch {
    return response({ error: "Activity could not be recorded." }, 503);
  }
}
