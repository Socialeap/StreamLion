import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { hash } from "../../server/google-auth.js";
import {
  handleProviderBranding,
  brandingForConnection,
} from "../../server/provider-branding.js";
import { validateBranding } from "../../src/provider-branding.js";
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=";
async function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const f of readdirSync(new URL("../../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(
      readFileSync(new URL("../../migrations/" + f, import.meta.url), "utf8"),
    );
  const wrap = (q, args = []) => ({
    bind: (...a) => wrap(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
    run: async () => ({
      meta: { changes: sql.prepare(q).run(...args).changes },
    }),
  });
  const env = {
    GOOGLE_SESSIONS: { prepare: wrap },
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    STREAMLION_PAYMENTS_MODE: "test",
  };
  for (const [token, subject] of [
    ["A".repeat(43), "a"],
    ["B".repeat(43), "b"],
  ])
    sql
      .prepare(
        "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,?,?,?,?)",
      )
      .run(
        await hash(token),
        subject,
        subject + "@example.com",
        "encrypted",
        Date.now() + 86400000,
      );
  const call = (body, subject = "a", headers = {}) =>
    handleProviderBranding({
      env,
      request: new Request("https://app.example/api/provider-branding", {
        method: body ? "POST" : "GET",
        headers: {
          Cookie:
            "__Host-streamlion-session=" +
            (subject === "a" ? "A" : "B").repeat(43),
          Origin: env.GOOGLE_AUTH_ORIGIN,
          "Content-Type": "application/json",
          "X-StreamLion-Account": subject,
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    });
  return { sql, env, call };
}
const profile = {
  name: "Harbor Capture",
  website: "https://example.com/services",
  logo: PNG,
  shape: "rectangle",
};
test("branding is account and mode scoped, versioned, and leaves coordination/records/pilot policy untouched", async (t) => {
  const f = await fixture(t),
    before = f.sql
      .prepare("SELECT * FROM streamlion_coordination_policy_v1")
      .all();
  const request = {
    branding: profile,
    version: 0,
    subject: "b",
    connectionId: "someone-else",
  };
  const response = await f.call(request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, 1);
  const a = await (await f.call()).json(),
    b = await (await f.call(null, "b")).json();
  assert.deepEqual(a.branding, profile);
  assert.equal(b.branding.name, "");
  assert.equal((await f.call(request)).status, 409);
  assert.equal(
    (await f.call({ branding: { ...profile, name: "Updated" }, version: 1 }))
      .status,
    200,
  );
  assert.equal(
    (
      await f.call({ branding: profile, version: 2 }, "a", {
        "X-StreamLion-Account": "b",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call({ branding: profile, version: 2 }, "a", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await f.call(null, "a", { Cookie: "" })).status, 401);
  const live = await brandingForConnection(f.env, {
    google_subject: "a",
    mode: "live",
    client_brand: "Live legacy",
  });
  assert.equal(live.name, "Live legacy");
  assert.deepEqual(
    f.sql.prepare("SELECT * FROM streamlion_coordination_policy_v1").all(),
    before,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_jobs_v1")
      .get().n,
    0,
  );
});
test("reject executable URLs, SVG/truncated/oversized images and preserve saved branding after invalid upload", async (t) => {
  const f = await fixture(t);
  await f.call({ branding: profile, version: 0 });
  for (const website of [
    "javascript:alert(1)",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com\n",
  ]) {
    if (website.endsWith("\n")) continue;
    assert.equal(
      (await f.call({ branding: { ...profile, website }, version: 1 })).status,
      400,
    );
  }
  for (const logo of [
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,AAAA",
    PNG + "AAAA",
    "data:image/png;base64," + "A".repeat(120000),
  ])
    assert.throws(() => validateBranding({ ...profile, logo }));
  assert.deepEqual((await (await f.call()).json()).branding, profile);
});
test("missing branding migration retains legacy identity and fails closed on saves", async (t) => {
  const f = await fixture(t);
  f.sql.exec("DROP TABLE streamlion_provider_branding_v1");
  assert.equal((await (await f.call()).json()).available, false);
  assert.equal((await f.call({ branding: profile, version: 0 })).status, 503);
  assert.equal(
    (
      await brandingForConnection(f.env, {
        google_subject: "a",
        mode: "test",
        client_brand: "Original Provider",
      })
    ).name,
    "Original Provider",
  );
});
