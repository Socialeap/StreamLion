import { OWNER_EMAIL } from "./admin-data.js";
import { hasPurchase } from "./purchase-access.js";
import { ownerWorkspaceQa } from "./owner-core-qa.js";

// A separate coordination window can coexist with the workspace-only window.
// It remains constrained by the already-authorized workspace grant.
function coordinationGrant(env) {
  if (typeof env.STREAMLION_OWNER_COORDINATION_QA !== "string")
    return env.STREAMLION_OWNER_CORE_QA_LICENSE;
  try {
    if (
      typeof env.STREAMLION_OWNER_CORE_QA_LICENSE !== "string" ||
      env.STREAMLION_OWNER_CORE_QA_LICENSE.length > 2048 ||
      env.STREAMLION_OWNER_COORDINATION_QA.length > 2048
    )
      return null;
    const workspace = JSON.parse(env.STREAMLION_OWNER_CORE_QA_LICENSE);
    const coordination = JSON.parse(env.STREAMLION_OWNER_COORDINATION_QA);
    const now = Date.now();
    if (
      workspace?.version !== 1 ||
      workspace.scope !== "google-workspace" ||
      workspace.mode !== "live" ||
      workspace.origin !== env.GOOGLE_AUTH_ORIGIN ||
      workspace.subject !== coordination.subject ||
      !Number.isSafeInteger(workspace.issuedAt) ||
      !Number.isSafeInteger(workspace.expiresAt) ||
      workspace.issuedAt <= 0 ||
      workspace.issuedAt > now ||
      workspace.expiresAt <= now ||
      workspace.expiresAt <= workspace.issuedAt ||
      workspace.expiresAt - workspace.issuedAt > 72 * 3600000 ||
      coordination.expiresAt > workspace.expiresAt ||
      typeof workspace.reason !== "string" ||
      !workspace.reason.trim() ||
      workspace.reason.length > 200
    )
      return null;
    return env.STREAMLION_OWNER_COORDINATION_QA;
  } catch {
    return null;
  }
}

// This predicate is used inside the same atomic SQL statements that authorize
// intake/verification. Never insert a fake purchase or expand hasPurchase.
export function coordinationEligibilitySQL(env, connection, purchase = "p") {
  if (!["c", "n"].includes(connection) || !["p", "b"].includes(purchase))
    throw new Error("Invalid eligibility alias");
  const paid = `EXISTS(SELECT 1 FROM streamlion_purchases_v1 ${purchase} WHERE ${purchase}.google_subject=${connection}.google_subject AND ${purchase}.mode=${connection}.mode AND ${purchase}.status='paid')`;
  try {
    const raw = coordinationGrant(env);
    if (typeof raw !== "string" || raw.length > 2048) return paid;
    const g = JSON.parse(raw || "null");
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
  const raw = coordinationGrant(env);
  let grant;
  try {
    grant = JSON.parse(raw);
  } catch {
    return false;
  }
  return (
    grant?.scope === "google-workspace-and-coordination" &&
    Boolean(
      await ownerWorkspaceQa(
        { ...env, STREAMLION_OWNER_CORE_QA_LICENSE: raw },
        {
          google_subject: subject,
          email: OWNER_EMAIL,
        },
      ),
    )
  );
}
