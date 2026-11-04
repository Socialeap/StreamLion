// Shared v1 bridge contract. Keep byte-identical to F|3D src/lib/f3d-profile.mjs.
// This assertion conveys profile data only, never sign-in or product authority.
export const PROFILE_ISSUER = "https://www.frontiers3d.com";
export const PROFILE_AUDIENCE = "https://streamlion.transcendencemedia.com";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noncePattern = /^[A-Za-z0-9_-]{43}$/;
const services = new Set([
  "matterport",
  "photography",
  "video",
  "floor_plans",
  "other",
]);
const record = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  record(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const text = (value, max) =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
const fail = () => {
  throw new Error("The F|3D profile response could not be verified.");
};
export function validateProfileSnapshot(value) {
  if (
    !exact(value, [
      "schemaVersion",
      "kind",
      "accountId",
      "businessProfile",
      "directoryProfile",
    ]) ||
    value.schemaVersion !== 1 ||
    value.kind !== "f3d.provider-profile" ||
    !uuid.test(value.accountId)
  )
    fail();
  const b = value.businessProfile,
    d = value.directoryProfile;
  if (
    b !== null &&
    (!exact(b, ["id", "name", "phone", "city", "region", "updatedAt"]) ||
      !uuid.test(b.id) ||
      !text(b.name, 120) ||
      !text(b.phone, 50) ||
      !text(b.city, 120) ||
      !text(b.region, 120) ||
      !text(b.updatedAt, 40) ||
      !Number.isFinite(Date.parse(b.updatedAt)))
  )
    fail();
  if (
    d !== null &&
    (!exact(d, [
      "id",
      "name",
      "city",
      "region",
      "services",
      "directoryOptIn",
    ]) ||
      !uuid.test(d.id) ||
      !text(d.name, 120) ||
      !text(d.city, 120) ||
      !text(d.region, 120) ||
      typeof d.directoryOptIn !== "boolean" ||
      !Array.isArray(d.services) ||
      d.services.length > 5 ||
      new Set(d.services).size !== d.services.length ||
      !d.services.every((item) => services.has(item)))
  )
    fail();
  return value;
}
const encode = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const decode = (text) =>
  Uint8Array.from(
    atob(
      text.replaceAll("-", "+").replaceAll("_", "/") +
        "=".repeat((4 - (text.length % 4)) % 4),
    ),
    (c) => c.charCodeAt(0),
  );
const json = (value) => encode(new TextEncoder().encode(JSON.stringify(value)));
function key(value, privateKey) {
  if (
    !record(value) ||
    value.kty !== "OKP" ||
    value.crv !== "Ed25519" ||
    !noncePattern.test(value.x) ||
    (privateKey ? !noncePattern.test(value.d) : Object.hasOwn(value, "d"))
  )
    fail();
  return {
    kty: value.kty,
    crv: value.crv,
    x: value.x,
    ...(privateKey ? { d: value.d } : {}),
  };
}
// Configuration errors must never echo private environment values.
export function parseProfileSigningKey(value) {
  try {
    return key(JSON.parse(value), true);
  } catch {
    fail();
  }
}
export async function signProfileAssertion(
  snapshot,
  nonce,
  audience,
  privateJwk,
  now = Date.now(),
) {
  validateProfileSnapshot(snapshot);
  if (!noncePattern.test(nonce) || audience !== PROFILE_AUDIENCE) fail();
  const iat = Math.floor(now / 1000);
  const input =
    json({ alg: "EdDSA", typ: "JWT" }) +
    "." +
    json({
      iss: PROFILE_ISSUER,
      aud: audience,
      nonce,
      iat,
      exp: iat + 120,
      profile: snapshot,
    });
  const signing = await crypto.subtle.importKey(
    "jwk",
    key(privateJwk, true),
    "Ed25519",
    false,
    ["sign"],
  );
  return (
    input +
    "." +
    encode(
      new Uint8Array(
        await crypto.subtle.sign(
          "Ed25519",
          signing,
          new TextEncoder().encode(input),
        ),
      ),
    )
  );
}
export async function verifyProfileAssertion(
  token,
  nonce,
  audience,
  publicJwk,
  now = Date.now(),
) {
  if (
    typeof token !== "string" ||
    token.length > 16000 ||
    !noncePattern.test(nonce) ||
    audience !== PROFILE_AUDIENCE
  )
    fail();
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
  )
    fail();
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  if (
    !exact(header, ["alg", "typ"]) ||
    header.alg !== "EdDSA" ||
    header.typ !== "JWT"
  )
    fail();
  const verification = await crypto.subtle.importKey(
    "jwk",
    key(publicJwk, false),
    "Ed25519",
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      verification,
      decode(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1]),
    ))
  )
    fail();
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]))),
    seconds = Math.floor(now / 1000);
  if (
    !exact(claims, ["iss", "aud", "nonce", "iat", "exp", "profile"]) ||
    claims.iss !== PROFILE_ISSUER ||
    claims.aud !== audience ||
    claims.nonce !== nonce ||
    !Number.isSafeInteger(claims.iat) ||
    !Number.isSafeInteger(claims.exp) ||
    claims.exp !== claims.iat + 120 ||
    claims.iat > seconds + 30 ||
    claims.exp <= seconds
  )
    fail();
  return validateProfileSnapshot(claims.profile);
}
