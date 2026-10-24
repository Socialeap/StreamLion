import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleFreePilot, pilotAccess } from "../../server/free-pilot.js";
import {
  hash,
  handleGoogle,
  googleReturnPath,
} from "../../server/google-auth.js";
import { hasPurchase } from "../../server/purchase-access.js";

const DAY = 86400000;
async function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const n of [
    "0001_google_sessions",
    "0002_google_request_limits",
    "0003_google_workspace_folder",
    "0004_streamlion_purchases",
    "0023_controlled_free_pilot",
  ])
    sql.exec(
      readFileSync(
        new URL(`../../migrations/${n}.sql`, import.meta.url),
        "utf8",
      ),
    );
  const wrap = (q, v = []) => ({
    bind: (...a) => wrap(q, a),
    first: async () => sql.prepare(q).get(...v) || null,
    all: async () => ({ results: sql.prepare(q).all(...v) }),
    run: async () => ({ meta: { changes: sql.prepare(q).run(...v).changes } }),
  });
  const env = {
    ENABLE_FREE_PILOT: "true",
    GOOGLE_SESSIONS: { prepare: wrap },
    STREAMLION_PAYMENTS_MODE: "live",
    STREAMLION_REQUIRE_LICENSE: "true",
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_CLIENT_SECRET: "fixture",
    VITE_GOOGLE_CLIENT_ID: "fixture",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
  };
  const now = Date.now();
  sql
    .prepare(
      "UPDATE streamlion_free_pilot_policy_v1 SET interest_open=1,admissions_open=1,application_start=?,application_end=?,closes_at=? WHERE mode=?",
    )
    .run(now - DAY, now + 30 * DAY, now + 60 * DAY, "live");
  sql
    .prepare("INSERT INTO streamlion_free_pilot_admins_v1 VALUES(?,?)")
    .run("live", "admin");
  const ids = {};
  async function session(subject) {
    if (ids[subject]) return;
    ids[subject] = Buffer.from(subject.padEnd(32, "x")).toString("base64url");
    sql
      .prepare(
        "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,?,?,?,?)",
      )
      .run(
        await hash(ids[subject]),
        subject,
        subject + "@example.com",
        "unused",
        Date.now() + DAY,
      );
  }
  async function req(route, subject = "a", body, extra = {}) {
    await session(subject);
    return handleFreePilot({
      env,
      params: { path: route.split("/") },
      request: new Request("https://app.example/api/free-pilot/" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: "__Host-streamlion-session=" + ids[subject],
          Origin: "https://app.example",
          "X-StreamLion-Account": subject,
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    });
  }
  const apply = async (s = "a") =>
    req("apply", s, {
      name: "Provider",
      business: "Spatial capture",
      fit: "I prepare and hand over capture jobs.",
      contact: true,
      marketing: false,
    });
  const admit = async (s = "a") => {
    await apply(s);
    assert.equal(
      (
        await req("admin/approve", "admin", {
          subject: s,
          reason: "Owner selected fit",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await req("admin/invite", "admin", {
          subject: s,
          reason: "Ready for account invitation",
        })
      ).status,
      200,
    );
  };
  const activate = async (s = "a") =>
    req("activate", s, { ready: true, terms: "free-pilot-v1" });
  return { sql, env, req, apply, admit, activate, ids, session };
}

test("disabled pilot touches no database and opens no entry", async () => {
  const env = {
    GOOGLE_SESSIONS: {
      prepare() {
        throw Error("must not query");
      },
    },
  };
  const r = await handleFreePilot({
    env,
    params: { path: ["config"] },
    request: new Request("https://app.example/api/free-pilot/config"),
  });
  assert.deepEqual(await r.json(), { enabled: false });
  assert.equal(await pilotAccess(env, "a"), null);
});
test("applications never grant access; duplicate applications cannot reset admission", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.apply()).status, 200);
  assert.equal((await f.apply()).status, 200);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_free_pilot_accounts_v1")
      .get().n,
    1,
  );
  assert.equal(await pilotAccess(f.env, "a"), null);
  await f.admit();
  await f.apply();
  assert.equal((await (await f.req("status")).json()).state, "invited");
  assert.equal(await pilotAccess(f.env, "a"), null);
});
test("only explicit account-bound activation starts a durable clock; retries and reconnection do not restart it", async (t) => {
  const f = await fixture(t);
  await f.admit();
  assert.equal((await f.activate("b")).status, 409);
  assert.equal(
    (await f.req("activate", "a", { ready: false, terms: "free-pilot-v1" }))
      .status,
    400,
  );
  assert.equal((await f.activate()).status, 200);
  const first = await pilotAccess(f.env, "a");
  assert(first.endsAt - first.startsAt === 14 * DAY);
  await f.activate();
  assert.deepEqual(await pilotAccess(f.env, "a"), first);
  f.sql.prepare("DELETE FROM streamlion_google_sessions_v1").run();
  delete f.ids.a;
  await f.session("a");
  assert.deepEqual(await pilotAccess(f.env, "a"), first);
});
test("final-slot approval and activation retries cannot exceed capacity or cumulative admissions", async (t) => {
  const f = await fixture(t);
  f.sql.exec(
    "UPDATE streamlion_free_pilot_policy_v1 SET active_cap=1,admission_cap=1 WHERE mode='live'",
  );
  await f.apply("a");
  await f.apply("b");
  const rs = await Promise.all(
    ["a", "b"].map((subject) =>
      f.req("admin/approve", "admin", { subject, reason: "Fit" }),
    ),
  );
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  const winner = f.sql
    .prepare(
      "SELECT google_subject FROM streamlion_free_pilot_accounts_v1 WHERE state='approved'",
    )
    .get().google_subject;
  await f.req("admin/invite", "admin", { subject: winner, reason: "Invite" });
  const activations = await Promise.all([
    f.activate(winner),
    f.activate(winner),
  ]);
  assert(activations.every((r) => r.status === 200));
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM streamlion_free_pilot_accounts_v1 WHERE state='active'",
      )
      .get().n,
    1,
  );
  await f.req("admin/revoke", "admin", { subject: winner, reason: "Complete" });
  assert.equal(
    (
      await f.req("admin/approve", "admin", {
        subject: winner === "a" ? "b" : "a",
        reason: "Replacement",
      })
    ).status,
    409,
  );
  assert.equal((await f.apply("c")).status, 200);
});
test("origin/account checks, administrator authorization and expired invitations fail closed", async (t) => {
  const f = await fixture(t);
  await f.admit();
  assert.equal((await f.req("admin/list", "b")).status, 403);
  assert.equal(
    (await f.req("admin/revoke", "b", { subject: "a", reason: "Attack" }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.req(
        "activate",
        "a",
        { ready: true, terms: "free-pilot-v1" },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.req(
        "activate",
        "a",
        { ready: true, terms: "free-pilot-v1" },
        { "X-StreamLion-Account": "b" },
      )
    ).status,
    403,
  );
  f.sql.exec(
    "UPDATE streamlion_free_pilot_accounts_v1 SET invite_until=1 WHERE google_subject='a'",
  );
  assert.equal((await f.activate()).status, 409);
  assert.equal(await pilotAccess(f.env, "a"), null);
});
test("expiry is exclusive and does not create or revoke paid purchases", async (t) => {
  const f = await fixture(t);
  await f.admit();
  await f.activate();
  const a = await pilotAccess(f.env, "a");
  assert(await pilotAccess(f.env, "a", a.endsAt - 1));
  assert.equal(await pilotAccess(f.env, "a", a.endsAt), null);
  assert.equal(await hasPurchase(f.env, "a"), false);
  f.sql.exec(
    "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES('paid','live','a','a@example.com','price','product',1,'usd','paid',1,2,1)",
  );
  await f.req("admin/revoke", "admin", { subject: "a", reason: "End pilot" });
  assert.equal(await hasPurchase(f.env, "a"), true);
});
test("extension is explicit, audited, bounded and never revives expired access", async (t) => {
  const f = await fixture(t);
  await f.admit();
  await f.activate();
  const a = await pilotAccess(f.env, "a");
  assert.equal(
    (
      await f.req("admin/extend", "admin", {
        subject: "a",
        endsAt: a.endsAt + 8 * DAY,
        reason: "Extra",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.req("admin/extend", "admin", {
        subject: "a",
        endsAt: a.endsAt + DAY,
        reason: "One extra day",
      })
    ).status,
    200,
  );
  assert.equal((await pilotAccess(f.env, "a")).endsAt, a.endsAt + DAY);
  assert(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM streamlion_free_pilot_audit_v1 WHERE action='extend'",
      )
      .get().n === 1,
  );
  f.sql.exec(
    "UPDATE streamlion_free_pilot_accounts_v1 SET starts_at=0,ends_at=1 WHERE google_subject='a'",
  );
  assert.equal(
    (
      await f.req("admin/extend", "admin", {
        subject: "a",
        endsAt: a.endsAt + 2 * DAY,
        reason: "Too late",
      })
    ).status,
    409,
  );
});
test("unapproved policy, unavailable schema and closed dates cannot admit or activate", async (t) => {
  const f = await fixture(t);
  await f.apply();
  f.sql.exec(
    "UPDATE streamlion_free_pilot_policy_v1 SET admissions_open=0 WHERE mode='live'",
  );
  assert.equal(
    (await f.req("admin/approve", "admin", { subject: "a", reason: "Fit" }))
      .status,
    409,
  );
  f.sql.exec(
    "UPDATE streamlion_free_pilot_policy_v1 SET admissions_open=1,application_start=0,application_end=1,closes_at=2 WHERE mode='live'",
  );
  assert.equal(
    (await f.req("admin/approve", "admin", { subject: "a", reason: "Fit" }))
      .status,
    409,
  );
  assert.equal((await f.apply("b")).status, 200);
  f.sql.exec(
    "PRAGMA foreign_keys=OFF; DROP TABLE streamlion_free_pilot_policy_v1",
  );
  assert.equal((await f.req("config")).status, 503);
  assert.equal(await pilotAccess(f.env, "a"), null);
});
test("Google writes require active Core access; expired accounts retain reads for retrieval", async (t) => {
  const f = await fixture(t);
  await f.admit();
  await f.activate();
  const request = (method) =>
    handleGoogle({
      env: f.env,
      params: { path: ["picker-token"] },
      request: new Request("https://app.example/api/google/picker-token", {
        method,
        headers: {
          Origin: "https://app.example",
          Cookie: "__Host-streamlion-session=" + f.ids.a,
          "X-StreamLion-Account": "a",
        },
      }),
    });
  f.sql.exec(
    "UPDATE streamlion_free_pilot_accounts_v1 SET starts_at=0,ends_at=1 WHERE google_subject='a'",
  );
  assert.equal((await request("POST")).status, 402);
  assert.equal(googleReturnPath("/pilot/", f.env), "/pilot/");
});

const { freePilotPreflight } =
  await import("../../scripts/preflight-free-pilot.mjs");
test("migration preflight accepts only entirely absent or exactly applied pilot schema and rejects partial state", async (t) => {
  const f = await fixture(t);
  const schema = f.sql
    .prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL")
    .all();
  const stamps = { streamlion_free_pilot_schema_v1: 1 };
  assert.equal(
    freePilotPreflight({ schema, stamps }).migration,
    "already_applied",
  );
  assert.equal(
    freePilotPreflight({
      schema: schema.filter(
        (r) => !r.name.startsWith("streamlion_free_pilot_"),
      ),
      stamps: {},
    }).migration,
    "pending",
  );
  for (const item of schema.filter((r) =>
    r.name.startsWith("streamlion_free_pilot_"),
  ))
    assert.throws(
      () =>
        freePilotPreflight({
          schema: schema.filter((r) => r.name !== item.name),
          stamps,
        }),
      /STOP/,
    );
  assert.throws(
    () =>
      freePilotPreflight({
        schema,
        stamps: { streamlion_free_pilot_schema_v1: 0 },
      }),
    /STOP/,
  );
});
test("full active/cumulative capacity changes public copy to interest list while still accepting applications", async (t) => {
  const f = await fixture(t);
  f.sql.exec(
    "UPDATE streamlion_free_pilot_policy_v1 SET active_cap=1,admission_cap=1 WHERE mode='live'",
  );
  await f.admit();
  let c = await (await f.req("config")).json();
  assert.equal(c.applicationsOpen, false);
  assert.equal(c.interestOpen, true);
  assert.equal((await f.apply("b")).status, 200);
  await f.activate();
  const list = await (await f.req("admin/list", "admin")).json();
  assert.equal(list.counts.applications, 2);
  assert.equal(list.counts.admissions, 1);
  assert.equal(list.counts.active, 1);
});
test("unverified/missing session, oversized input and cross-account requests cannot apply or activate", async (t) => {
  const f = await fixture(t);
  await f.session("a");
  f.sql.exec("DELETE FROM streamlion_google_sessions_v1");
  assert.equal((await f.apply()).status, 401);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_free_pilot_accounts_v1")
      .get().n,
    0,
  );
  delete f.ids.a;
  assert.equal(
    (
      await f.req("apply", "a", {
        name: "Provider",
        business: "",
        fit: "x".repeat(5000),
        contact: true,
        marketing: false,
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await f.req("apply", "a", {
        name: "Provider",
        business: "",
        fit: "Fit",
        contact: false,
        marketing: false,
      })
    ).status,
    400,
  );
});
test("active Core can obtain its existing Google token, expired Core can only read and keeps all data", async (t) => {
  const f = await fixture(t);
  await f.admit();
  await f.activate();
  const { seal } = await import("../../server/google-auth.js");
  const sessionHash = await hash(f.ids.a);
  f.sql
    .prepare(
      "UPDATE streamlion_google_sessions_v1 SET credentials=? WHERE session_hash=?",
    )
    .run(
      await seal(
        f.env,
        { accessToken: "fixture-token", expiresAt: Date.now() + 86400000 },
        sessionHash,
      ),
      sessionHash,
    );
  const google = (route, method = "GET") =>
    handleGoogle({
      env: f.env,
      params: { path: [route] },
      request: new Request(
        "https://app.example/api/google/" +
          route +
          "?path=" +
          encodeURIComponent("/book"),
        {
          method,
          headers: {
            Origin: "https://app.example",
            Cookie: "__Host-streamlion-session=" + f.ids.a,
            "X-StreamLion-Account": "a",
          },
        },
      ),
    });
  assert.equal((await google("picker-token", "POST")).status, 200);
  f.sql.exec(
    "UPDATE streamlion_free_pilot_accounts_v1 SET starts_at=0,ends_at=1 WHERE google_subject='a'",
  );
  let upstream = 0;
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    upstream++;
    assert.equal(
      String(url),
      "https://sheets.googleapis.com/v4/spreadsheets/book",
    );
    assert.equal(opts.method, "GET");
    return new Response('{"spreadsheetId":"book","sheets":[]}');
  });
  assert.equal((await google("sheets")).status, 200);
  assert.equal(upstream, 1);
  assert.equal((await google("sheets", "POST")).status, 402);
  assert.equal((await google("picker-token", "POST")).status, 402);
  assert.equal(upstream, 1);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_google_sessions_v1").get()
      .n,
    2,
  );
});
test("free pilot cannot unlock legacy AI even when purchase enforcement is disabled", async (t) => {
  const f = await fixture(t);
  await f.admit();
  await f.activate();
  Object.assign(f.env, {
    ENABLE_AI_PILOT: "true",
    OPENAI_API_KEY: "synthetic",
    DEEPINFRA_API_KEY: "synthetic",
    STREAMLION_REQUIRE_LICENSE: "false",
  });
  const { handleAI } = await import("../../server/ai-pilot.js");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("No provider calls permitted");
  });
  const r = await handleAI({
    env: f.env,
    request: new Request("https://app.example/api/ai/answer", {
      method: "POST",
      headers: {
        Origin: "https://app.example",
        Cookie: "__Host-streamlion-session=" + f.ids.a,
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  });
  assert.equal(r.status, 402);
  assert.equal(calls, 0);
});
test("closing or malformed policy never promises admission, default migration is fully dormant", async (t) => {
  const f = await fixture(t);
  f.sql.exec(
    "UPDATE streamlion_free_pilot_policy_v1 SET application_start=NULL WHERE mode='live'",
  );
  assert.equal((await (await f.req("config")).json()).applicationsOpen, false);
  const testPolicy = f.sql
    .prepare("SELECT * FROM streamlion_free_pilot_policy_v1 WHERE mode='test'")
    .get();
  assert.equal(testPolicy.interest_open, 0);
  assert.equal(testPolicy.admissions_open, 0);
  assert.equal(testPolicy.active_cap, 5);
  assert.equal(testPolicy.admission_cap, 5);
  assert.equal(testPolicy.duration_days, 14);
  assert.equal(testPolicy.closes_at, null);
});

test("an activated account fails closed when its pilot policy or version stamp is missing", async (t) => {
  const f = await fixture(t);
  await f.admit();
  await f.activate();
  assert(await pilotAccess(f.env, "a"));
  f.sql.exec("DELETE FROM streamlion_free_pilot_schema_v1");
  assert.equal(await pilotAccess(f.env, "a"), null);
  f.sql.exec("INSERT INTO streamlion_free_pilot_schema_v1 VALUES(1)");
  assert(await pilotAccess(f.env, "a"));
  f.sql.exec(
    "UPDATE streamlion_free_pilot_policy_v1 SET admissions_open=0 WHERE mode='live'",
  );
  assert(
    await pilotAccess(f.env, "a"),
    "Closing admissions must preserve active access",
  );
  f.sql.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM streamlion_free_pilot_policy_v1 WHERE mode='live'",
  );
  assert.equal(await pilotAccess(f.env, "a"), null);
});

for (const [label, windowDays, closingDays, expectedHours] of [
  ["admission window", 1 / 24, 60, 1],
  ["overall closing date minus the trial duration", 1, 14 + 1 / 24, 1],
  ["48-hour maximum", 30, 60, 48],
]) {
  test(`invitation deadline respects ${label} and matches the exclusive activation boundary`, async (t) => {
    let now = Date.UTC(2026, 9, 24, 20);
    t.mock.method(Date, "now", () => now);
    const f = await fixture(t);
    f.sql
      .prepare(
        "UPDATE streamlion_free_pilot_policy_v1 SET application_end=?,closes_at=? WHERE mode='live'",
      )
      .run(now + windowDays * DAY, now + closingDays * DAY);
    await f.admit("a");
    await f.admit("b");
    const deadline = now + expectedHours * 3600000;
    const invited = await (await f.req("status", "a")).json();
    assert.equal(invited.inviteUntil, deadline);
    assert.equal(invited.state, "invited");
    f.sql
      .prepare("UPDATE streamlion_google_sessions_v1 SET expires_at=?")
      .run(deadline + DAY);
    now = deadline - 1;
    assert.equal((await f.activate("a")).status, 200);
    now = deadline;
    assert.equal((await f.activate("b")).status, 409);
    const expired = await (await f.req("status", "b")).json();
    assert.equal(expired.state, "invitation_expired");
    assert.equal(expired.active, false);
    assert.equal(await pilotAccess(f.env, "b"), null);
  });
}
