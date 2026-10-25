import { createRemoteJWKSet, jwtVerify } from "jose";
import { adminInstalled, OWNER_EMAIL } from "./admin-data.js";
const keys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 5000, cooldownDuration: 30000 },
);
export async function verifyOwnerClaims(
  token,
  { subject, nonce, clientId, now = Date.now(), key = keys },
) {
  const { payload: p } = await jwtVerify(token, key, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
    algorithms: ["RS256"],
    currentDate: new Date(now),
    requiredClaims: ["exp", "sub", "auth_time", "nonce", "amr"],
  });
  const at = p.auth_time * 1000;
  if (
    !nonce ||
    p.nonce !== nonce ||
    p.sub !== subject ||
    !Number.isSafeInteger(at) ||
    at > now + 30000 ||
    at <= now - 300000 ||
    !Array.isArray(p.amr) ||
    !p.amr.some((v) => ["pwd", "mfa", "hwk", "swk"].includes(v))
  )
    throw Error("admin_assurance");
  return at;
}
export async function completeAdminSignin(
  env,
  sessionHash,
  identity,
  token,
  nonce,
  now = Date.now(),
) {
  const db = env.GOOGLE_SESSIONS,
    mode = env.STREAMLION_PAYMENTS_MODE;
  if (
    identity.email !== OWNER_EMAIL ||
    !["test", "live"].includes(mode) ||
    !(await adminInstalled(db))
  )
    return;
  const role = await db
    .prepare(
      "SELECT 1 ok FROM streamlion_admin_owners_v1 o JOIN streamlion_admin_policy_v1 p ON p.mode=o.mode WHERE o.google_subject=? AND o.mode=? AND o.enabled=1 AND p.enabled=1",
    )
    .bind(identity.sub, mode)
    .first();
  if (!role) return;
  let verified = 0;
  try {
    verified = await verifyOwnerClaims(token, {
      subject: identity.sub,
      nonce,
      clientId: env.VITE_GOOGLE_CLIENT_ID,
      now,
    });
  } catch {
    /* No assurance means a read-only admin window. */
  }
  await db
    .prepare(
      "DELETE FROM streamlion_admin_authorizations_v1 WHERE expires_at<?",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "DELETE FROM streamlion_admin_windows_v1 WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM streamlion_admin_authorizations_v1 a WHERE a.window_id=streamlion_admin_windows_v1.id)",
    )
    .bind(now - 3600000)
    .run();
  await db
    .prepare(
      "INSERT OR REPLACE INTO streamlion_admin_windows_v1 VALUES(?,?,?,?,?,?)",
    )
    .bind(sessionHash, identity.sub, mode, now, now, verified)
    .run();
}
