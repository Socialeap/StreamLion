import test from "node:test";
import assert from "node:assert/strict";
import {
  parseProfileSigningKey,
  validateProfileSnapshot,
  signProfileAssertion,
  verifyProfileAssertion,
} from "./f3d-profile.js";
const accountId = "11111111-1111-4111-8111-111111111111";
const profile = {
  schemaVersion: 1,
  kind: "f3d.provider-profile",
  accountId,
  businessProfile: null,
  directoryProfile: null,
};
const nonce = "N".repeat(43),
  audience = "https://streamlion.transcendencemedia.com";
const pair = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]);
const privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey),
  publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
test("owner snapshot permits missing profiles but rejects credentials, roles and unknown fields", () => {
  assert.deepEqual(validateProfileSnapshot(profile), profile);
  for (const extra of [
    { roles: ["provider"] },
    { email: "private@example.com" },
    { accessToken: "secret" },
  ])
    assert.throws(() => validateProfileSnapshot({ ...profile, ...extra }));
  assert.throws(() =>
    validateProfileSnapshot({ ...profile, accountId: "email@example.com" }),
  );
});
test("profile fields and Directory service identifiers have strict bounds", () => {
  const d = {
    id: accountId,
    name: "Harbor",
    city: "Portland",
    region: "OR",
    services: ["matterport"],
    directoryOptIn: false,
  };
  assert.deepEqual(
    validateProfileSnapshot({ ...profile, directoryProfile: d })
      .directoryProfile,
    d,
  );
  for (const bad of [
    { services: ["arbitrary"] },
    { services: ["matterport", "matterport"] },
    { directoryOptIn: "true" },
    { name: "x".repeat(121) },
  ])
    assert.throws(() =>
      validateProfileSnapshot({
        ...profile,
        directoryProfile: { ...d, ...bad },
      }),
    );
});
test("signed snapshot is bound to issuer, audience, nonce and two minute lifetime", async () => {
  const token = await signProfileAssertion(
    profile,
    nonce,
    audience,
    privateKey,
    1000000,
  );
  assert.deepEqual(
    await verifyProfileAssertion(token, nonce, audience, publicKey, 1000001),
    profile,
  );
  await assert.rejects(() =>
    verifyProfileAssertion(token, "X".repeat(43), audience, publicKey, 1000001),
  );
  await assert.rejects(() =>
    verifyProfileAssertion(
      token,
      nonce,
      "https://evil.example",
      publicKey,
      1000001,
    ),
  );
  await assert.rejects(() =>
    verifyProfileAssertion(token, nonce, audience, publicKey, 1120000),
  );
  await assert.rejects(() =>
    verifyProfileAssertion(token, nonce, audience, publicKey, 900000),
  );
});
test("tampering, foreign signature and accidentally configured private verification key fail closed", async () => {
  const token = await signProfileAssertion(
    profile,
    nonce,
    audience,
    privateKey,
    1000000,
  );
  const other = await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]);
  const foreign = await crypto.subtle.exportKey("jwk", other.publicKey);
  await assert.rejects(() =>
    verifyProfileAssertion(token, nonce, audience, foreign, 1000001),
  );
  await assert.rejects(() =>
    verifyProfileAssertion(token, nonce, audience, privateKey, 1000001),
  );
  const parts = token.split(".");
  parts[1] = btoa(JSON.stringify({})).replaceAll("=", "");
  await assert.rejects(() =>
    verifyProfileAssertion(
      parts.join("."),
      nonce,
      audience,
      publicKey,
      1000001,
    ),
  );
});

test("owner text accepted by F3D, including tabs and line breaks, remains connectable", () => {
  const directoryProfile = {
    id: accountId,
    name: "Harbor\nCapture",
    city: "New\tYork",
    region: "NY",
    services: [],
    directoryOptIn: false,
  };
  assert.equal(
    validateProfileSnapshot({ ...profile, directoryProfile }).directoryProfile
      .name,
    "Harbor\nCapture",
  );
});

test("invalid server key configuration never echoes secret input", () => {
  assert.throws(
    () => parseProfileSigningKey('{"d":"PRIVATE_KEY_MATERIAL'),
    (error) => !error.message.includes("PRIVATE_KEY_MATERIAL"),
  );
  assert.equal(
    parseProfileSigningKey(JSON.stringify(privateKey)).d,
    privateKey.d,
  );
});
