export const paymentMode = (env) => env.STREAMLION_PAYMENTS_MODE || "disabled";
export const licenseRequired = (env) =>
  env.STREAMLION_REQUIRE_LICENSE === "true";
export async function hasPurchase(env, subject) {
  const mode = paymentMode(env);
  if (!["test", "live"].includes(mode) || !env.GOOGLE_SESSIONS)
    throw new Error("purchase_configuration");
  const row = await env.GOOGLE_SESSIONS.prepare(
    "SELECT order_id FROM streamlion_purchases_v1 WHERE mode = ? AND google_subject = ? AND status = 'paid' LIMIT 1",
  )
    .bind(mode, subject)
    .first();
  return Boolean(row);
}
