import { OWNER_EMAIL } from "./admin-data.js";
import { hasPurchase } from "./purchase-access.js";
import { ownerWorkspaceQa } from "./owner-core-qa.js";

// This predicate is used inside the same atomic SQL statements that authorize
// intake/verification. Never insert a fake purchase or expand hasPurchase.
export function coordinationEligibilitySQL(env, connection, purchase = "p") {
  if (!["c", "n"].includes(connection) || !["p", "b"].includes(purchase))
    throw new Error("Invalid eligibility alias");
  const paid = `EXISTS(SELECT 1 FROM streamlion_purchases_v1 ${purchase} WHERE ${purchase}.google_subject=${connection}.google_subject AND ${purchase}.mode=${connection}.mode AND ${purchase}.status='paid')`;
  try {
    if (
      typeof env.STREAMLION_OWNER_CORE_QA_LICENSE !== "string" ||
      env.STREAMLION_OWNER_CORE_QA_LICENSE.length > 2048
    )
      return paid;
    const g = JSON.parse(env.STREAMLION_OWNER_CORE_QA_LICENSE || "null");
    const now = Date.now();
    if (
      env.STREAMLION_PAYMENTS_MODE !== "live" ||
      env.STREAMLION_CHECKOUT_MODE !== "paused" ||
      env.GOOGLE_AUTH_ORIGIN !== "https://streamlion.transcendencemedia.com" ||
      g?.version !== 1 ||
      g.scope !== "google-workspace-and-coordination" ||
      g.mode !== "live" ||
      g.origin !== env.GOOGLE_AUTH_ORIGIN ||
      typeof g.subject !== "string" ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(g.subject) ||
      !Number.isSafeInteger(g.issuedAt) ||
      g.issuedAt <= 0 ||
      g.issuedAt > now ||
      !Number.isSafeInteger(g.expiresAt) ||
      g.expiresAt <= now ||
      g.expiresAt <= g.issuedAt ||
      g.expiresAt - g.issuedAt > 7200000 ||
      typeof g.reason !== "string" ||
      !g.reason.trim() ||
      g.reason.length > 200
    )
      return paid;
    // Only validated identifier characters and safe integers enter SQL. The DB
    // clock and fresh owner/policy rows also guard expiry and role revocation.
    return `(${paid} OR (${connection}.mode='live' AND ${connection}.google_subject='${g.subject}' AND CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)>=${g.issuedAt} AND CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)<${g.expiresAt} AND EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 qo JOIN streamlion_admin_policy_v1 qp ON qp.mode=qo.mode WHERE qo.mode='live' AND qo.google_subject=${connection}.google_subject AND qo.email='${OWNER_EMAIL}' AND qo.enabled=1 AND qp.enabled=1)))`;
  } catch {
    return paid;
  }
}

export async function hasCoordinationAccess(env, subject) {
  if (await hasPurchase(env, subject)) return true;
  let grant;
  try {
    grant = JSON.parse(env.STREAMLION_OWNER_CORE_QA_LICENSE);
  } catch {
    return false;
  }
  return (
    grant?.scope === "google-workspace-and-coordination" &&
    Boolean(
      await ownerWorkspaceQa(env, {
        google_subject: subject,
        email: OWNER_EMAIL,
      }),
    )
  );
}
