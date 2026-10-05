import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "./health.js";
import { extensionFixture } from "../../test/extension-fixture.js";
test("health reports configuration without calling Google, exposing secrets or accepting a missing persistent binding", async () => {
  const request = new Request("https://app.example/api/health");
  assert.equal((await onRequest({ request, env: {} })).status, 503);
  const env = {
    VITE_GOOGLE_CLIENT_ID: "public",
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_CLIENT_SECRET: "private",
    GOOGLE_TOKEN_ENCRYPTION_KEY: "A".repeat(43),
    GOOGLE_AUTH_ORIGIN: "https://app.example",
  };
  assert.equal((await onRequest({ request, env })).status, 503);
  env.GOOGLE_SESSIONS = {};
  assert.equal(
    (
      await onRequest({
        request,
        env: { ...env, GOOGLE_TOKEN_ENCRYPTION_KEY: "bad" },
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await onRequest({
        request,
        env: { ...env, GOOGLE_AUTH_ORIGIN: "http://app.example" },
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await onRequest({
        request,
        env: { ...env, GOOGLE_AUTH_ORIGIN: "https://app.example/" },
      })
    ).status,
    503,
  );
  env.GOOGLE_SESSIONS = {
    prepare: () => ({ first: async () => ({ ready: 1 }) }),
  };
  const response = await onRequest({ request, env });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes("private"), false);
  assert.equal(text.includes("https://app.example"), false);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(
    await (
      await onRequest({
        request: new Request(request.url, { method: "HEAD" }),
        env,
      })
    ).text(),
    "",
  );
});

test("readiness verifies active schema markers without contacting providers or exposing database errors", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("No provider calls allowed");
  });
  for (const missing of [
    null,
    "streamlion_auth_schema_v1",
    "streamlion_google_folder_schema_v1",
    "streamlion_google_request_limits_v1",
    "streamlion_extension_schema_v1",
  ]) {
    const f = await extensionFixture();
    if (missing) f.db.exec(`DROP TABLE ${missing}`);
    const response = await onRequest({
      request: new Request("https://app.example/api/health"),
      env: f.env,
    });
    assert.equal(response.status, missing ? 503 : 200);
    const value = await response.json();
    assert.equal(value.checks.database, missing ? "unavailable" : "ready");
    assert.equal(value.upstreamsChecked, false);
    assert.ok(
      !/provider@example|credentials|no such table|synthetic/.test(
        JSON.stringify(value),
      ),
    );
    f.db.close();
  }
  assert.equal(fetch.mock.callCount(), 0);
});
test("enabled payments require their schema, but disabled payments do not block Core readiness", async () => {
  for (const mode of ["disabled", "test"]) {
    const f = await extensionFixture();
    f.env.STREAMLION_PAYMENTS_MODE = mode;
    f.db.exec("DROP TABLE streamlion_purchase_schema_v2");
    assert.equal(
      (
        await onRequest({
          request: new Request("https://app.example/api/health"),
          env: f.env,
        })
      ).status,
      mode === "disabled" ? 200 : 503,
    );
    f.db.close();
  }
});
test("concurrent readiness probes coalesce and recheck after the short cache expires", async (t) => {
  const f = await extensionFixture();
  let reads = 0,
    now = 100000;
  t.mock.method(Date, "now", () => now);
  const original = f.env.GOOGLE_SESSIONS.prepare;
  f.env.GOOGLE_SESSIONS.prepare = (sql) => {
    reads++;
    return original(sql);
  };
  const check = () =>
    onRequest({
      request: new Request("https://app.example/api/health"),
      env: f.env,
    });
  assert.ok(
    (await Promise.all(Array.from({ length: 20 }, check))).every(
      (r) => r.status === 200,
    ),
  );
  assert.equal(reads, 1);
  f.db.exec("DROP TABLE streamlion_auth_schema_v1");
  now += 30001;
  assert.equal((await check()).status, 503);
  assert.equal(reads, 2);
  assert.equal(
    (
      await onRequest({
        request: new Request("https://app.example/api/health", {
          method: "POST",
        }),
        env: f.env,
      })
    ).status,
    405,
  );
  f.db.close();
});
test("an unavailable or stalled database makes readiness degrade within its probe deadline", async () => {
  const f = await extensionFixture();
  f.env.GOOGLE_SESSIONS = {
    prepare: () => ({ first: () => new Promise(() => {}) }),
  };
  const started = performance.now();
  const response = await onRequest({
    request: new Request("https://app.example/api/health"),
    env: f.env,
  });
  assert.equal(response.status, 503);
  assert.ok(performance.now() - started < 5000);
  assert.equal((await response.json()).checks.database, "unavailable");
  f.db.close();
});
