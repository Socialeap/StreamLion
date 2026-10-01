import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "./health.js";
test("health reports configuration without calling Google, exposing secrets or accepting a missing persistent binding", async () => {
  const request = new Request("https://app.example/api/health");
  assert.equal(onRequest({ request, env: {} }).status, 503);
  const env = {
    VITE_GOOGLE_CLIENT_ID: "public",
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_CLIENT_SECRET: "private",
    GOOGLE_TOKEN_ENCRYPTION_KEY: "A".repeat(43),
    GOOGLE_AUTH_ORIGIN: "https://app.example",
  };
  assert.equal(onRequest({ request, env }).status, 503);
  env.GOOGLE_SESSIONS = {};
  assert.equal(
    onRequest({ request, env: { ...env, GOOGLE_TOKEN_ENCRYPTION_KEY: "bad" } })
      .status,
    503,
  );
  assert.equal(
    onRequest({
      request,
      env: { ...env, GOOGLE_AUTH_ORIGIN: "http://app.example" },
    }).status,
    503,
  );
  assert.equal(
    onRequest({
      request,
      env: { ...env, GOOGLE_AUTH_ORIGIN: "https://app.example/" },
    }).status,
    503,
  );
  const response = onRequest({ request, env });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes("private"), false);
  assert.equal(text.includes("https://app.example"), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(
    await onRequest({
      request: new Request(request.url, { method: "HEAD" }),
      env,
    }).text(),
    "",
  );
});
