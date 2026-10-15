import assert from "node:assert/strict";
import { base64url, base64Bytes, base64urlBytes } from "../server/base64.js";
import { seal, unseal } from "../server/google-auth.js";

// Synthetic, local CPU comparison only. No providers, production requests,
// credentials, telemetry or settings. Node CPU time is not a Workers receipt.
globalThis.fetch = () => {
  throw new Error("Network calls are forbidden.");
};
const legacyEncode = (bytes) => {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};
const legacyDecode = (text) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
const env = {
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
};
async function key() {
  return crypto.subtle.importKey(
    "raw",
    legacyDecode(env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
async function legacySeal(value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode("synthetic"),
    },
    await key(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return legacyEncode(iv) + "." + legacyEncode(new Uint8Array(bytes));
}
async function legacyUnseal(value) {
  const [iv, cipher] = value.split(".");
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: legacyDecode(iv),
          additionalData: new TextEncoder().encode("synthetic"),
        },
        await key(),
        legacyDecode(cipher),
      ),
    ),
  );
}
const measure = async (run) => {
  const start = process.cpuUsage();
  const result = await run();
  const used = process.cpuUsage(start);
  return { result, ms: (used.user + used.system) / 1000 };
};
async function compare(name, before, after) {
  await before();
  await after();
  const baseline = [],
    optimized = [];
  for (let i = 0; i < 7; i++) {
    const a = await measure(before),
      b = await measure(after);
    assert.deepEqual(a.result, b.result);
    baseline.push(a.ms);
    optimized.push(b.ms);
  }
  const median = (values) => values.sort((a, b) => a - b)[3];
  const oldMs = median(baseline),
    newMs = median(optimized);
  return {
    name,
    baselineCPUms: +oldMs.toFixed(3),
    optimizedCPUms: +newMs.toFixed(3),
    reductionPercent: +((1 - newMs / oldMs) * 100).toFixed(1),
  };
}
const bytes = Uint8Array.from({ length: 512 * 1024 }, (_, i) => i % 256);
const encoded = legacyEncode(bytes);
const value = { content: "x".repeat(699986) };
assert.equal(Buffer.byteLength(JSON.stringify(value)), 700000);
const cipher = await legacySeal(value);
assert.deepEqual(await unseal(env, cipher, "synthetic"), value);
assert.deepEqual(
  await legacyUnseal(await seal(env, value, "synthetic")),
  value,
);
const results = [
  await compare(
    "512 KiB attachment encode",
    () => legacyEncode(bytes),
    () => base64url(bytes),
  ),
  await compare(
    "512 KiB attachment decode",
    () => legacyDecode(encoded),
    () => new Uint8Array(base64urlBytes(encoded)),
  ),
  await compare(
    "512 KiB standard upload decode",
    () => legacyDecode(Buffer.from(bytes).toString("base64")),
    () => new Uint8Array(base64Bytes(Buffer.from(bytes).toString("base64"))),
  ),
  await compare(
    "700000-byte vault seal and read",
    async () => legacyUnseal(await legacySeal(value)),
    async () => unseal(env, await seal(env, value, "synthetic"), "synthetic"),
  ),
  await compare(
    "700000-byte vault read",
    () => legacyUnseal(cipher),
    () => unseal(env, cipher, "synthetic"),
  ),
];
console.log(
  JSON.stringify(
    {
      synthetic: true,
      providerCalls: 0,
      results,
      limitation:
        "Local Node process CPU includes native/crypto work. It neither enforces nor proves Cloudflare's 10 ms per-invocation limit. Live CPU-limit errors must be checked separately after an authorized deployment.",
    },
    null,
    2,
  ),
);
