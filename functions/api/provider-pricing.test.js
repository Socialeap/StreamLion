import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { hash } from "../../server/google-auth.js";
import {
  handleProviderPricing,
  pricingForConnection,
} from "../../server/provider-pricing.js";
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
    all: async () => ({ results: sql.prepare(q).all(...args) }),
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
    handleProviderPricing({
      env,
      request: new Request("https://app.example/api/provider-pricing", {
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

const { blankPricing } = await import("../../src/provider-pricing.js");
const value = {
  id: "default",
  name: "Capture pricing",
  version: 0,
  config: { ...blankPricing(), method: "area", rate: "0.15" },
};
test("pricing profiles are account/mode scoped, versioned and do not change pilot policy or work records", async (t) => {
  const f = await fixture(t),
    before = f.sql
      .prepare("SELECT * FROM streamlion_coordination_policy_v1")
      .all();
  assert.equal((await f.call(value)).status, 200);
  const own = await (await f.call()).json(),
    other = await (await f.call(null, "b")).json();
  assert.equal(own.profiles[0].version, 1);
  assert.equal(other.profiles.length, 0);
  assert.equal(
    await pricingForConnection(f.env, { google_subject: "a", mode: "live" }),
    null,
  );
  assert.equal((await f.call(value)).status, 409);
  assert.equal(
    (
      await f.call({
        ...value,
        version: 1,
        config: { ...value.config, rate: "0.20" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call({ ...value, version: 2 }, "a", {
        "X-StreamLion-Account": "b",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(value, "a", { Origin: "https://evil.example" })).status,
    403,
  );
  assert.equal((await f.call(null, "a", { Cookie: "" })).status, 401);
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
test("profile validation failure preserves published rates and missing migration fails closed for publishing", async (t) => {
  const f = await fixture(t);
  await f.call(value);
  assert.equal(
    (
      await f.call({
        ...value,
        version: 1,
        config: { ...value.config, rate: "-2" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await pricingForConnection(f.env, { google_subject: "a", mode: "test" }))
      .config.rate,
    "0.15",
  );
  await assert.rejects(
    pricingForConnection(
      f.env,
      { google_subject: "b", mode: "test" },
      "private-profile",
    ),
    /unavailable/,
  );
  f.sql.exec("DROP TABLE streamlion_provider_pricing_v1");
  assert.equal((await (await f.call()).json()).available, false);
  assert.equal((await f.call(value)).status, 503);
});
