import { googleConfigurationReady } from "./google-auth.js";
import { paymentMode } from "./purchase-access.js";
import { notificationsSchema } from "./coordination-notifications.js";
import { efficiencySchema } from "./coordination-runtime.js";

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
    const schema = await env.GOOGLE_SESSIONS.prepare(
      "SELECT version FROM streamlion_coordination_schema_v1 WHERE version=1",
    ).first();
    const policy = await env.GOOGLE_SESSIONS.prepare(
      "SELECT active FROM streamlion_coordination_policy_v1 WHERE mode=?",
    )
      .bind(paymentMode(env))
      .first();
    return Boolean(
      schema &&
      policy?.active === 1 &&
      (await notificationsSchema(env)) &&
      (await efficiencySchema(env)),
    );
  } catch {
    return false;
  }
}
