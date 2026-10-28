import { googleConfigurationReady } from "./google-auth.js";
import { paymentMode } from "./purchase-access.js";

// Shared read-only eligibility. Never grants access, writes records or calls providers.
export async function coordinationReady(env) {
  if (
    env.ENABLE_CLIENT_COORDINATION !== "true" ||
    !googleConfigurationReady(env) ||
    !["test", "live"].includes(paymentMode(env)) ||
    env.STREAMLION_AI_CREDITS_MODE !== paymentMode(env)
  )
    return false;
  try {
    // One fresh SQLite snapshot replaces four serial binding round trips.
    // Do not cache eligibility: policy revocation must affect the next call.
    const result = await env.GOOGLE_SESSIONS.prepare(
      `SELECT
        EXISTS(SELECT 1 FROM streamlion_coordination_schema_v1 WHERE version=1)
        AND EXISTS(SELECT 1 FROM streamlion_coordination_policy_v1 WHERE mode=? AND active=1)
        AND EXISTS(SELECT 1 FROM streamlion_coordination_notifications_schema_v1 WHERE version=1)
        AND EXISTS(SELECT 1 FROM streamlion_coordination_efficiency_schema_v1 WHERE version=1)
        AS ready`,
    )
      .bind(paymentMode(env))
      .first();
    return result?.ready === 1;
  } catch {
    return false;
  }
}
