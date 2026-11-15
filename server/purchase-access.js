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

export function ownerLicenseEnvironment(env) {
  return (
    paymentMode(env) === "live" &&
    env.GOOGLE_AUTH_ORIGIN === "https://streamlion.transcendencemedia.com"
  );
}

async function ownerLicenseInstalled(env) {
  if (!ownerLicenseEnvironment(env)) return false;
  return Boolean(
    await env.GOOGLE_SESSIONS.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='streamlion_owner_license_schema_v1'",
    ).first(),
  );
}
export async function ownerLicense(env, subject) {
  if (!subject || !(await ownerLicenseInstalled(env))) return null;
  return (
    (await env.GOOGLE_SESSIONS.prepare(
      "SELECT credit_cap_micros FROM streamlion_active_owner_licenses_v1 WHERE mode='live' AND google_subject=?",
    )
      .bind(subject)
      .first()) ?? null
  );
}

export async function hasCoreLicense(env, subject) {
  return (
    (await hasPurchase(env, subject)) ||
    Boolean(await ownerLicense(env, subject))
  );
}

// Also used inside coordination statements that atomically check access.
export async function coreLicenseSQL(env, connection, purchase = "p") {
  if (!["c", "n"].includes(connection) || !["p", "b"].includes(purchase))
    throw new Error("Invalid eligibility alias");
  const paid = `EXISTS(SELECT 1 FROM streamlion_purchases_v1 ${purchase} WHERE ${purchase}.google_subject=${connection}.google_subject AND ${purchase}.mode=${connection}.mode AND ${purchase}.status='paid')`;
  if (!(await ownerLicenseInstalled(env))) return paid;
  return `(${paid} OR EXISTS(SELECT 1 FROM streamlion_active_owner_licenses_v1 l WHERE l.mode=${connection}.mode AND l.google_subject=${connection}.google_subject))`;
}
