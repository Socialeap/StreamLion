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
