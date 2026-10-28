import { OWNER_EMAIL } from "./admin-data.js";

// Server configuration plus the current enrolled owner, never a browser grant
// or a purchase. Deliberately excluded from hasPurchase and paid feature gates.
export async function ownerWorkspaceQa(env, identity, now = Date.now()) {
  if (
    env.STREAMLION_PAYMENTS_MODE !== "live" ||
    env.STREAMLION_CHECKOUT_MODE !== "paused" ||
    env.GOOGLE_AUTH_ORIGIN !== "https://streamlion.transcendencemedia.com" ||
    identity?.email !== OWNER_EMAIL ||
    !identity.google_subject ||
    typeof env.STREAMLION_OWNER_CORE_QA_LICENSE !== "string" ||
    env.STREAMLION_OWNER_CORE_QA_LICENSE.length > 2048
  )
    return null;
  try {
    const grant = JSON.parse(env.STREAMLION_OWNER_CORE_QA_LICENSE);
    if (
      grant?.version !== 1 ||
      grant.scope !== "google-workspace" ||
      grant.mode !== "live" ||
      grant.origin !== env.GOOGLE_AUTH_ORIGIN ||
      grant.subject !== identity.google_subject ||
      !Number.isSafeInteger(grant.issuedAt) ||
      grant.issuedAt <= 0 ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= grant.issuedAt ||
      grant.expiresAt - grant.issuedAt > 86400000 ||
      grant.issuedAt > now ||
      grant.expiresAt <= now ||
      typeof grant.reason !== "string" ||
      !grant.reason.trim() ||
      grant.reason.length > 200
    )
      return null;
    const owner = await env.GOOGLE_SESSIONS.prepare(
      "SELECT 1 AS allowed FROM streamlion_admin_owners_v1 o JOIN streamlion_admin_policy_v1 p ON p.mode=o.mode WHERE o.mode='live' AND o.google_subject=? AND o.email=? AND o.enabled=1 AND p.enabled=1",
    )
      .bind(identity.google_subject, OWNER_EMAIL)
      .first();
    return owner?.allowed === 1
      ? { scope: "google-workspace", expiresAt: grant.expiresAt }
      : null;
  } catch {
    return null;
  }
}
