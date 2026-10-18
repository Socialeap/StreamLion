import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { hash } from "../../server/google-auth.js";
import { handleProviderSetup } from "../../server/provider-setup.js";
import { answerStep, newSetup } from "../../src/setup-assistant.js";

async function fixture(t, { migrated = true } = {}) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const f of readdirSync(new URL("../../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => migrated || !f.startsWith("0018"))
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
  const call = async (state, subject = "a", headers = {}) => {
    const response = await handleProviderSetup({
      env,
      request: new Request("https://app.example/api/provider-setup", {
        method: state === undefined ? "GET" : "POST",
        headers: {
          Cookie:
            "__Host-streamlion-session=" +
            (subject === "a" ? "A" : "B").repeat(43),
          Origin: env.GOOGLE_AUTH_ORIGIN,
          "Content-Type": "application/json",
          "X-StreamLion-Account": subject,
          ...headers,
        },
        ...(state === undefined ? {} : { body: JSON.stringify({ state }) }),
      }),
    });
    return { status: response.status, ...(await response.json()) };
  };
  return { sql, call };
}
const at = (iso, name) => answerStep(newSetup(iso), "name", name, {}, iso);

test("setup answers are kept per account, and the newest copy wins", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.call(), {
    status: 200,
    subject: "a",
    account: "a@example.com",
    available: true,
    state: null,
  });
  const first = at("2026-10-18T10:00:00.000Z", "Alex");
  assert.equal((await f.call(first)).state.answers.name, "Alex");
  // An older device cannot overwrite newer answers.
  const older = at("2026-10-18T09:00:00.000Z", "Old");
  assert.equal((await f.call(older)).state.answers.name, "Alex");
  const newer = at("2026-10-18T11:00:00.000Z", "Sam");
  assert.equal((await f.call(newer)).state.answers.name, "Sam");
  assert.equal((await f.call()).state.answers.name, "Sam");
  // Another account sees only its own setup.
  assert.equal((await f.call(undefined, "b")).state, null);
});

test("setup saves are checked for account, origin and shape", async (t) => {
  const f = await fixture(t);
  const state = at("2026-10-18T10:00:00.000Z", "Alex");
  assert.equal(
    (await f.call(state, "a", { "X-StreamLion-Account": "b" })).status,
    403,
  );
  assert.equal(
    (await f.call(state, "a", { Origin: "https://evil.example" })).status,
    403,
  );
  assert.equal((await f.call({ version: 2 })).status, 400);
  assert.equal(
    (await f.call({ ...state, answers: { name: "x".repeat(260000) } })).status,
    400,
  );
  const anonymous = await handleProviderSetup({
    env: {
      GOOGLE_AUTH_ORIGIN: "https://app.example",
      GOOGLE_SESSIONS: {
        prepare: () => ({ bind: () => ({ first: async () => null }) }),
      },
    },
    request: new Request("https://app.example/api/provider-setup"),
  });
  assert.equal(anonymous.status, 401);
});

test("before the migration, setup stays on each device", async (t) => {
  const f = await fixture(t, { migrated: false });
  assert.equal((await f.call()).available, false);
  assert.equal(
    (await f.call(at("2026-10-18T10:00:00.000Z", "Alex"))).available,
    false,
  );
});
