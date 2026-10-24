import { paymentMode } from "./purchase-access.js";
// Separate from hasPurchase: free Core never becomes a paid entitlement.
export async function pilotHistory(env, subject) {
  if (
    env.ENABLE_FREE_PILOT !== "true" ||
    !env.GOOGLE_SESSIONS ||
    !["test", "live"].includes(paymentMode(env))
  )
    return null;
  try {
    return await env.GOOGLE_SESSIONS.prepare(
      "SELECT a.state,a.starts_at,a.ends_at FROM streamlion_free_pilot_accounts_v1 a JOIN streamlion_free_pilot_policy_v1 p ON p.mode=a.mode JOIN streamlion_free_pilot_schema_v1 s ON s.version=1 WHERE a.mode=? AND a.google_subject=? AND a.starts_at IS NOT NULL",
    )
      .bind(paymentMode(env), subject)
      .first();
  } catch {
    return null;
  }
}
export async function pilotAccess(env, subject, now = Date.now()) {
  const row = await pilotHistory(env, subject);
  return row?.state === "active" && row.starts_at <= now && row.ends_at > now
    ? { startsAt: row.starts_at, endsAt: row.ends_at }
    : null;
}
