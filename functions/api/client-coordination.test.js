import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { hash, seal } from "../../server/google-auth.js";
import { unseal } from "../../server/google-auth.js";
import { maintainCoordination } from "../../server/coordination-maintenance.js";
import { queueNotice } from "../../server/coordination-engine.js";
import { coordinationPreflight } from "../../scripts/preflight-coordination.mjs";
import {
  reserveCreditTurn,
  finishCreditTurn,
  creditAccount,
} from "../../server/ai-credit-ledger.js";
import { handleCoordination } from "../../server/client-coordination.js";
import { CoordinationEngine } from "../../server/coordination-engine.js";
import { CoordinationGoogle } from "../../server/coordination-google.js";
import {
  beginRead,
  finishRead,
  coordinationRuntime,
} from "../../server/coordination-runtime.js";
import {
  grantStarter,
  reserveProject,
  finishProject,
  sharedWallet,
} from "../../server/shared-credits.js";
import {
  newClientJob,
  reduceClientJob,
  stableJSON,
} from "../../src/client-workflow.js";
function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  for (const f of readdirSync(new URL("../../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(
      readFileSync(new URL("../../migrations/" + f, import.meta.url), "utf8"),
    );
  t.after(() => sql.close());
  const wrap = (q, args = []) => ({
    bind: (...a) => wrap(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({
      meta: { changes: sql.prepare(q).run(...args).changes },
    }),
    sync: () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }),
  });
  const db = {
    prepare: wrap,
    batch: async (list) => {
      sql.exec("BEGIN");
      try {
        const results = list.map((s) => s.sync());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = {
    GOOGLE_SESSIONS: db,
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    ENABLE_CLIENT_COORDINATION: "true",
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_CLIENT_SECRET: "synthetic",
    VITE_GOOGLE_CLIENT_ID: "synthetic",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    STREAMLION_PAYMENTS_MODE: "test",
    STREAMLION_AI_CREDITS_MODE: "test",
    COORDINATION_MAILER: {
      fetch: async () => {
        throw new Error("not invoked");
      },
    },
  };
  sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='test'",
  );
  const purchase = (subject) =>
    sql
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES(?,'test',?,'synthetic@example.com','price','product',3995,'usd','paid',1,9999999999999,1)",
      )
      .run("purchase-" + subject, subject);
  purchase("a");
  purchase("b");
  const connection = {
    id: "connection-a",
    google_subject: "a",
    mode: "test",
    workbook_id: "book-a",
    folder_id: "folder-a",
    credentials: "encrypted",
    client_brand: "Provider",
    expires_at: Date.now() + 86400000,
    revoked: 0,
  };
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at,revoked) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(...Object.values(connection));
  return { sql, db, env, purchase, connection };
}
function googleFixture() {
  const events = new Map(),
    heads = new Map(),
    revisions = [];
  return {
    events,
    heads,
    revisions,
    failProjection: false,
    snapshot: async () => ({
      events,
      heads,
      projects: { heads: revisions.slice(-1), revisions },
      notes: { heads: [], revisions: [] },
    }),
    async event(event) {
      const existing = events.get(event.id);
      if (existing) {
        assert.equal(stableJSON(existing), stableJSON(event));
        return;
      }
      assert.equal(heads.get(event.jobId)?.revision ?? -1, event.parent);
      events.set(event.id, event);
      heads.set(event.jobId, structuredClone(event.job));
    },
    async projection(revision) {
      if (this.failProjection) throw new Error("synthetic timeout");
      if (
        revision &&
        !revisions.some((r) => r.revisionId === revision.revisionId)
      )
        revisions.push(revision);
    },
  };
}
test("public availability exposes only readiness and never treats the restricted pilot as public", async (t) => {
  const { env, sql } = fixture(t);
  const originalClock = Date.now;
  let now = originalClock();
  Date.now = () => now;
  t.after(() => {
    Date.now = originalClock;
  });
  const read = () =>
    handleCoordination({
      request: new Request("https://app.example/api/coordination/availability"),
      env,
      params: { path: ["availability"] },
    });
  const response = await read();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  assert.deepEqual(await response.json(), {
    enabled: true,
    public: false,
    status: "pilot",
  });
  delete env.COORDINATION_MAILER;
  assert.deepEqual(await (await read()).json(), {
    enabled: true,
    public: false,
    status: "delivery_paused",
  });
  env.STREAMLION_PAYMENTS_MODE = "live";
  env.STREAMLION_AI_CREDITS_MODE = "live";
  sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='live'",
  );
  assert.deepEqual(await (await read()).json(), {
    enabled: true,
    public: false,
    status: "delivery_paused",
  });
  Object.assign(env, {
    ENABLE_RESEND_EMAIL: "true",
    RESEND_API_KEY: "synthetic",
    RESEND_FROM_EMAIL: "provider@example.com",
    RESEND_DAILY_LIMIT: "10",
    RESEND_MONTHLY_LIMIT: "100",
  });
  assert.deepEqual(await (await read()).json(), {
    enabled: true,
    public: true,
    status: "available",
  });
  env.STREAMLION_PAYMENTS_MODE = "test";
  env.STREAMLION_AI_CREDITS_MODE = "test";
  sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=0 WHERE mode='test'",
  );
  now += 30001;
  assert.deepEqual(await (await read()).json(), {
    enabled: false,
    public: false,
    status: "paused",
  });
});
test("public readiness coalesces visitors but never caches a private authorization decision", async (t) => {
  const { env, sql, db } = fixture(t);
  let queries = 0;
  env.GOOGLE_SESSIONS = {
    prepare(query) {
      queries++;
      return db.prepare(query);
    },
  };
  const read = (path = "availability") =>
    handleCoordination({
      request: new Request("https://app.example/api/coordination/" + path),
      env,
      params: { path: [path] },
    });
  const responses = await Promise.all(Array.from({ length: 20 }, () => read()));
  assert.equal(queries, 4);
  for (const response of responses)
    assert.equal((await response.json()).status, "pilot");
  sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=0 WHERE mode='test'",
  );
  assert.equal((await (await read()).json()).status, "pilot");
  assert.equal((await read("provider/status")).status, 503);
  env.GOOGLE_SESSIONS = {
    prepare: () => ({
      first: async () => {
        throw new Error("unavailable");
      },
    }),
  };
  assert.deepEqual(await (await read()).json(), {
    enabled: false,
    public: false,
    status: "paused",
  });
});
async function authorizedClient(f, jobId = "job-a") {
  const token = "x".repeat(43),
    now = Date.now();
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES(?,?,?,?,?)",
    )
    .run(
      jobId,
      f.connection.id,
      jobId,
      await seal(f.env, "client@example.com", "job-email:" + jobId),
      now,
    );
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) VALUES(?,?,?)",
    )
    .run(await hash(token), jobId, now + 86400000);
  return (route = "client/job", body, query = "") =>
    handleCoordination({
      env: f.env,
      params: { path: route.split("/") },
      request: new Request(
        "https://app.example/api/coordination/" + route + query,
        {
          headers: {
            Cookie: "__Host-streamlion-client=" + token,
            ...(body
              ? {
                  Origin: "https://app.example",
                  "Content-Type": "application/json",
                }
              : {}),
          },
          ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
        },
      ),
    });
}
test("conditional reads skip Google, reconcile external edits and recheck revoked grants", async (t) => {
  const f = fixture(t),
    call = await authorizedClient(f);
  delete f.env.COORDINATION_MAILER;
  const google = googleFixture();
  let job = newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Office",
    now: 1,
  });
  google.heads.set(job.id, job);
  let reads = 0;
  t.mock.method(CoordinationGoogle.prototype, "snapshot", async () => {
    reads++;
    return { ...(await google.snapshot()), rows: [[], [], [], []] };
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("no external transport");
  });
  const initial = await call();
  assert.equal(initial.status, 200);
  const data = await initial.json(),
    query = "?refresh=" + data.refresh.token;
  assert.equal(
    (await (await call("client/job", null, query)).json()).unchanged,
    true,
  );
  assert.equal(reads, 1);
  job = { ...job, fields: { ...job.fields, title: "Externally refreshed" } };
  google.heads.set(job.id, job);
  f.sql.exec(
    "UPDATE streamlion_coordination_reads_v1 SET verified_at=verified_at-60001",
  );
  const refreshed = await (await call("client/job", null, query)).json();
  assert.equal(refreshed.job.fields.title, "Externally refreshed");
  assert.notEqual(refreshed.refresh.token, data.refresh.token);
  assert.equal(reads, 2);
  // Another viewer's full reconciliation must also invalidate our old token.
  assert.equal(
    (await (await call("client/job", null, query)).json()).job.fields.title,
    "Externally refreshed",
  );
  assert.equal(reads, 3);
  f.sql.exec("UPDATE streamlion_coordination_sessions_v1 SET revoked=1");
  assert.equal((await call("client/job", null, query)).status, 401);
  assert.equal(reads, 3);
});
test("email outage preserves verified saves but creates no new verification challenge", async (t) => {
  const f = fixture(t),
    call = await authorizedClient(f),
    google = googleFixture();
  delete f.env.COORDINATION_MAILER;
  google.heads.set(
    "job-a",
    newClientJob({
      id: "job-a",
      provider: "a",
      clientEmail: "client@example.com",
      title: "Office",
      now: 1,
    }),
  );
  for (const method of ["snapshot", "event", "projection"])
    t.mock.method(CoordinationGoogle.prototype, method, (...args) =>
      google[method](...args),
    );
  const before = await sharedWallet(f.db, "test", "a");
  const saved = await call("client/command", {
    operation: "outage-edit",
    command: {
      action: "edit",
      expectedRevision: 0,
      fields: { scope: "Lobby only" },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(google.heads.get("job-a").fields.scope, "Lobby only");
  assert.deepEqual(await sharedWallet(f.db, "test", "a"), before);
  assert.equal(
    (
      await call("client/request", {
        jobId: "job-a",
        email: "client@example.com",
      })
    ).status,
    503,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_coordination_challenges_v1")
      .get().n,
    0,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_coordination_outbox_v1")
      .get().n,
    1,
  );
});
test("change markers cannot hide a mutation concurrent with a full read", async (t) => {
  // The client scope is allocated only for actual coordination jobs, never every field note.
  const f = fixture(t),
    request = new Request("https://app.example/api/coordination/provider/jobs");
  await authorizedClient(f);
  const before = await beginRead(f.env, f.connection, "", request, {}, 1000);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES('op',?,'job-a','provider','fingerprint','encrypted',1)",
    )
    .run(f.connection.id);
  await finishRead(f.env, f.connection, "", before, {
    rows: [Array(8001), [], [], []],
  });
  const after = await beginRead(
    f.env,
    f.connection,
    "",
    new Request(request.url + "?refresh=" + before.refresh.token),
    {},
    1001,
  );
  assert.equal(after.unchanged, false);
  assert.notEqual(after.refresh.token, before.refresh.token);
  const job = await beginRead(f.env, f.connection, "job-a", request, {}, 1001);
  f.sql.exec(
    "UPDATE streamlion_coordination_operations_v1 SET state='complete',completed_at=2 WHERE id='op'",
  );
  assert.notEqual(
    (await beginRead(f.env, f.connection, "job-a", request, {}, 1002)).refresh
      .token,
    job.refresh.token,
  );
  assert.equal(
    (
      await beginRead(
        f.env,
        { ...f.connection, id: "other" },
        "",
        request,
        {},
        1002,
      )
    ).unchanged,
    false,
  );
  const metadata = f.sql
    .prepare("SELECT * FROM streamlion_coordination_reads_v1")
    .get();
  assert.ok(!JSON.stringify(metadata).includes("scope"));
  assert.equal(
    coordinationRuntime({ COORDINATION_RECONCILE_SECONDS: "999999" })
      .reconcileMs,
    60000,
  );
});
test("idle maintenance avoids Google and cleans hourly; failed recovery backs off without releasing its writer", async (t) => {
  const f = fixture(t);
  delete f.env.COORDINATION_MAILER;
  let batches = 0,
    runs = 0;
  const batch = f.db.batch;
  f.db.batch = async (...args) => {
    batches++;
    return batch(...args);
  };
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("no idle Google calls");
  });
  const now = Date.now();
  await maintainCoordination(f.env, now);
  await maintainCoordination(f.env, now + 1000);
  assert.equal(batches, 1);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES('retry',?,'job-a','provider','x','encrypted',1)",
    )
    .run(f.connection.id);
  t.mock.method(CoordinationEngine.prototype, "run", async () => {
    runs++;
    throw new Error("synthetic failure");
  });
  await maintainCoordination(f.env, now + 2000);
  await maintainCoordination(f.env, now + 3000);
  assert.equal(runs, 1);
  await maintainCoordination(f.env, now + 62000);
  await maintainCoordination(f.env, now + 63000);
  assert.equal(runs, 2);
  assert.equal(
    f.sql
      .prepare(
        "SELECT state FROM streamlion_coordination_operations_v1 WHERE id='retry'",
      )
      .get().state,
    "pending",
  );
  assert.throws(
    () =>
      f.sql
        .prepare(
          "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES('conflict',?,'job-a','provider','x','encrypted',1)",
        )
        .run(f.connection.id),
    /UNIQUE/,
  );
  await maintainCoordination(f.env, now + 3600000);
  assert.equal(batches, 2);
});
test("already reminded projects do not starve subsequent archive reminders", async (t) => {
  const f = fixture(t);
  delete f.env.COORDINATION_MAILER;
  const now = Date.now();
  for (let i = 0; i < 12; i++) {
    const id = "reminder-" + i;
    f.sql
      .prepare(
        "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at,archive_at,closed_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        f.connection.id,
        id,
        await seal(f.env, "client@example.com", "job-email:" + id),
        now,
        now + 86400000,
        now,
      );
  }
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("no sends while paused");
  });
  assert.equal((await maintainCoordination(f.env, now)).reminders, 10);
  assert.equal((await maintainCoordination(f.env, now + 1000)).reminders, 2);
  assert.equal((await maintainCoordination(f.env, now + 2000)).reminders, 0);
});
test("0011 exact preflight accepts pending/applied and rejects partial, altered or unstamped state", (t) => {
  const f = fixture(t);
  const schema = f.sql
    .prepare(
      "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL",
    )
    .all();
  const stamps = Object.fromEntries(
    schema
      .filter((r) => r.name.includes("_schema_"))
      .map((r) => [
        r.name,
        f.sql.prepare("SELECT version FROM " + r.name).get().version,
      ]),
  );
  const target = "0011_coordination_efficiency.sql";
  const result = coordinationPreflight({ schema, stamps }, target);
  assert.equal(result.migration, "already_applied");
  assert.equal(
    coordinationPreflight(
      {
        schema: schema.filter((r) => !result.newMarkers.includes(r.name)),
        stamps,
      },
      target,
    ).migration,
    "pending",
  );
  assert.throws(
    () =>
      coordinationPreflight(
        {
          schema: schema.filter(
            (r) => r.name !== "streamlion_coordination_pending_v1",
          ),
          stamps,
        },
        target,
      ),
    /Partial/,
  );
  assert.throws(
    () =>
      coordinationPreflight(
        {
          schema: schema.map((r) =>
            r.name === "streamlion_coordination_pending_v1"
              ? { ...r, sql: r.sql.replace("created_at", "completed_at") }
              : r,
          ),
          stamps,
        },
        target,
      ),
    /Schema mismatch/,
  );
  assert.throws(
    () =>
      coordinationPreflight(
        {
          schema,
          stamps: {
            ...stamps,
            streamlion_coordination_efficiency_schema_v1: 2,
          },
        },
        target,
      ),
    /stamp mismatch/,
  );
});
test("provider conditional reads remain account-scoped and email outage blocks creation before writes", async (t) => {
  const f = fixture(t),
    token = "p".repeat(43),
    now = Date.now();
  delete f.env.COORDINATION_MAILER;
  f.sql
    .prepare(
      "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at,workbook_id,folder_id) VALUES(?,'a','a@example.com','encrypted',?,'book-a','folder-a')",
    )
    .run(await hash(token), now + 86400000);
  let reads = 0;
  t.mock.method(CoordinationGoogle.prototype, "snapshot", async () => {
    reads++;
    return { ...(await googleFixture().snapshot()), rows: [[], [], [], []] };
  });
  const call = (route, body, query = "") =>
    handleCoordination({
      env: f.env,
      params: { path: route.split("/") },
      request: new Request(
        "https://app.example/api/coordination/" + route + query,
        {
          headers: {
            Cookie: "__Host-streamlion-session=" + token,
            ...(body
              ? {
                  Origin: "https://app.example",
                  "Content-Type": "application/json",
                  "X-StreamLion-Account": "a",
                }
              : {}),
          },
          ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
        },
      ),
    });
  const first = await (await call("provider/jobs")).json();
  assert.ok(first.refresh);
  const query = "?refresh=" + first.refresh.token;
  assert.equal(
    (await (await call("provider/jobs", null, query)).json()).unchanged,
    true,
  );
  assert.equal(reads, 1);
  const status = await (await call("provider/status")).json();
  assert.equal(status.delivery.email, false);
  assert.equal(
    (
      await call("provider/create", {
        operation: "blocked",
        email: "client@example.com",
        title: "Office",
      })
    ).status,
    503,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_coordination_jobs_v1")
      .get().n,
    0,
  );
  Object.assign(f.env, {
    ENABLE_RESEND_EMAIL: "true",
    RESEND_API_KEY: "synthetic",
    RESEND_FROM_EMAIL: "projects@example.com",
    RESEND_DAILY_LIMIT: "20",
    RESEND_MONTHLY_LIMIT: "500",
    RESEND_TEST_RECIPIENTS: "client@example.com",
  });
  f.sql
    .prepare("INSERT INTO streamlion_coordination_email_budget_v1 VALUES(?,20)")
    .run(Math.floor(now / 86400000));
  const quotaStatus = await (await call("provider/status")).json();
  assert.equal(quotaStatus.delivery.reason, "daily_limit");
  assert.equal(quotaStatus.delivery.email, false);
  for (const [route, body] of [
    [
      "provider/create",
      {
        operation: "quota-blocked",
        email: "client@example.com",
        title: "Office",
      },
    ],
    ["client/request", { jobId: "unknown", email: "client@example.com" }],
  ]) {
    const blocked = await call(route, body);
    assert.equal(blocked.status, 503);
    assert.match((await blocked.json()).error, /paused until/);
  }
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_coordination_challenges_v1")
      .get().n,
    0,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_coordination_jobs_v1")
      .get().n,
    0,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT SUM(attempts) n FROM streamlion_coordination_email_budget_v1",
      )
      .get().n,
    20,
  );
  assert.deepEqual(await (await call("availability")).json(), {
    enabled: true,
    public: false,
    status: "delivery_paused",
  });
  f.sql.exec("UPDATE streamlion_google_sessions_v1 SET google_subject='b'");
  assert.equal((await call("provider/jobs", null, query)).status, 409);
  assert.equal(reads, 1);
});
test("a refunded provider purchase cannot be bypassed by a client refresh token", async (t) => {
  const f = fixture(t),
    call = await authorizedClient(f);
  const read = await beginRead(
    f.env,
    f.connection,
    "job-a",
    new Request("https://app.example/api/coordination/client/job"),
  );
  await finishRead(f.env, f.connection, "job-a", read, { rows: [] });
  f.sql.exec(
    "UPDATE streamlion_purchases_v1 SET status='refunded' WHERE google_subject='a'",
  );
  t.mock.method(CoordinationGoogle.prototype, "snapshot", () => {
    throw new Error("no read after refund");
  });
  assert.equal(
    (await call("client/job", null, "?refresh=" + read.refresh.token)).status,
    403,
  );
});
test("unpaid work cannot occupy a maintenance batch ahead of an eligible provider", async (t) => {
  const f = fixture(t);
  delete f.env.COORDINATION_MAILER;
  for (let i = 0; i < 11; i++) {
    f.sql
      .prepare(
        "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at) VALUES(?,'unpaid','test',?,'folder','encrypted','Provider',9999999999999)",
      )
      .run("unpaid-" + i, "unpaid-book-" + i);
    f.sql
      .prepare(
        "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES(?,?,'job','provider','x','encrypted',1)",
      )
      .run("unpaid-op-" + i, "unpaid-" + i);
  }
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES('eligible-op',?,'job','provider','x','encrypted',2)",
    )
    .run(f.connection.id);
  const seen = [];
  t.mock.method(CoordinationEngine.prototype, "run", async (id) => {
    seen.push(id);
  });
  await maintainCoordination(f.env);
  assert.deepEqual(seen, ["eligible-op"]);
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) n FROM streamlion_coordination_operations_v1 WHERE id LIKE 'unpaid-%' AND state='pending'",
      )
      .get().n,
    11,
  );
});
test("starter granted once; mixed-source reservations refund original sources once", async (t) => {
  const { db, sql } = fixture(t);
  await Promise.all([
    grantStarter(db, "test", "a", 1),
    grantStarter(db, "test", "a", 2),
  ]);
  assert.equal((await sharedWallet(db, "test", "a")).available, 7500000);
  await reserveProject(db, "test", "a", "one", 3);
  await finishProject(db, "test", "a", "one", "complete");
  await reserveProject(db, "test", "a", "two", 4);
  await finishProject(db, "test", "a", "two", "complete");
  sql.exec(
    "UPDATE streamlion_credit_wallets_v1 SET balance_micros=4000000 WHERE google_subject='a'",
  );
  const third = await reserveProject(db, "test", "a", "three", 5);
  assert.equal(third.promotional, 1500000);
  assert.equal(third.purchased, 1500000);
  await reserveProject(db, "test", "a", "three", 6);
  assert.equal((await sharedWallet(db, "test", "a")).purchased, 2500000);
  await finishProject(db, "test", "a", "three", "failed");
  await finishProject(db, "test", "a", "three", "failed");
  assert.equal((await sharedWallet(db, "test", "a")).available, 5500000);
  await assert.rejects(
    () => reserveProject(db, "test", "b", "one", 7),
    /Top up/,
  );
  sql.exec(
    "UPDATE streamlion_purchases_v1 SET status='refunded' WHERE google_subject='a'",
  );
  assert.equal((await sharedWallet(db, "test", "a")).promotional, 0);
});
test("separate engines serialize writes and recover unknown save without another charge", async (t) => {
  const { env, db, sql, connection } = fixture(t),
    google = googleFixture();
  let job = newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Office",
    now: 1,
  });
  for (const fields of [
    {
      address: "1 Main",
      scope: "Rooms",
      deliverables: "Tour",
      accessInstructions: "Meet owner",
    },
  ])
    job = reduceClientJob(
      job,
      { action: "edit", id: "edit", expectedRevision: job.revision, fields },
      { role: "client" },
      2,
    );
  job = reduceClientJob(
    job,
    { action: "submit", expectedRevision: job.revision },
    { role: "client" },
    3,
  );
  job = reduceClientJob(
    job,
    { action: "approve", expectedRevision: job.revision },
    { role: "provider" },
    4,
  );
  job.chargeAuthorizedMicros = 3000000;
  google.heads.set(job.id, job);
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES('job-a','connection-a','job-a',?,1)",
    )
    .run(await seal(env, "client@example.com", "job-email:job-a"));
  const engine = new CoordinationEngine(env, connection, google);
  google.failProjection = true;
  const command = { action: "approve", expectedRevision: job.revision };
  await assert.rejects(
    () => engine.command("confirm", job.id, command, { role: "client" }),
    /timeout/,
  );
  assert.equal(google.heads.get(job.id).state, "activation_pending");
  assert.equal((await sharedWallet(db, "test", "a")).available, 4500000);
  await assert.rejects(
    () =>
      new CoordinationEngine(env, connection, google).store(
        "other",
        "job-other",
        "provider",
        { action: "x" },
        { events: [] },
      ),
    /Another save/,
  );
  google.failProjection = false;
  await new CoordinationEngine(env, connection, google).command(
    "confirm",
    job.id,
    command,
    { role: "client" },
  );
  assert.equal(google.heads.get(job.id).state, "confirmed");
  assert.equal((await sharedWallet(db, "test", "a")).available, 4500000);
  await engine.command("confirm", job.id, command, { role: "client" });
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    1,
  );
  await assert.rejects(
    () =>
      engine.command(
        "confirm",
        job.id,
        { ...command, action: "edit" },
        { role: "client" },
      ),
    /identity/,
  );
  await db
    .prepare(
      "UPDATE streamlion_coordination_connections_v1 SET notification_email=? WHERE id=?",
    )
    .bind(
      await seal(
        env,
        "provider@example.com",
        "connection-email:" + connection.id,
      ),
      connection.id,
    )
    .run();
  await engine.command(
    "provider-access-change",
    job.id,
    {
      action: "edit",
      expectedRevision: google.heads.get(job.id).revision,
      fields: { accessInstructions: "Meet the onsite manager" },
    },
    { role: "provider" },
  );
  const clientNotice = sql
    .prepare(
      "SELECT * FROM streamlion_coordination_outbox_v1 WHERE id='notice-provider-access-change-client'",
    )
    .get();
  assert.equal(clientNotice.kind, "action");
  assert.equal(
    (await unseal(env, clientNotice.payload, "mail:" + clientNotice.id)).to,
    "client@example.com",
  );
  await engine.command(
    "client-access-change",
    job.id,
    {
      action: "edit",
      expectedRevision: google.heads.get(job.id).revision,
      fields: { accessInstructions: "Use the side entrance" },
    },
    { role: "client" },
  );
  const providerNotice = sql
    .prepare(
      "SELECT * FROM streamlion_coordination_outbox_v1 WHERE id='notice-client-access-change-provider'",
    )
    .get();
  assert.equal(providerNotice.kind, "action");
  assert.equal(
    (await unseal(env, providerNotice.payload, "mail:" + providerNotice.id)).to,
    "provider@example.com",
  );
});
test("client verification consumes a challenge once; expired access and cross-origin writes fail", async (t) => {
  const { env, sql } = fixture(t),
    token = "a".repeat(43),
    now = Date.now();
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES('job-a','connection-a','job-a',?,?)",
    )
    .run(await seal(env, "client@example.com", "job-email:job-a"), now);
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_challenges_v1 VALUES(?,'job-a',?,0)",
    )
    .run(await hash(token), now + 60000);
  const request = (origin) =>
    new Request("https://app.example/api/coordination/client/verify", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  assert.equal(
    (
      await handleCoordination({
        request: request("https://evil.example"),
        env,
        params: { path: ["client", "verify"] },
      })
    ).status,
    403,
  );
  const verified = await handleCoordination({
    request: request("https://app.example"),
    env,
    params: { path: ["client", "verify"] },
  });
  assert.equal(verified.status, 200);
  assert.match(verified.headers.get("Set-Cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal(
    (
      await handleCoordination({
        request: request("https://app.example"),
        env,
        params: { path: ["client", "verify"] },
      })
    ).status,
    401,
  );
  sql
    .prepare("UPDATE streamlion_coordination_jobs_v1 SET archive_at=?")
    .run(now - 1);
  const response = await handleCoordination({
    request: new Request("https://app.example/api/coordination/client/job", {
      headers: { Cookie: verified.headers.get("Set-Cookie").split(";")[0] },
    }),
    env,
    params: { path: ["client", "job"] },
  });
  assert.equal(response.status, 401);
});
test("configuration and purchase boundaries fail closed without any network traffic", async (t) => {
  const { env } = fixture(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected external call");
  });
  const request = new Request(
    "https://app.example/api/coordination/provider/status",
  );
  assert.equal(
    (
      await handleCoordination({
        request,
        env: { ...env, ENABLE_CLIENT_COORDINATION: "false" },
        params: { path: ["provider", "status"] },
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await handleCoordination({
        request,
        env,
        params: { path: ["provider", "status"] },
      })
    ).status,
    401,
  );
});
test("AI and coordination consume the same starter balance without mixing modes", async (t) => {
  const { sql, db } = fixture(t);
  await grantStarter(db, "test", "a", 1);
  sql.exec(
    "UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=1000000,total_budget_micros=1000000,daily_requests=100 WHERE mode='test'",
  );
  await reserveCreditTurn(db, "test", "a", "ai-one", 7800, 2);
  assert.equal((await creditAccount(db, "test", "a")).balance_micros, 7492200);
  await reserveProject(db, "test", "a", "job-one", 3);
  assert.equal((await sharedWallet(db, "test", "a")).available, 4492200);
  await finishCreditTurn(db, "test", "a", "ai-one", "failed");
  assert.equal((await sharedWallet(db, "test", "a")).available, 4500000);
  assert.equal((await sharedWallet(db, "live", "a")).available, 0);
  sql.exec(
    "UPDATE streamlion_credit_wallets_v1 SET balance_micros=-1 WHERE google_subject='a'",
  );
  await assert.rejects(
    () => reserveProject(db, "test", "a", "job-two", 4),
    /Insufficient/,
  );
});
test("provider project status cannot cross account or selected-workbook boundaries", async (t) => {
  const { env, sql } = fixture(t),
    cookie = "a".repeat(43);
  sql
    .prepare(
      "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at,workbook_id,folder_id) VALUES(?,'b','b@example.com','encrypted',?,'book-a','folder-a')",
    )
    .run(await hash(cookie), Date.now() + 86400000);
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES('job-a','connection-a','job-a','encrypted',1)",
    )
    .run();
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No Google reads permitted");
  });
  const response = await handleCoordination({
    request: new Request(
      "https://app.example/api/coordination/provider/project?job=job-a",
      { headers: { Cookie: "__Host-streamlion-session=" + cookie } },
    ),
    env,
    params: { path: ["provider", "project"] },
  });
  assert.deepEqual(await response.json(), { managed: false });
});
test("notification retries retain identity, require an exact receipt and erase accepted payloads", async (t) => {
  const { env, db, sql } = fixture(t),
    now = Date.now();
  const row = {
    id: "job-mail",
    client_email: await seal(
      env,
      "synthetic@example.com",
      "job-email:job-mail",
    ),
  };
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES('job-mail','connection-a','job-mail',?,?)",
    )
    .run(row.client_email, now);
  await queueNotice(env, row, "notice-one", {
    subject: "Synthetic",
    text: "Synthetic",
    url: "https://app.example/client/?job=job-mail",
  });
  const keys = [];
  let acknowledged = false;
  env.COORDINATION_MAILER.fetch = async (request) => {
    keys.push(request.headers.get("Idempotency-Key"));
    return Response.json({
      accepted: true,
      idempotencyKey: acknowledged ? "notice-one" : "wrong",
    });
  };
  assert.equal((await maintainCoordination(env, now + 1000)).retained, 1);
  assert.equal(
    sql.prepare("SELECT sent_at FROM streamlion_coordination_outbox_v1").get()
      .sent_at,
    null,
  );
  acknowledged = true;
  assert.equal((await maintainCoordination(env, now + 60000)).sent, 1);
  assert.deepEqual(keys, ["notice-one", "notice-one"]);
  const saved = await db
    .prepare("SELECT * FROM streamlion_coordination_outbox_v1")
    .first();
  assert.deepEqual(await unseal(env, saved.payload, "mail:notice-one"), {
    accepted: true,
  });
});
test("migration preflight recognizes complete state and rejects partial or altered triggers", (t) => {
  const { sql } = fixture(t);
  const schema = sql
    .prepare(
      "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL",
    )
    .all();
  const stamps = Object.fromEntries(
    schema
      .filter((r) => r.name.includes("_schema_"))
      .map((r) => [
        r.name,
        sql.prepare("SELECT version FROM " + r.name).get().version,
      ]),
  );
  assert.equal(
    coordinationPreflight({ schema, stamps }).migration,
    "already_applied",
  );
  assert.throws(
    () =>
      coordinationPreflight({
        schema: schema.filter(
          (r) => r.name !== "streamlion_coordination_rates_v1",
        ),
        stamps,
      }),
    /Partial/,
  );
  assert.throws(
    () =>
      coordinationPreflight({
        schema: schema.map((r) =>
          r.name === "streamlion_shared_debit_v1"
            ? { ...r, sql: r.sql.replace("NEW.purchased", "0") }
            : r,
        ),
        stamps,
      }),
    /mismatch/,
  );
});
test("0009 backfills old AI reservations without double debit and returns their source on failure", () => {
  const sql = new DatabaseSync(":memory:");
  try {
    for (const f of readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((f) => f.endsWith(".sql") && f < "0009")
      .sort())
      sql.exec(
        readFileSync(new URL("../../migrations/" + f, import.meta.url), "utf8"),
      );
    sql.exec(
      "UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=1000000,total_budget_micros=1000000,daily_requests=100 WHERE mode='test'; INSERT INTO streamlion_credit_wallets_v1 VALUES('test','a',10000); INSERT INTO streamlion_credit_turns_v1 VALUES('test','a','old-turn',1,7800,6000,'reserved');",
    );
    assert.equal(
      sql
        .prepare("SELECT balance_micros FROM streamlion_credit_wallets_v1")
        .get().balance_micros,
      2200,
    );
    const schema = sql
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL",
      )
      .all();
    const stamps = Object.fromEntries(
      schema
        .filter((r) => r.name.includes("_schema_"))
        .map((r) => [
          r.name,
          sql.prepare("SELECT version FROM " + r.name).get().version,
        ]),
    );
    assert.equal(
      coordinationPreflight({ schema, stamps }).migration,
      "pending",
    );
    sql.exec(
      readFileSync(
        new URL(
          "../../migrations/0009_client_coordination.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.equal(
      sql
        .prepare("SELECT balance_micros FROM streamlion_credit_wallets_v1")
        .get().balance_micros,
      2200,
    );
    sql.exec(
      "UPDATE streamlion_credit_turns_v1 SET state='failed' WHERE request_id='old-turn'",
    );
    assert.equal(
      sql
        .prepare("SELECT balance_micros FROM streamlion_credit_wallets_v1")
        .get().balance_micros,
      10000,
    );
  } finally {
    sql.close();
  }
});
