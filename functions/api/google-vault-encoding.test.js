import assert from "node:assert/strict";
import test from "node:test";
import { seal, unseal } from "../../server/google-auth.js";

const env = {
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
};
const encoder = new TextEncoder();
const context = "synthetic-archive";
const value = { content: "\u0000\u00ff\ud83e\udd81".repeat(50000) };
async function cipherKey() {
  return crypto.subtle.importKey("raw", Buffer.alloc(32, 7), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const oldDecode = (text) =>
  Uint8Array.from(
    atob(text.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0),
  );

test("vault reads large ciphertext in the existing IV.ciphertext format", async () => {
  const iv = new Uint8Array(12).fill(3);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await cipherKey(),
    encoder.encode(JSON.stringify(value)),
  );
  const ciphertext =
    Buffer.from(iv).toString("base64url") +
    "." +
    Buffer.from(encrypted).toString("base64url");
  assert.deepEqual(await unseal(env, ciphertext, context), value);
  await assert.rejects(unseal(env, ciphertext, "another-account"));
});

test("new vault ciphertext is readable by the previous decoder", async () => {
  const ciphertext = await seal(env, value, context);
  assert.match(ciphertext, /^[\w-]+\.[\w-]+$/);
  const [iv, encrypted] = ciphertext.split(".").map(oldDecode);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await cipherKey(),
    encrypted,
  );
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain)), value);
});

test("base64 validation and ciphertext authentication remain strict", async () => {
  const ciphertext = await seal(env, { accessToken: "synthetic" }, context);
  await assert.rejects(unseal(env, ciphertext + "!", context));
  await assert.rejects(
    seal(
      { GOOGLE_TOKEN_ENCRYPTION_KEY: env.GOOGLE_TOKEN_ENCRYPTION_KEY + "!" },
      {},
      context,
    ),
  );
  const [iv, encrypted] = ciphertext.split(".");
  const bytes = Buffer.from(encrypted, "base64url");
  bytes[0] ^= 1;
  await assert.rejects(
    unseal(env, iv + "." + bytes.toString("base64url"), context),
  );
});
