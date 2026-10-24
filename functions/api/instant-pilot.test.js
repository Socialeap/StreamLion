import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handleFreePilot, pilotAccess } from "../../server/free-pilot.js";
import { hash } from "../../server/google-auth.js";
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
  sql.exec(
    readFileSync(
      new URL("../../migrations/0024_instant_pilot.sql", import.meta.url),
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
    GOOGLE_SESSIONS: { prepare: wrap },
    ENABLE_FREE_PILOT: "true",
    STREAMLION_PAYMENTS_MODE: "live",
    STREAMLION_REQUIRE_LICENSE: "true",
    STREAMLION_CHECKOUT_MODE: "paused",
    GOOGLE_AUTH_ORIGIN: "https://app.example",
  };
  let clock = Date.UTC(2026, 9, 24, 22);
  t.mock.method(Date, "now", () => clock);
  sql
    .prepare(
      "UPDATE streamlion_free_pilot_policy_v1 SET interest_open=1,admissions_open=1,application_start=?,application_end=?,closes_at=? WHERE mode='live'",
    )
    .run(clock - DAY, clock + 30 * DAY, clock + 60 * DAY);
  const has = sql
    .prepare("PRAGMA table_info(streamlion_free_pilot_policy_v1)")
    .all()
    .some((c) => c.name === "admission_mode");
  if (has)
    sql.exec(
      "UPDATE streamlion_free_pilot_policy_v1 SET admission_mode='instant' WHERE mode='live'",
    );
  sql.exec(
    "INSERT INTO streamlion_free_pilot_admins_v1 VALUES('live','owner')",
  );
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
        "fixture",
        clock + 100 * DAY,
      );
  }
  async function req(route, subject = "a", body, headers = {}) {
    await session(subject);
    return handleFreePilot({
      env,
      params: { path: route.split("/") },
      request: new Request("https://app.example/api/free-pilot/" + route, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: "https://app.example",
          "Content-Type": "application/json",
          "X-StreamLion-Account": subject,
          Cookie: "__Host-streamlion-session=" + ids[subject],
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    });
  }
  const form = {
    name: "Provider",
    business: "Capture",
    fit: "Prepare and hand over a capture job.",
    contact: true,
    marketing: false,
    provider: true,
    ready: true,
    terms: "free-pilot-v2",
    durationDays: 14,
  };
  const start = (subject = "a", changes = {}) =>
    req("start", subject, { ...form, ...changes });
  const policy = () =>
    sql
      .prepare(
        "SELECT * FROM streamlion_free_pilot_policy_v1 WHERE mode='live'",
      )
      .get();
  const settings = (changes = {}) => {
    const p = policy();
    return req("admin/settings", "owner", {
      revision: p.revision,
      activeCap: p.active_cap,
      admissionCap: p.admission_cap,
      durationDays: p.duration_days,
      applicationStart: p.application_start,
      applicationEnd: p.application_end,
      closesAt: p.closes_at,
      interestOpen: !!p.interest_open,
      admissionsOpen: !!p.admissions_open,
      admissionMode: p.admission_mode,
      reason: "Owner reviewed settings",
      ...changes,
    });
  };
  return {
    sql,
    env,
    req,
    start,
    form,
    policy,
    settings,
    setClock: (n) => (clock = n),
    clock: () => clock,
  };
}
test("verified participant explicitly starts immediately; retries preserve one clock and one admission", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.start()).status, 200);
  const first = await pilotAccess(f.env, "a");
  assert.equal(first.endsAt - first.startsAt, 14 * DAY);
  f.setClock(f.clock() + 1000);
  assert.equal((await f.start()).status, 200);
  assert.deepEqual(await pilotAccess(f.env, "a"), first);
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM streamlion_free_pilot_accounts_v1 WHERE admitted_at IS NOT NULL",
      )
      .get().n,
    1,
  );
});
test("last-slot race admits one account and records all losing interest without access", async (t) => {
  const f = await fixture(t);
  await f.settings({ activeCap: 1, admissionCap: 1 });
  const rs = await Promise.all(["a", "b", "c"].map((s) => f.start(s)));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  assert.equal(rs.filter((r) => r.status === 409).length, 2);
  for (const r of rs.filter((r) => r.status === 409)) {
    const b = await r.json();
    assert.equal(b.code, "pilot_full");
    assert.equal(b.registered, true);
  }
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_free_pilot_accounts_v1")
      .get().n,
    3,
  );
  const c = await (await f.req("config")).json();
  assert.equal(c.availability, "full");
  assert.equal(c.interestOpen, true);
});
test("instant admission requires provider declaration, terms, readiness and contact consent", async (t) => {
  const f = await fixture(t);
  for (const bad of [
    { provider: false },
    { ready: false },
    { terms: "free-pilot-v1" },
    { contact: false },
  ])
    assert.equal((await f.start("a", bad)).status, 400);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_free_pilot_accounts_v1")
      .get().n,
    0,
  );
  assert.equal(
    (await f.req("start", "a", f.form, { Origin: "https://evil.example" }))
      .status,
    403,
  );
});
test("paused or future windows do not claim full; expired users never get a new trial", async (t) => {
  const f = await fixture(t);
  await f.settings({ admissionsOpen: false });
  assert.equal((await (await f.req("config")).json()).availability, "closed");
  assert.equal((await f.start()).status, 409);
  await f.settings({ admissionsOpen: true });
  await f.start();
  const first = await pilotAccess(f.env, "a");
  f.setClock(first.endsAt);
  assert.equal((await f.start()).status, 409);
  assert.equal(await pilotAccess(f.env, "a"), null);
});
test("administrator controls reject non-admin and stale revisions without changing policy", async (t) => {
  const f = await fixture(t);
  const p = f.policy();
  assert.equal(
    (
      await f.req("admin/pause", "a", {
        revision: p.revision,
        reason: "Attack",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.settings({ activeCap: 2, admissionCap: 3 })).status,
    200,
  );
  assert.equal(
    (await f.settings({ revision: p.revision, activeCap: 1 })).status,
    409,
  );
  assert.equal(f.policy().active_cap, 2);
  assert.equal(f.policy().admission_cap, 3);
});
test("a dated slot release adds only the stated admissions once under concurrent requests", async (t) => {
  const f = await fixture(t);
  await f.settings({ activeCap: 1, admissionCap: 1 });
  await f.start();
  const end = (await pilotAccess(f.env, "a")).endsAt;
  const at = end + 1000;
  assert.equal(
    (
      await f.req("admin/schedule", "owner", {
        revision: f.policy().revision,
        reopenAt: at,
        slots: 2,
        reason: "Next group",
      })
    ).status,
    200,
  );
  f.setClock(at - 1);
  await f.req("config");
  assert.equal(f.policy().admission_cap, 1);
  f.setClock(at);
  await Promise.all(Array.from({ length: 5 }, () => f.req("config")));
  assert.equal(f.policy().admission_cap, 3);
  assert.equal(f.policy().reopen_at, null);
  assert.equal(f.policy().reopen_slots, 0);
  assert.equal((await f.start("b")).status, 200);
  assert.equal((await f.start("c")).status, 409);
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM streamlion_free_pilot_policy_audit_v1 WHERE actor='schedule'",
      )
      .get().n,
    1,
  );
});
test("owner pause cancels reopening; expired window cannot release or promise slots", async (t) => {
  const f = await fixture(t);
  const at = f.clock() + DAY;
  await f.req("admin/schedule", "owner", {
    revision: f.policy().revision,
    reopenAt: at,
    slots: 2,
    reason: "Next group",
  });
  assert.equal(
    (
      await f.req("admin/pause", "owner", {
        revision: f.policy().revision,
        reason: "Hold",
      })
    ).status,
    200,
  );
  f.setClock(at);
  await f.req("config");
  assert.equal(f.policy().admission_cap, 5);
  assert.equal(f.policy().reopen_at, null);
  assert.equal(f.policy().admissions_open, 0);
});
test("invalid settings and schedule cannot exceed cumulative20, erase admissions, or shorten active trials", async (t) => {
  const f = await fixture(t);
  await f.start();
  const grant = await pilotAccess(f.env, "a");
  assert.equal((await f.settings({ activeCap: 21 })).status, 400);
  assert.equal(
    (await f.settings({ applicationEnd: f.clock() - 1 })).status,
    400,
  );
  assert.equal(
    (
      await f.req("admin/schedule", "owner", {
        revision: f.policy().revision,
        reopenAt: f.clock() + DAY,
        slots: 16,
        reason: "Too many",
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.settings({ activeCap: 1, admissionCap: 1 })).status,
    200,
  );
  assert.deepEqual(await pilotAccess(f.env, "a"), grant);
});

const { instantPilotPreflight } =
  await import("../../scripts/preflight-instant-pilot.mjs");
test("migration preflight accepts exact0023 or exact0024 only, rejecting every partial marker", async (t) => {
  const f = await fixture(t);
  const schema = f.sql
    .prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL")
    .all();
  const stamps = {
    streamlion_free_pilot_schema_v1: 1,
    streamlion_free_pilot_instant_schema_v1: 1,
  };
  assert.equal(
    instantPilotPreflight({ schema, stamps }).migration,
    "already_applied",
  );
  for (const row of schema.filter((r) =>
    r.name.startsWith("streamlion_free_pilot_"),
  ))
    assert.throws(
      () =>
        instantPilotPreflight({
          schema: schema.filter((x) => x.name !== row.name),
          stamps,
        }),
      /STOP/,
    );
  const old = new DatabaseSync(":memory:");
  try {
    old.exec(
      readFileSync(
        new URL(
          "../../migrations/0023_controlled_free_pilot.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const before = [
      ...schema.filter((x) => !x.name.startsWith("streamlion_free_pilot_")),
      ...old
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
        )
        .all(),
    ];
    assert.equal(
      instantPilotPreflight({
        schema: before,
        stamps: { streamlion_free_pilot_schema_v1: 1 },
      }).migration,
      "pending",
    );
  } finally {
    old.close();
  }
});
test("paid access remains paid, revoked grants do not restart, and missing instant stamp fails closed", async (t) => {
  const f = await fixture(t);
  await f.start();
  await f.req("admin/revoke", "owner", { subject: "a", reason: "End trial" });
  const r = await f.start();
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "pilot_used");
  f.sql.exec(
    "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES('paid','live','a','a@example.com','price','product',1,'usd','paid',1,2,1)",
  );
  assert.equal(await hasPurchase(f.env, "a"), true);
  assert.equal((await f.start("a")).status, 409);
  assert.equal(await hasPurchase(f.env, "a"), true);
  await f.start("b");
  f.sql.exec("DELETE FROM streamlion_free_pilot_instant_schema_v1");
  assert.equal(await pilotAccess(f.env, "b"), null);
  assert.equal((await f.req("config")).status, 503);
});
test("pause at the exact scheduled instant cancels before applying its own pending release", async (t) => {
  const f = await fixture(t);
  const at = f.clock() + DAY;
  await f.req("admin/schedule", "owner", {
    revision: f.policy().revision,
    reopenAt: at,
    slots: 2,
    reason: "Next group",
  });
  const revision = f.policy().revision;
  f.setClock(at);
  assert.equal(
    (
      await f.req("admin/pause", "owner", {
        revision,
        reason: "Hold before opening",
      })
    ).status,
    200,
  );
  assert.equal(f.policy().admission_cap, 5);
  assert.equal(f.policy().reopen_at, null);
});

test("starting from saved interest stores current profile and optional marketing choice without resetting grants", async (t) => {
  const f = await fixture(t);
  await f.req("apply", "a", { ...f.form, name: "Old name", marketing: true });
  assert.equal(
    (await f.start("a", { name: "New name", marketing: false })).status,
    200,
  );
  const row = f.sql
    .prepare(
      "SELECT name,marketing,starts_at,ends_at FROM streamlion_free_pilot_accounts_v1 WHERE google_subject='a'",
    )
    .get();
  assert.equal(row.name, "New name");
  assert.equal(row.marketing, 0);
  await f.start("a", {
    name: "Do not replace an admitted profile",
    marketing: true,
  });
  assert.deepEqual(
    f.sql
      .prepare(
        "SELECT name,marketing,starts_at,ends_at FROM streamlion_free_pilot_accounts_v1 WHERE google_subject='a'",
      )
      .get(),
    row,
  );
});
test("applied0024 preflight still requires every existing Google and purchase prerequisite", async (t) => {
  const f = await fixture(t);
  const schema = f.sql
      .prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL")
      .all(),
    stamps = {
      streamlion_free_pilot_schema_v1: 1,
      streamlion_free_pilot_instant_schema_v1: 1,
    };
  for (const name of [
    "streamlion_google_sessions_v1",
    "streamlion_google_request_limits_v1",
    "streamlion_purchases_v1",
  ])
    assert.throws(
      () =>
        instantPilotPreflight({
          schema: schema.filter((r) => r.name !== name),
          stamps,
        }),
      /STOP/,
    );
});

test("a stale displayed duration cannot silently start a different-length trial", async (t) => {
  const f = await fixture(t);
  const r = await f.start("a", { durationDays: 7 });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, "pilot_policy_changed");
  assert.equal(await pilotAccess(f.env, "a"), null);
  assert.equal(
    f.sql
      .prepare(
        "SELECT state FROM streamlion_free_pilot_accounts_v1 WHERE google_subject='a'",
      )
      .get().state,
    "applied",
  );
});
