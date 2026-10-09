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
  createProspectLink,
  openProspect,
  requestProspectVerification,
  syncProspectClaim,
} from "../../server/prospect-intake.js";
import { TM_ESTIMATE } from "../../src/capture-estimate.js";
import {
  archiveFixture,
  archiveGoogleFixture,
} from "../../test/archive-fixture.js";
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
import {
  INTAKE_PRESETS,
  isIntakeTemplate,
} from "../../src/intake-templates.js";
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
    templates = new Map(),
    revisions = [];
  return {
    events,
    heads,
    templates,
    revisions,
    failProjection: false,
    snapshot: async () => ({
      events,
      heads,
      templates,
      projects: { heads: revisions.slice(-1), revisions },
      notes: { heads: [], revisions: [] },
    }),
    async event(event) {
      const existing = events.get(event.id);
      if (existing) {
        assert.equal(stableJSON(existing), stableJSON(event));
        return;
      }
      const records = isIntakeTemplate(event.job) ? templates : heads;
      assert.equal(records.get(event.jobId)?.revision ?? -1, event.parent);
      events.set(event.id, event);
      records.set(event.jobId, structuredClone(event.job));
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
test("invalid brief fields return actionable rejection before any operation or credit change", async (t) => {
  const f = fixture(t),
    token = "v".repeat(43),
    google = googleFixture();
  let job = newClientJob({
    id: "job-validation",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Synthetic validation",
    now: 1,
  });
  for (const [action, fields] of [
    [
      "edit",
      {
        address: "1 QA Road",
        scope: "QA",
        deliverables: "QA",
        accessInstructions: "QA",
      },
    ],
    ["submit"],
    ["approve"],
  ])
    job = reduceClientJob(
      job,
      { action, fields, expectedRevision: job.revision },
      { role: "client" },
      job.revision + 2,
    );
  google.heads.set(job.id, job);
  f.sql
    .prepare(
      "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at,workbook_id,folder_id) VALUES(?,'a','a@example.com','encrypted',?,'book-a','folder-a')",
    )
    .run(await hash(token), Date.now() + 86400000);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES(?,'connection-a',?,?,1)",
    )
    .run(
      job.id,
      job.id,
      await seal(f.env, "client@example.com", "job-email:" + job.id),
    );
  let snapshotUnavailable = false;
  t.mock.method(CoordinationGoogle.prototype, "snapshot", async () => {
    if (snapshotUnavailable)
      throw new Error("private upstream detail must not escape");
    return google.snapshot();
  });
  t.mock.method(
    CoordinationGoogle.prototype,
    "event",
    google.event.bind(google),
  );
  t.mock.method(
    CoordinationGoogle.prototype,
    "projection",
    google.projection.bind(google),
  );
  const call = (operation, fields) =>
    handleCoordination({
      env: f.env,
      params: { path: ["provider", "command"] },
      request: new Request(
        "https://app.example/api/coordination/provider/command",
        {
          method: "POST",
          headers: {
            Cookie: "__Host-streamlion-session=" + token,
            Origin: "https://app.example",
            "Content-Type": "application/json",
            "X-StreamLion-Account": "a",
          },
          body: JSON.stringify({
            operation,
            jobId: job.id,
            command: { action: "edit", expectedRevision: job.revision, fields },
          }),
        },
      ),
    });
  const counters = () =>
    Object.fromEntries(
      ["operations", "shared_spends", "outbox"].map((name) => [
        name,
        f.sql
          .prepare(
            "SELECT COUNT(*) AS count FROM streamlion_" +
              (name === "shared_spends" ? name : "coordination_" + name) +
              "_v1",
          )
          .get().count,
      ]),
    );
  for (const [operation, fields, message] of [
    [
      "missing-currency",
      { offeredFee: "100" },
      "Specify the currency for monetary amounts.",
    ],
    [
      "insecure-reference",
      { reference1Url: "http://example.com/qa" },
      "Reference 1 link must use HTTPS.",
    ],
    [
      "missing-timezone",
      { startLocal: "2026-10-08T09:30" },
      "A scheduled time needs an explicit time zone.",
    ],
  ]) {
    const response = await call(operation, fields);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: message,
      code: "invalid_project_fields",
    });
    assert.deepEqual(counters(), {
      operations: 0,
      shared_spends: 0,
      outbox: 0,
    });
    assert.deepEqual(google.heads.get(job.id), job);
    assert.equal(google.events.size, 0);
  }
  const corrected = await call("corrected-fee", {
    offeredFee: "100",
    currency: "USD",
  });
  assert.equal(corrected.status, 200);
  assert.equal(google.heads.get(job.id).fields.offeredFee, "100");
  assert.equal(google.heads.get(job.id).clientApproved, false);
  assert.deepEqual(counters(), { operations: 1, shared_spends: 0, outbox: 1 });
  snapshotUnavailable = true;
  const unavailable = await call("upstream-failure", {
    offeredFee: "200",
    currency: "USD",
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error:
      "Coordination is temporarily unavailable. Your original operation is preserved.",
  });
  assert.deepEqual(counters(), { operations: 1, shared_spends: 0, outbox: 1 });
});
async function recoveryFixture(t) {
  const f = fixture(t);
  const target = {
    ...f.connection,
    id: "connection-target",
    workbook_id: "book-target",
  };
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at,revoked) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(...Object.values(target));
  const archive = await archiveFixture(f.env, f.connection);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,closed_at,archive_at,archived,created_at) VALUES(?,?,?,?,?,?,1,1)",
    )
    .run(
      archive.job.id,
      f.connection.id,
      archive.job.id,
      "encrypted",
      archive.job.closedAt,
      archive.job.archiveAt,
    );
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) VALUES('old-session',?,9999999999999)",
    )
    .run(archive.job.id);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_challenges_v1(hash,job_id,expires_at) VALUES('old-challenge',?,9999999999999)",
    )
    .run(archive.job.id);
  const google = archiveGoogleFixture(target, f.env);
  google.google.loadArchive = async () => archive;
  return {
    ...f,
    target,
    archive,
    google,
    engine: new CoordinationEngine(f.env, target, google.google),
  };
}
test("archive recovery locks both workbooks, recovers unknown outcomes and preserves wallet and expired client grants", async (t) => {
  const f = await recoveryFixture(t),
    job = f.archive.job;
  const before = await sharedWallet(f.db, "test", "a");
  f.google.loseAck();
  await assert.rejects(
    () => f.engine.restoreArchive("recover-archive", "archive-id"),
    /lost batch/,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_operations_v1 WHERE state='pending'",
      )
      .get().n,
    2,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT connection_id FROM streamlion_coordination_jobs_v1 WHERE id=?",
      )
      .get(job.id).connection_id,
    f.connection.id,
  );
  for (const connection of [f.connection, f.target])
    await assert.rejects(
      () =>
        new CoordinationEngine(f.env, connection, googleFixture()).store(
          "another-" + connection.id,
          "other",
          "provider",
          { unrelated: true },
          {},
        ),
      /Another save/,
    );
  const originalBatch = f.db.batch;
  let lostFinalAck = true;
  f.db.batch = async (list) => {
    const result = await originalBatch(list);
    if (list.length === 5 && lostFinalAck) {
      lostFinalAck = false;
      throw new Error("synthetic lost final acknowledgment");
    }
    return result;
  };
  await assert.rejects(
    () => f.engine.restoreArchive("recover-archive", "archive-id"),
    /lost final/,
  );
  const result = await f.engine.restoreArchive("recover-archive", "archive-id");
  assert.equal(result.complete, true);
  assert.equal(result.jobId, job.id);
  assert.equal(f.google.writes(), 1);
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_operations_v1 WHERE state='pending'",
      )
      .get().n,
    0,
  );
  const saved = f.sql
    .prepare("SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?")
    .get(job.id);
  assert.equal(saved.connection_id, f.target.id);
  assert.equal(saved.archived, 1);
  assert.equal(saved.archive_at, job.archiveAt);
  assert.equal(
    f.sql
      .prepare("SELECT revoked FROM streamlion_coordination_sessions_v1")
      .get().revoked,
    1,
  );
  assert.equal(
    f.sql
      .prepare("SELECT consumed FROM streamlion_coordination_challenges_v1")
      .get().consumed,
    1,
  );
  assert.deepEqual(await sharedWallet(f.db, "test", "a"), before);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1")
      .get().n,
    0,
  );
  await assert.rejects(
    () => f.engine.restoreArchive("recover-archive", "different-file"),
    /identity changed/,
  );
});
test("archive recovery rejects stale or active source jobs and acquires neither lock when another writer is pending", async (t) => {
  const f = await recoveryFixture(t);
  f.sql.prepare("UPDATE streamlion_coordination_jobs_v1 SET archived=0").run();
  await assert.rejects(
    () => f.engine.restoreArchive("active", "archive-id"),
    /stale|active/,
  );
  f.sql
    .prepare(
      "UPDATE streamlion_coordination_jobs_v1 SET archived=1,closed_at=99",
    )
    .run();
  await assert.rejects(
    () => f.engine.restoreArchive("stale", "archive-id"),
    /stale|active/,
  );
  f.sql.prepare("UPDATE streamlion_coordination_jobs_v1 SET closed_at=2").run();
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES('existing',?,'another','provider','existing','encrypted',1)",
    )
    .run(f.target.id);
  await assert.rejects(
    () => f.engine.restoreArchive("blocked", "archive-id"),
    /Another save/,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_operations_v1",
      )
      .get().n,
    1,
  );
  assert.equal(f.google.writes(), 0);
});
test("source recovery delegates only its bound target journal and refuses a newer source lifecycle", async (t) => {
  const f = await recoveryFixture(t);
  f.google.loseAck();
  await assert.rejects(
    () => f.engine.restoreArchive("delegated", "archive-id"),
    /lost batch/,
  );
  const guard = f.sql
    .prepare(
      "SELECT id FROM streamlion_coordination_operations_v1 WHERE connection_id=?",
    )
    .get(f.connection.id);
  const original = CoordinationGoogle.prototype.importArchive;
  const targetImport = f.google.google.importArchive.bind(f.google.google);
  CoordinationGoogle.prototype.importArchive = (_plan, _operation) =>
    targetImport(_plan, _operation);
  t.after(() => {
    CoordinationGoogle.prototype.importArchive = original;
  });
  const sourceEngine = new CoordinationEngine(
    f.env,
    f.connection,
    googleFixture(),
  );
  f.sql
    .prepare(
      "UPDATE streamlion_coordination_connections_v1 SET google_subject='b' WHERE id=?",
    )
    .run(f.target.id);
  await assert.rejects(() => sourceEngine.run(guard.id), /ownership changed/);
  f.sql
    .prepare(
      "UPDATE streamlion_coordination_connections_v1 SET google_subject='a' WHERE id=?",
    )
    .run(f.target.id);
  f.sql
    .prepare("UPDATE streamlion_coordination_jobs_v1 SET closed_at=99")
    .run();
  await assert.rejects(() => sourceEngine.run(guard.id), /source changed/);
  f.sql.prepare("UPDATE streamlion_coordination_jobs_v1 SET closed_at=2").run();
  assert.equal((await sourceEngine.run(guard.id)).complete, true);
  assert.equal(f.google.writes(), 1);
});
test("large recovery journals round trip without changing ciphertext format and remain bound to context", async (t) => {
  const { env } = fixture(t),
    value = { sourceText: "É".repeat(350000) };
  const encrypted = await seal(env, value, "operation:large");
  assert.equal(encrypted.split(".").length, 2);
  assert.deepEqual(await unseal(env, encrypted, "operation:large"), value);
  await assert.rejects(() => unseal(env, encrypted, "operation:different"));
});
test("accepted early archival ends client access before archive verification and retains reasoned recovery history", async (t) => {
  const f = fixture(t),
    g = archiveGoogleFixture(f.connection, f.env);
  const now = Date.now(),
    first = newClientJob({
      id: "job-early",
      provider: "a",
      clientEmail: "synthetic@example.com",
      title: "Closed QA job",
      now: now - 100,
    });
  const job = reduceClientJob(
    first,
    { action: "cancel", expectedRevision: 0, reason: "Synthetic QA complete" },
    { role: "provider" },
    now - 50,
  );
  await g.google.event({
    id: "early-create",
    jobId: first.id,
    revision: 0,
    parent: -1,
    at: first.updatedAt,
    actor: "provider",
    action: "create",
    job: first,
  });
  await g.google.event({
    id: "early-cancel",
    jobId: job.id,
    revision: 1,
    parent: 0,
    at: job.updatedAt,
    actor: "provider",
    action: "cancel",
    job,
  });
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,closed_at,archive_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      job.id,
      f.connection.id,
      job.id,
      await seal(
        f.env,
        { email: "synthetic@example.com" },
        "job-email:" + job.id,
      ),
      job.closedAt,
      job.archiveAt,
      first.createdAt,
    );
  const clientToken = "A".repeat(43);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) VALUES(?,?,9999999999999)",
    )
    .run(await hash(clientToken), job.id);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_challenges_v1(hash,job_id,expires_at) VALUES('early-challenge',?,9999999999999)",
    )
    .run(job.id);
  const json = g.google.json;
  g.google.json = async (url, options) =>
    url.includes("generateIds")
      ? { ids: ["early-archive-file"] }
      : json(url, options);
  let failAck = true,
    packageBody;
  g.google.archive = async (_job, _operation, plan) => {
    packageBody = JSON.parse(plan.body);
    await g.google.verifyArchive(packageBody);
    if (failAck) {
      failAck = false;
      throw new Error("synthetic archive unverified");
    }
    return plan.fileId;
  };
  const engine = new CoordinationEngine(f.env, f.connection, g.google);
  const command = {
    action: "archive_early",
    expectedRevision: job.revision,
    reason: "End completed QA access",
  };
  await assert.rejects(
    () =>
      engine.command("early-archive", job.id, command, { role: "provider" }),
    /unverified/,
  );
  assert.equal(
    f.sql.prepare("SELECT archived FROM streamlion_coordination_jobs_v1").get()
      .archived,
    0,
  );
  assert.equal(
    f.sql
      .prepare("SELECT revoked FROM streamlion_coordination_sessions_v1")
      .get().revoked,
    1,
  );
  const pending = await engine.operation("early-archive");
  assert.equal(pending.state, "pending");
  const deadline = f.sql
    .prepare("SELECT archive_at FROM streamlion_coordination_jobs_v1")
    .get().archive_at;
  assert.ok(deadline <= Date.now());
  assert.equal(deadline, packageBody.job.archiveAt);
  assert.equal(
    f.sql
      .prepare("SELECT consumed FROM streamlion_coordination_challenges_v1")
      .get().consumed,
    1,
  );
  assert.equal(
    (await g.google.snapshot()).heads.get(job.id).state,
    "cancelled",
  );
  const denied = await handleCoordination({
    request: new Request("https://app.example/api/coordination/client/job", {
      headers: { Cookie: "__Host-streamlion-client=" + clientToken },
    }),
    env: f.env,
    params: { path: "client/job" },
  });
  assert.equal(denied.status, 401);
  assert.match((await denied.json()).error, /expired/);
  assert.equal(packageBody.job.state, "archived");
  assert.equal(packageBody.history.at(-1).action, "archive_early");
  assert.equal(packageBody.history.length, 3);
  await engine.command("early-archive", job.id, command, { role: "provider" });
  assert.equal(
    f.sql.prepare("SELECT archived FROM streamlion_coordination_jobs_v1").get()
      .archived,
    1,
  );
  assert.equal(
    f.sql
      .prepare("SELECT revoked FROM streamlion_coordination_sessions_v1")
      .get().revoked,
    1,
  );
  assert.equal(
    f.sql
      .prepare("SELECT consumed FROM streamlion_coordination_challenges_v1")
      .get().consumed,
    1,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
  const archived = (await g.google.snapshot()).heads.get(job.id);
  await engine.command(
    "early-reopen",
    job.id,
    {
      action: "reopen",
      expectedRevision: archived.revision,
      reason: "  Correct the archived delivery detail  ",
    },
    { role: "provider" },
  );
  const reopened = (await g.google.snapshot()).heads.get(job.id);
  assert.equal(reopened.reopenReason, "Correct the archived delivery detail");
  assert.equal(reopened.reopenedAt, reopened.updatedAt);
  assert.ok(reopened.reopenedAt >= deadline);
  assert.equal(
    (await g.google.snapshot()).events.get("early-reopen").job.reopenReason,
    reopened.reopenReason,
  );
  assert.equal(
    f.sql
      .prepare("SELECT revoked FROM streamlion_coordination_sessions_v1")
      .get().revoked,
    1,
  );
});
test("early-archive journal acquisition is atomic and rejects stale or changed retry identities", async (t) => {
  for (const scenario of [
    "stale",
    "transaction failure",
    "lost acknowledgment",
  ])
    await t.test(scenario, async (t) => {
      const f = fixture(t),
        now = Date.now(),
        jobId = "job-atomic";
      f.sql
        .prepare(
          "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,closed_at,archive_at,created_at) VALUES(?,?,?,'encrypted',?,?,?)",
        )
        .run(jobId, f.connection.id, jobId, now - 100, now + 10000, now - 200);
      f.sql
        .prepare(
          "INSERT INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) VALUES('atomic-session',?,9999999999999)",
        )
        .run(jobId);
      f.sql
        .prepare(
          "INSERT INTO streamlion_coordination_challenges_v1(hash,job_id,expires_at) VALUES('atomic-challenge',?,9999999999999)",
        )
        .run(jobId);
      const engine = new CoordinationEngine(
          f.env,
          f.connection,
          googleFixture(),
        ),
        command = {
          action: "archive_early",
          expectedRevision: 1,
          reason: "End access",
        },
        plan = {
          endAccess: {
            closedAt: now - 100,
            previousArchiveAt: now + 10000,
            until: now,
          },
        };
      let runs = 0;
      engine.run = async (id) => {
        runs++;
        return { operation: id };
      };
      const batch = f.db.batch;
      if (scenario === "stale") plan.endAccess.previousArchiveAt++;
      if (scenario === "transaction failure")
        f.db.batch = (list) =>
          batch([
            ...list.slice(0, 2),
            {
              sync: () => {
                throw new Error("synthetic D1 failure");
              },
            },
            ...list.slice(2),
          ]);
      if (scenario === "lost acknowledgment")
        f.db.batch = async (list) => {
          await batch(list);
          throw new Error("synthetic lost D1 acknowledgment");
        };
      if (scenario !== "lost acknowledgment") {
        await assert.rejects(
          () =>
            engine.store("atomic-archive", jobId, "provider", command, plan),
          (error) => error.status === 409,
        );
        assert.equal(runs, 0);
        assert.equal(await engine.operation("atomic-archive"), null);
        assert.equal(
          f.sql
            .prepare("SELECT archive_at FROM streamlion_coordination_jobs_v1")
            .get().archive_at,
          now + 10000,
        );
        assert.equal(
          f.sql
            .prepare("SELECT revoked FROM streamlion_coordination_sessions_v1")
            .get().revoked,
          0,
        );
        assert.equal(
          f.sql
            .prepare(
              "SELECT consumed FROM streamlion_coordination_challenges_v1",
            )
            .get().consumed,
          0,
        );
      } else {
        await engine.store("atomic-archive", jobId, "provider", command, plan);
        assert.equal(runs, 1);
        assert.equal(
          (await engine.operation("atomic-archive")).state,
          "pending",
        );
        assert.equal(
          f.sql
            .prepare("SELECT archive_at FROM streamlion_coordination_jobs_v1")
            .get().archive_at,
          now,
        );
        assert.equal(
          f.sql
            .prepare("SELECT revoked FROM streamlion_coordination_sessions_v1")
            .get().revoked,
          1,
        );
        assert.equal(
          f.sql
            .prepare(
              "SELECT consumed FROM streamlion_coordination_challenges_v1",
            )
            .get().consumed,
          1,
        );
        f.db.batch = batch;
        // A concurrent changed retry must not advance the existing deadline.
        await assert.rejects(
          () =>
            engine.store(
              "atomic-archive",
              jobId,
              "provider",
              { ...command, reason: "Different request" },
              { endAccess: { ...plan.endAccess, until: now + 100000 } },
            ),
          (error) => error.status === 409,
        );
        assert.equal(
          f.sql
            .prepare("SELECT archive_at FROM streamlion_coordination_jobs_v1")
            .get().archive_at,
          now,
        );
        assert.equal(runs, 1);
      }
    });
});
test("template saves recover a lost Google acknowledgment through the shared writer without jobs, mail or charges", async (t) => {
  const { env, sql, connection } = fixture(t),
    google = googleFixture();
  const engine = new CoordinationEngine(env, connection, google);
  const input = {
    id: "intake-capture",
    expectedVersion: 0,
    config: INTAKE_PRESETS[0],
  };
  const append = google.event.bind(google);
  let lost = true;
  google.event = async (event) => {
    await append(event);
    if (lost) {
      lost = false;
      throw new Error("synthetic lost acknowledgment");
    }
  };
  await assert.rejects(
    () => engine.saveTemplate("template-save", input),
    /lost acknowledgment/,
  );
  assert.equal(google.templates.get(input.id).revision, 0);
  await assert.rejects(
    () =>
      new CoordinationEngine(env, connection, google).saveTemplate(
        "blocked-other",
        { ...input, id: "intake-other" },
      ),
    /Another save/,
  );
  await engine.saveTemplate("template-save", input);
  await engine.saveTemplate("template-save", input);
  assert.equal(google.events.size, 1);
  assert.equal(google.heads.size, 0);
  assert.equal(google.revisions.length, 0);
  assert.equal(
    sql
      .prepare(
        "SELECT state FROM streamlion_coordination_operations_v1 WHERE id='template-save'",
      )
      .get().state,
    "complete",
  );
  await assert.rejects(
    () =>
      engine.saveTemplate("template-save", {
        ...input,
        config: INTAKE_PRESETS[1],
      }),
    /identity changed/,
  );
  for (const table of [
    "streamlion_coordination_jobs_v1",
    "streamlion_coordination_outbox_v1",
    "streamlion_shared_spends_v1",
  ])
    assert.equal(sql.prepare("SELECT COUNT(*) n FROM " + table).get().n, 0);
  await engine.saveTemplate("template-two", {
    ...input,
    expectedVersion: 1,
    config: INTAKE_PRESETS[1],
  });
  assert.equal(google.templates.get(input.id).revision, 1);
  await assert.rejects(() => engine.saveTemplate("stale", input), /changed/);
});
test("provider API pins an exact saved service version and rejects foreign or forged templates before creating a job", async (t) => {
  const f = fixture(t),
    token = "p".repeat(43),
    google = googleFixture();
  f.sql
    .prepare(
      "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at,workbook_id,folder_id) VALUES(?,'a','a@example.com','encrypted',?,'book-a','folder-a')",
    )
    .run(await hash(token), Date.now() + 86400000);
  t.mock.method(CoordinationGoogle.prototype, "snapshot", async () => ({
    ...(await google.snapshot()),
    rows: [[], [], [], []],
  }));
  t.mock.method(
    CoordinationGoogle.prototype,
    "event",
    google.event.bind(google),
  );
  t.mock.method(
    CoordinationGoogle.prototype,
    "projection",
    google.projection.bind(google),
  );
  const call = (route, body) =>
    handleCoordination({
      env: f.env,
      params: { path: route.split("/") },
      request: new Request("https://app.example/api/coordination/" + route, {
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
      }),
    });
  assert.equal(
    (
      await call("provider/template", {
        operation: "service-one",
        templateId: "intake-capture",
        expectedVersion: 0,
        config: INTAKE_PRESETS[0],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("provider/template", {
        operation: "service-two",
        templateId: "intake-capture",
        expectedVersion: 1,
        config: INTAKE_PRESETS[1],
      })
    ).status,
    200,
  );
  const list = await (await call("provider/jobs")).json();
  assert.equal(list.jobs.length, 0);
  assert.equal(list.templates.length, 1);
  assert.equal(list.templates[0].revision, 1);
  const request = {
    operation: "request-a",
    email: "client@example.com",
    title: "Office",
    template: { id: "intake-capture", version: 1 },
  };
  assert.equal((await call("provider/create", request)).status, 200);
  assert.equal(google.heads.get("job-request-a").intake.version, 1);
  assert.equal(google.heads.get("job-request-a").intake.name, "3D capture");
  assert.equal((await call("provider/create", request)).status, 200);
  assert.equal(google.heads.size, 1);
  assert.equal(
    (
      await call("provider/create", {
        ...request,
        template: { id: "intake-capture", version: 2 },
      })
    ).status,
    409,
  );
  for (const selection of [
    { id: "intake-foreign", version: 1 },
    { id: "intake-capture", version: 1, config: INTAKE_PRESETS[2] },
  ])
    assert.ok(
      (
        await call("provider/create", {
          ...request,
          operation: "bad-selection",
          template: selection,
        })
      ).status >= 400,
    );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_coordination_jobs_v1")
      .get().n,
    1,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    0,
  );
});
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

async function prospectFixture(t, email = "") {
  const f = fixture(t),
    google = googleFixture();
  const template = {
    kind: "streamlion.intake-template",
    version: 1,
    id: "intake-prospect",
    provider: "a",
    revision: 0,
    createdAt: 1,
    updatedAt: 1,
    config: {
      schemaVersion: 1,
      name: "TM spatial capture",
      description: "Public service guidance",
      defaults: {},
      questions: [],
      estimateProfile: TM_ESTIMATE,
    },
  };
  const job = newClientJob({
    id: "job-prospect",
    provider: "a",
    clientEmail: email,
    title: "Private starting name",
    contactName: "Private contact",
    companyName: "Private company",
    prospect: true,
    now: Date.now(),
    intakeTemplate: template,
  });
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES(?,?,?,?,?)",
    )
    .run(
      job.id,
      f.connection.id,
      job.id,
      await seal(f.env, email, "job-email:" + job.id),
      job.createdAt,
    );
  google.heads.set(job.id, job);
  const row = f.sql
    .prepare("SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?")
    .get(job.id);
  const url = await createProspectLink(f.env, row, job, f.connection),
    token = new URLSearchParams(new URL(url).hash.slice(1)).get("invite");
  const engine = new CoordinationEngine(f.env, f.connection, google);
  return { ...f, google, job, row, url, token, engine };
}
const prospectBody = (f, email = "client@example.com") => ({
  token: f.token,
  email,
  creative: true,
  fields: {
    requesterName: "Synthetic client",
    address: "Synthetic site",
    scope: "3D capture",
    propertySizeSqFt: "5000",
    notes: "Exact 12 7/16 in; handoff to client account",
  },
});
async function verificationToken(f, email) {
  const notices = f.sql
    .prepare(
      "SELECT * FROM streamlion_coordination_outbox_v1 WHERE id LIKE 'prospect-verify-%'",
    )
    .all();
  for (const notice of notices) {
    const payload = await unseal(f.env, notice.payload, "mail:" + notice.id);
    if (payload.to === email)
      return new URLSearchParams(new URL(payload.url).hash.slice(1)).get(
        "verify",
      );
  }
  throw new Error("Synthetic verification missing");
}
function verifyRequest(token) {
  return new Request("https://app.example/api/coordination/client/verify", {
    method: "POST",
    headers: {
      Origin: "https://app.example",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.5",
    },
    body: JSON.stringify({ token }),
  });
}
test("prospect link exposes only public service wording, records one unverified open and grants no private access", async (t) => {
  const f = await prospectFixture(t);
  assert.ok(f.url.includes("#invite="));
  const view = await openProspect(f.env, f.token),
    first = f.sql
      .prepare("SELECT opened_at FROM streamlion_prospect_links_v1")
      .get().opened_at;
  await openProspect(f.env, f.token);
  assert.equal(
    f.sql.prepare("SELECT opened_at FROM streamlion_prospect_links_v1").get()
      .opened_at,
    first,
  );
  assert.equal(view.brand, "Provider");
  assert.equal(view.intake.estimateProfile, TM_ESTIMATE);
  assert.equal(JSON.stringify(view).includes("Private"), false);
  assert.equal(view.fields, undefined);
  const requestResponse = await handleCoordination({
    env: f.env,
    params: { path: "prospect/request" },
    request: new Request(
      "https://app.example/api/coordination/prospect/request",
      {
        method: "POST",
        headers: {
          Origin: "https://app.example",
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.5",
        },
        body: JSON.stringify(prospectBody(f)),
      },
    ),
  });
  assert.equal(requestResponse.status, 200);
  assert.ok(
    !JSON.stringify(
      f.sql.prepare("SELECT * FROM streamlion_coordination_rates_v1").all(),
    ).includes(f.token),
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_sessions_v1")
      .get().n,
    0,
  );
  const response = await handleCoordination({
    env: f.env,
    request: new Request("https://app.example/api/coordination/client/job"),
    params: { path: "client/job" },
  });
  assert.equal(response.status, 401);
  await assert.rejects(
    () => openProspect(f.env, "x".repeat(43)),
    /unavailable/,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
});
test("unknown-email claims verify atomically, reject a competing email/replays and recover the same Google submission", async (t) => {
  const f = await prospectFixture(t);
  await openProspect(f.env, f.token);
  await requestProspectVerification(
    f.env,
    prospectBody(f, "first@example.com"),
  );
  await requestProspectVerification(
    f.env,
    prospectBody(f, "second@example.com"),
  );
  const first = await verificationToken(f, "first@example.com"),
    second = await verificationToken(f, "second@example.com");
  const replies = await Promise.all(
    [first, second].map((token) =>
      handleCoordination({
        env: f.env,
        request: verifyRequest(token),
        params: { path: "client/verify" },
      }),
    ),
  );
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 401]);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_sessions_v1")
      .get().n,
    1,
  );
  const winner = await unseal(
    f.env,
    f.sql
      .prepare("SELECT client_email FROM streamlion_coordination_jobs_v1")
      .get().client_email,
    "job-email:" + f.job.id,
  );
  assert.ok(["first@example.com", "second@example.com"].includes(winner));
  const repeated = await handleCoordination({
    env: f.env,
    request: verifyRequest(winner === "first@example.com" ? first : second),
    params: { path: "client/verify" },
  });
  assert.equal(repeated.status, 401);
  await syncProspectClaim(f.env, f.engine, f.job.id);
  await syncProspectClaim(f.env, f.engine, f.job.id);
  const job = f.google.heads.get(f.job.id);
  assert.equal(job.state, "submitted");
  assert.equal(job.fields.requesterEmail, winner);
  assert.equal(job.fields.title, "Private starting name");
  assert.equal(job.fields.notes, "Exact 12 7/16 in; handoff to client account");
  assert.equal(job.estimate.totalCents, 165000);
  assert.equal(job.fields.agreedFee, "");
  assert.equal(f.google.events.size, 1);
  assert.equal(
    f.sql
      .prepare("SELECT claim_payload FROM streamlion_prospect_links_v1")
      .get().claim_payload,
    null,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
  await assert.rejects(() => openProspect(f.env, f.token), /unavailable/);
});
test("claim verification fails closed for revoked/expired links, closed jobs, disconnected or refunded providers", async (t) => {
  for (const mutation of [
    "UPDATE streamlion_prospect_links_v1 SET revoked=1",
    "UPDATE streamlion_prospect_links_v1 SET expires_at=1",
    "UPDATE streamlion_prospect_challenges_v1 SET expires_at=1",
    "UPDATE streamlion_coordination_jobs_v1 SET closed_at=1",
    "UPDATE streamlion_coordination_connections_v1 SET revoked=1",
    "UPDATE streamlion_purchases_v1 SET status='refunded' WHERE google_subject='a'",
  ]) {
    const f = await prospectFixture(t);
    await requestProspectVerification(f.env, prospectBody(f));
    const token = await verificationToken(f, "client@example.com");
    f.sql.exec(mutation);
    const response = await handleCoordination({
      env: f.env,
      request: verifyRequest(token),
      params: { path: "client/verify" },
    });
    assert.equal(response.status, 401, mutation);
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM streamlion_coordination_sessions_v1",
        )
        .get().n,
      0,
    );
    assert.equal(
      f.sql.prepare("SELECT claimed_at FROM streamlion_prospect_links_v1").get()
        .claimed_at,
      null,
    );
  }
});
test("pre-addressed share links cannot be claimed by another email or forge financial fields", async (t) => {
  const f = await prospectFixture(t, "expected@example.com");
  await requestProspectVerification(
    f.env,
    prospectBody(f, "other@example.com"),
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_prospect_challenges_v1")
      .get().n,
    0,
  );
  await assert.rejects(
    () =>
      requestProspectVerification(f.env, {
        ...prospectBody(f, "expected@example.com"),
        fields: { ...prospectBody(f).fields, paidAmount: "999" },
      }),
    /cannot be changed/,
  );
  await requestProspectVerification(f.env, {
    ...prospectBody(f, "expected@example.com"),
    estimate: { totalCents: 1 },
    state: "closed",
  });
  const challenge = f.sql
      .prepare("SELECT * FROM streamlion_prospect_challenges_v1")
      .get(),
    payload = await unseal(
      f.env,
      challenge.payload,
      "prospect-claim:" + f.job.id,
    );
  assert.equal(payload.estimate.totalCents, 165000);
  assert.equal(payload.state, undefined);
});
test("provider-prepared submissions and approvals do not strand a verified prospect claim", async (t) => {
  for (const state of ["submitted", "clarification", "awaiting_agreement"]) {
    const f = await prospectFixture(t);
    let current = f.google.heads.get(f.job.id);
    const prepare = async (operation, command) => {
      await f.engine.command(
        operation,
        f.job.id,
        { ...command, expectedRevision: current.revision },
        { role: "provider" },
      );
      current = f.google.heads.get(f.job.id);
    };
    await prepare("prepare-brief", {
      action: "edit",
      fields: {
        address: "Provider starting site",
        scope: "Provider starting scope",
        deliverables: "3D tour",
        accessInstructions: "Arrange access",
        companyName: "Provider starting company",
      },
    });
    await prepare("provider-submit", { action: "submit" });
    if (state === "clarification")
      await prepare("provider-question", {
        action: "question",
        text: "Confirm site access",
      });
    if (state === "awaiting_agreement")
      await prepare("provider-approve", {
        action: "approve",
        authorizedMicros: 3000000,
      });
    assert.equal(current.state, state);
    await requestProspectVerification(f.env, prospectBody(f));
    const token = await verificationToken(f, "client@example.com");
    assert.equal(
      (
        await handleCoordination({
          env: f.env,
          request: verifyRequest(token),
          params: { path: "client/verify" },
        })
      ).status,
      200,
    );
    await syncProspectClaim(f.env, f.engine, f.job.id);
    await syncProspectClaim(f.env, f.engine, f.job.id);
    const claimed = f.google.heads.get(f.job.id);
    assert.equal(claimed.state, "submitted");
    assert.equal(claimed.fields.scope, "3D capture");
    assert.equal(claimed.fields.companyName, "Provider starting company");
    assert.equal(claimed.providerApproved, false);
    assert.equal(claimed.clientApproved, false);
    assert.equal(
      [...f.google.events.values()].filter((e) => e.action === "claim_request")
        .length,
      1,
    );
    assert.ok(
      f.sql.prepare("SELECT synced_at FROM streamlion_prospect_links_v1").get()
        .synced_at,
    );
    assert.equal(
      f.sql
        .prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1")
        .get().n,
      0,
    );
    assert.equal(
      (
        await handleCoordination({
          env: f.env,
          request: verifyRequest(token),
          params: { path: "client/verify" },
        })
      ).status,
      401,
    );
  }
});
test("Google interruption after verified claim retains the original operation and blocks premature private readback", async (t) => {
  const f = await prospectFixture(t);
  await requestProspectVerification(f.env, prospectBody(f));
  const response = await handleCoordination({
    env: f.env,
    request: verifyRequest(await verificationToken(f, "client@example.com")),
    params: { path: "client/verify" },
  });
  assert.equal(response.status, 200);
  const originalEvent = f.google.event.bind(f.google);
  let fail = true;
  f.google.event = async (event) => {
    if (fail) throw new Error("Synthetic Google interruption");
    return originalEvent(event);
  };
  await assert.rejects(
    () => syncProspectClaim(f.env, f.engine, f.job.id),
    /Synthetic/,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_operations_v1 WHERE state='pending'",
      )
      .get().n,
    1,
  );
  fail = false;
  await syncProspectClaim(f.env, f.engine, f.job.id);
  assert.equal(f.google.heads.get(f.job.id).state, "submitted");
  assert.equal(f.google.events.size, 1);
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_operations_v1 WHERE state='pending'",
      )
      .get().n,
    0,
  );
});
test("0012 preflight accepts only exact complete or entirely absent markers", (t) => {
  const f = fixture(t),
    schema = f.sql
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL",
      )
      .all();
  const stamps = Object.fromEntries(
    schema
      .filter((r) => r.name.includes("_schema_"))
      .map((r) => [
        r.name,
        Number(f.sql.prepare("SELECT version FROM " + r.name).get().version),
      ]),
  );
  const target = "0012_prospect_intake.sql",
    check = coordinationPreflight({ schema, stamps }, target);
  assert.equal(check.migration, "already_applied");
  assert.equal(
    coordinationPreflight(
      {
        schema: schema.filter((r) => !check.newMarkers.includes(r.name)),
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
            (r) => r.name !== "streamlion_prospect_challenges_v1",
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
        { schema, stamps: { ...stamps, streamlion_prospect_schema_v1: 0 } },
        target,
      ),
    /stamp mismatch/,
  );
});
test("share invitation creation retries preserve mode and provider ownership, with no invite email or charge", async (t) => {
  const f = fixture(t),
    google = googleFixture();
  for (const method of ["snapshot", "event", "projection"])
    t.mock.method(CoordinationGoogle.prototype, method, (...args) =>
      method === "snapshot"
        ? google.snapshot().then((s) => ({ ...s, rows: [[], [], [], []] }))
        : google[method](...args),
    );
  for (const subject of ["a", "b"])
    f.sql
      .prepare(
        "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at,workbook_id,folder_id) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        await hash(subject.repeat(43)),
        subject,
        subject + "@example.com",
        "encrypted",
        Date.now() + 86400000,
        "book-" + subject,
        "folder-" + subject,
      );
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at,revoked) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(
      "connection-b",
      "b",
      "test",
      "book-b",
      "folder-b",
      "encrypted",
      "Provider B",
      Date.now() + 86400000,
      0,
    );
  const call = (route, body, subject = "a") =>
    handleCoordination({
      env: f.env,
      params: { path: route.split("/") },
      request: new Request("https://app.example/api/coordination/" + route, {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: "__Host-streamlion-session=" + subject.repeat(43),
          Origin: "https://app.example",
          "Content-Type": "application/json",
          "X-StreamLion-Account": subject,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    });
  const input = {
    operation: "unknown-client",
    title: "",
    email: "",
    contactName: "DM prospect",
    companyName: "Example company",
    shareLink: true,
    preset: "tm-spatial",
  };
  delete f.env.COORDINATION_MAILER;
  const created = await call("provider/create", input);
  assert.equal(created.status, 200);
  const original = await created.json();
  assert.equal(
    (await (await call("provider/create", input)).json()).url,
    original.url,
  );
  const saved = google.heads.get(original.jobId);
  assert.equal(saved.fields.title, "");
  assert.equal(saved.fields.requesterName, "DM prospect");
  assert.equal(saved.fields.companyName, "Example company");
  assert.equal(saved.intake.estimateProfile, TM_ESTIMATE);
  f.env.COORDINATION_MAILER = {
    fetch: async () => {
      throw new Error("No external mail");
    },
  };
  assert.equal(
    (
      await call("provider/create", {
        ...input,
        shareLink: false,
        email: "client@example.com",
      })
    ).status,
    409,
  );
  const addressed = {
    ...input,
    operation: "addressed-prospect",
    email: "client@example.com",
  };
  assert.equal((await call("provider/create", addressed)).status, 200);
  assert.equal(
    (await call("provider/create", { ...addressed, shareLink: false })).status,
    409,
  );
  assert.equal((await call("provider/create", input, "b")).status, 409);
  assert.equal(
    (await call("provider/revoke-link", { jobId: original.jobId }, "b")).status,
    404,
  );
  assert.equal(
    (await (await call("provider/jobs", null, "b")).json()).links.length,
    0,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_coordination_outbox_v1")
      .get().n,
    0,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    0,
  );
  assert.equal(
    (await call("provider/revoke-link", { jobId: original.jobId })).status,
    200,
  );
  await assert.rejects(
    () =>
      openProspect(
        f.env,
        new URLSearchParams(new URL(original.url).hash.slice(1)).get("invite"),
      ),
    /unavailable/,
  );
});
test("background verified-claim recovery backs off before another Google attempt", async (t) => {
  const f = await prospectFixture(t);
  await requestProspectVerification(f.env, prospectBody(f));
  assert.equal(
    (
      await handleCoordination({
        env: f.env,
        request: verifyRequest(
          await verificationToken(f, "client@example.com"),
        ),
        params: { path: "client/verify" },
      })
    ).status,
    200,
  );
  f.sql.exec("UPDATE streamlion_coordination_outbox_v1 SET status='delivered'");
  let reads = 0;
  t.mock.method(CoordinationGoogle.prototype, "snapshot", async () => {
    reads++;
    throw new Error("Synthetic Google unavailable");
  });
  const now = Date.now();
  await maintainCoordination(f.env, now);
  assert.equal(reads, 1);
  const schedule = f.sql
    .prepare(
      "SELECT * FROM streamlion_coordination_work_schedule_v1 WHERE kind='recovery'",
    )
    .get();
  assert.equal(schedule.attempts, 1);
  assert.ok(schedule.next_attempt_at > now);
  await maintainCoordination(f.env, now + 1);
  assert.equal(reads, 1);
  assert.equal(
    f.sql
      .prepare(
        "SELECT claimed_at,synced_at,claim_payload FROM streamlion_prospect_links_v1",
      )
      .get().synced_at,
    null,
  );
});

const { randomProspectToken } = await import("../../server/prospect-intake.js");
const {
  createPublicForm,
  openPublicForm,
  submitPublicForm,
  syncPublicSubmission,
  verifyPublicSubmission,
  updatePublicForm,
  formsForProvider,
} = await import("../../server/public-intake.js");
async function publicFixture(t, verificationRequired = false) {
  const f = fixture(t),
    google = googleFixture(),
    engine = new CoordinationEngine(f.env, f.connection, google);
  const base = newClientJob({
    id: "public-base",
    provider: "a",
    clientEmail: "",
    title: "Private starting title",
    contactName: "Private contact",
    prospect: true,
    now: Date.now(),
  });
  const form = await createPublicForm(
    f.env,
    f.connection,
    "public-form-test",
    base,
    verificationRequired,
  );
  const token = new URLSearchParams(new URL(form.url).hash.slice(1)).get(
    "form",
  );
  const submit = (body) => submitPublicForm(f.env, body, () => engine);
  return { ...f, form, token, google, engine, submit };
}
const publicBody = (f, op = "lead-one", email = "") => ({
  token: f.token,
  operation: op,
  accessToken: randomProspectToken(),
  email,
  fields: {
    requesterName: "Synthetic prospect",
    address: "Synthetic site",
    scope: "Capture lobby. Exact 12 7/16 in.",
  },
});
function accessRequest(
  result,
  token = new URLSearchParams(new URL(result.url).hash.slice(1)).get("access"),
  jobId = result.jobId,
) {
  return new Request("https://app.example/api/coordination/client/access", {
    method: "POST",
    headers: {
      Origin: "https://app.example",
      "Content-Type": "application/json",
      "CF-Connecting-IP": "192.0.2.6",
    },
    body: JSON.stringify({ token, jobId }),
  });
}
test("public form opens without email and accepts independent anonymous requests with isolated status capabilities and no charges", async (t) => {
  const f = await publicFixture(t),
    descriptor = await openPublicForm(f.env, f.token);
  assert.equal(descriptor.verificationRequired, false);
  assert.equal(descriptor.reusable, true);
  assert.equal(JSON.stringify(descriptor).includes("Private contact"), false);
  assert.equal(
    JSON.stringify(descriptor).includes("Private starting title"),
    false,
  );
  const a = publicBody(f),
    b = publicBody(f, "lead-two");
  a.visit = descriptor.visit;
  const first = await f.submit(a),
    second = await f.submit(b),
    replay = await f.submit(a);
  assert.equal(first.jobId, replay.jobId);
  assert.equal(first.url, replay.url);
  assert.notEqual(first.jobId, second.jobId);
  assert.equal(f.google.heads.size, 2);
  assert.equal(f.google.events.size, 2);
  const job = f.google.heads.get(first.jobId);
  assert.equal(job.state, "submitted");
  assert.equal(job.fields.requesterEmail, "");
  assert.equal(job.emailVerified, false);
  assert.equal(job.fields.scope, a.fields.scope);
  assert.equal(job.providerApproved, false);
  assert.equal(job.accepted, null);
  assert.equal(job.requestExpiresAt - job.createdAt, 30 * 86400000);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1 WHERE id LIKE 'public-verify-%'",
      )
      .get().n,
    0,
  );
  const open = await handleCoordination({
    env: f.env,
    params: { path: "client/access" },
    request: accessRequest(first),
  });
  assert.equal(open.status, 200);
  assert.match(open.headers.get("Set-Cookie"), /HttpOnly/);
  const other = await handleCoordination({
    env: f.env,
    params: { path: "client/access" },
    request: accessRequest(first, a.accessToken, second.jobId),
  });
  assert.equal(other.status, 403);
  await assert.rejects(
    () => f.submit({ ...a, fields: { ...a.fields, scope: "Forged retry" } }),
    /identity changed/,
  );
  await assert.rejects(
    () =>
      f.submit({
        ...publicBody(f, "forged-finance"),
        fields: { ...a.fields, paidAmount: "10000" },
      }),
    /cannot be changed/,
  );
  await assert.rejects(
    () => openPublicForm(f.env, a.accessToken),
    /unavailable/,
  );
  assert.ok((await openPublicForm(f.env, f.token)).reusable);
});
test("public form email confirmation is optional, pinned per pending submission, single-use and isolated from other forms", async (t) => {
  const f = await publicFixture(t, true),
    body = publicBody(f, "verified-lead", "client@example.com");
  await assert.rejects(() => f.submit({ ...body, email: "" }), /valid email/);
  const receipt = await f.submit(body);
  assert.equal(receipt.verificationRequired, true);
  assert.equal(receipt.url, undefined);
  assert.equal(f.google.heads.size, 0);
  await f.submit(body);
  const notice = f.sql
    .prepare(
      "SELECT * FROM streamlion_coordination_outbox_v1 WHERE id LIKE 'public-verify-%'",
    )
    .get();
  const mail = await unseal(f.env, notice.payload, "mail:" + notice.id),
    challenge = new URLSearchParams(new URL(mail.url).hash.slice(1)).get(
      "verify",
    );
  await updatePublicForm(f.env, f.connection, {
    formId: f.form.id,
    active: true,
    verificationRequired: false,
  });
  assert.equal((await f.submit(body)).verificationRequired, true);
  const session = randomProspectToken();
  assert.equal(
    await verifyPublicSubmission(
      f.env,
      await hash(challenge),
      await hash(session),
      Date.now(),
    ),
    true,
  );
  await syncPublicSubmission(f.env, f.engine, "job-public-verified-lead");
  assert.equal(
    f.google.heads.get("job-public-verified-lead").emailVerified,
    true,
  );
  await assert.rejects(
    async () =>
      verifyPublicSubmission(
        f.env,
        await hash(challenge),
        await hash(randomProspectToken()),
        Date.now(),
      ),
    /expired or already used/,
  );
  const anonymous = await f.submit(publicBody(f, "anonymous-after-toggle"));
  assert.ok(anonymous.url);
  assert.equal(f.google.heads.get(anonymous.jobId).emailVerified, false);
  assert.equal(
    (await formsForProvider(f.env, { ...f.connection, id: "connection-b" }))
      .length,
    0,
  );
  await assert.rejects(
    () =>
      updatePublicForm(
        f.env,
        { ...f.connection, id: "connection-b" },
        { formId: f.form.id, active: false, verificationRequired: false },
      ),
    /unavailable/,
  );
});
test("public intake preserves and recovers an interrupted original Google operation without duplicating the request", async (t) => {
  const f = await publicFixture(t),
    body = publicBody(f),
    event = f.google.event.bind(f.google);
  let fail = true;
  f.google.event = async (e) => {
    await event(e);
    if (fail) throw new Error("Synthetic Google interruption");
  };
  await assert.rejects(() => f.submit(body), /interruption/);
  assert.equal(f.google.events.size, 1);
  assert.equal(
    f.sql.prepare("SELECT state FROM streamlion_public_submissions_v1").get()
      .state,
    "pending",
  );
  await updatePublicForm(f.env, f.connection, {
    formId: f.form.id,
    active: true,
    verificationRequired: true,
  });
  fail = false;
  const retry = await f.submit(body);
  assert.ok(retry.url);
  assert.equal(f.google.events.size, 1);
  assert.equal(
    f.sql.prepare("SELECT payload FROM streamlion_public_submissions_v1").get()
      .payload,
    null,
  );
});
test("public forms fail closed for paused forms, revoked or refunded providers and full inboxes", async (t) => {
  const f = await publicFixture(t);
  await updatePublicForm(f.env, f.connection, {
    formId: f.form.id,
    active: false,
    verificationRequired: false,
  });
  await assert.rejects(() => f.submit(publicBody(f)), /unavailable/);
  await updatePublicForm(f.env, f.connection, {
    formId: f.form.id,
    active: true,
    verificationRequired: false,
  });
  f.sql.exec(
    "UPDATE streamlion_purchases_v1 SET status='refunded' WHERE google_subject='a'",
  );
  await assert.rejects(() => openPublicForm(f.env, f.token), /unavailable/);
  f.sql.exec(
    "UPDATE streamlion_purchases_v1 SET status='paid' WHERE google_subject='a'",
  );
  for (let i = 0; i < 100; i++)
    f.sql
      .prepare(
        "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES(?,'connection-a',?,'sealed',1)",
      )
      .run("capacity-" + i, "capacity-" + i);
  await assert.rejects(() => f.submit(publicBody(f)), /inbox is full/);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_public_submissions_v1")
      .get().n,
    0,
  );
});
test("provider can decline a public request silently or email an optional response, with 30-day read-only status", async (t) => {
  const f = await publicFixture(t),
    silent = await f.submit(publicBody(f, "silent", "client@example.com"));
  const before = f.sql
    .prepare(
      "SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1 WHERE id LIKE '%-client'",
    )
    .get().n;
  await f.engine.command(
    "silent-decline",
    silent.jobId,
    {
      action: "decline",
      expectedRevision: 0,
      reason: "Unavailable on that date",
      notify: false,
    },
    { role: "provider" },
  );
  const job = f.google.heads.get(silent.jobId);
  assert.equal(job.state, "declined");
  assert.equal(job.archiveAt - job.closedAt, 30 * 86400000);
  assert.equal(job.declineMessage, "Unavailable on that date");
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1 WHERE id LIKE '%-client'",
      )
      .get().n,
    before,
  );
  await assert.rejects(
    () =>
      f.engine.command(
        "client-edit-declined",
        silent.jobId,
        {
          action: "edit",
          expectedRevision: job.revision,
          fields: { scope: "Changed" },
        },
        { role: "client" },
      ),
    /read-only/,
  );
  const notified = await f.submit(
    publicBody(f, "notify", "client@example.com"),
  );
  await f.engine.command(
    "notify-decline",
    notified.jobId,
    { action: "decline", expectedRevision: 0, reason: "", notify: true },
    { role: "provider" },
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1 WHERE id='notice-notify-decline-client'",
      )
      .get().n,
    1,
  );
  const noEmail = await f.submit(publicBody(f, "no-email"));
  await assert.rejects(
    () =>
      f.engine.command(
        "missing-email-decline",
        noEmail.jobId,
        { action: "decline", expectedRevision: 0, reason: "", notify: true },
        { role: "provider" },
      ),
    /No client email/,
  );
});

test("unaccepted public requests expire at 30 days but agreed work is preserved", async (t) => {
  const f = await publicFixture(t),
    receipt = await f.submit(publicBody(f)),
    job = f.google.heads.get(receipt.jobId);
  assert.throws(
    () =>
      reduceClientJob(
        job,
        { action: "expire_request", expectedRevision: job.revision },
        { role: "system" },
        job.requestExpiresAt - 1,
      ),
    /cannot expire/,
  );
  assert.throws(
    () =>
      reduceClientJob(
        { ...job, accepted: { title: "Agreed" } },
        { action: "expire_request", expectedRevision: job.revision },
        { role: "system" },
        job.requestExpiresAt,
      ),
    /cannot expire/,
  );
  const expired = reduceClientJob(
    job,
    { action: "expire_request", expectedRevision: job.revision },
    { role: "system" },
    job.requestExpiresAt,
  );
  assert.equal(expired.state, "expired");
  assert.equal(expired.closedAt, job.requestExpiresAt);
  assert.equal(expired.archiveAt, job.requestExpiresAt);
  f.sql
    .prepare(
      "UPDATE streamlion_coordination_sessions_v1 SET expires_at=? WHERE job_id=?",
    )
    .run(Date.now() - 1, job.id);
  assert.equal(
    (
      await handleCoordination({
        env: f.env,
        params: { path: "client/access" },
        request: accessRequest(receipt),
      })
    ).status,
    401,
  );
});
test("0013 preflight requires exact 0012 prerequisites and all-or-none public intake markers", async () => {
  const { coordinationPreflight } =
    await import("../../scripts/preflight-coordination.mjs");
  const sql = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(
      new URL("../../migrations/", import.meta.url),
    )
      .filter((n) => n.endsWith(".sql") && n < "0013")
      .sort())
      sql.exec(
        readFileSync(
          new URL("../../migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
    const inspection = () => {
      const schema = sql
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL",
        )
        .all();
      return {
        schema,
        stamps: Object.fromEntries(
          schema
            .filter((r) => r.name.includes("_schema_"))
            .map((r) => [
              r.name,
              sql.prepare("SELECT version FROM " + r.name).get().version,
            ]),
        ),
      };
    };
    assert.equal(
      coordinationPreflight(inspection(), "0013_public_intake.sql").migration,
      "pending",
    );
    sql.exec(
      readFileSync(
        new URL("../../migrations/0013_public_intake.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(
      coordinationPreflight(inspection(), "0013_public_intake.sql").migration,
      "already_applied",
    );
    const partial = inspection();
    partial.schema = partial.schema.filter(
      (r) => r.name !== "streamlion_public_pending_v1",
    );
    assert.throws(
      () => coordinationPreflight(partial, "0013_public_intake.sql"),
      /Partial/,
    );
    const mismatch = inspection();
    mismatch.stamps.streamlion_public_intake_schema_v1 = 2;
    assert.throws(
      () => coordinationPreflight(mismatch, "0013_public_intake.sql"),
      /Version stamp mismatch/,
    );
  } finally {
    sql.close();
  }
});

test("parallel public confirmation consumes once and creates exactly one session, even in the same millisecond", async (t) => {
  const f = await publicFixture(t, true);
  await f.submit(publicBody(f, "parallel-confirm", "client@example.com"));
  const s = f.sql
      .prepare("SELECT * FROM streamlion_public_submissions_v1")
      .get(),
    now = Date.now();
  const results = await Promise.allSettled([
    verifyPublicSubmission(
      f.env,
      s.challenge_hash,
      await hash(randomProspectToken()),
      now,
    ),
    verifyPublicSubmission(
      f.env,
      s.challenge_hash,
      await hash(randomProspectToken()),
      now,
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_sessions_v1")
      .get().n,
    1,
  );
});
test("public confirmation rechecks provider eligibility atomically before granting access", async (t) => {
  const f = await publicFixture(t, true);
  await f.submit(publicBody(f, "refund-race", "client@example.com"));
  const s = f.sql
      .prepare("SELECT * FROM streamlion_public_submissions_v1")
      .get(),
    batch = f.env.GOOGLE_SESSIONS.batch;
  f.env.GOOGLE_SESSIONS.batch = async (list) => {
    f.sql.exec(
      "UPDATE streamlion_purchases_v1 SET status='refunded' WHERE google_subject='a'",
    );
    return batch(list);
  };
  await assert.rejects(
    () =>
      verifyPublicSubmission(
        f.env,
        s.challenge_hash,
        "synthetic-session-hash",
        Date.now(),
      ),
    /expired or already used/,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_sessions_v1")
      .get().n,
    0,
  );
  assert.equal(
    f.sql.prepare("SELECT state FROM streamlion_public_submissions_v1").get()
      .state,
    "verification",
  );
});

test("maintenance expires unconfirmed public drafts and clears temporary personal data without a Google job", async (t) => {
  const f = await publicFixture(t, true);
  await f.submit(publicBody(f, "never-confirmed", "client@example.com"));
  const now = Date.now() + 31 * 86400000;
  // This test models the one-year grant; the shared fixture expires tomorrow.
  f.sql
    .prepare(
      "UPDATE streamlion_coordination_connections_v1 SET expires_at=? WHERE id=?",
    )
    .run(now + 86400000, f.connection.id);
  await maintainCoordination(f.env, now);
  const s = f.sql
      .prepare("SELECT * FROM streamlion_public_submissions_v1")
      .get(),
    j = f.sql
      .prepare("SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?")
      .get(s.job_id);
  assert.equal(s.state, "expired");
  assert.equal(s.payload, null);
  assert.equal(s.challenge_token, null);
  assert.equal(j.archived, 1);
  assert.equal(j.closed_at, now);
  assert.equal(f.google.heads.size, 0);
});

for (const mode of ["disconnected", "refunded", "grant-expired", "paused"]) {
  test(`unconfirmed public privacy cleanup survives ${mode}`, async (t) => {
    const f = await publicFixture(t, true);
    await f.submit(publicBody(f, "privacy-" + mode, "client@example.com"));
    if (mode === "disconnected")
      f.sql.exec("UPDATE streamlion_coordination_connections_v1 SET revoked=1");
    if (mode === "refunded")
      f.sql.exec("UPDATE streamlion_purchases_v1 SET status='refunded'");
    if (mode === "grant-expired")
      f.sql.exec(
        "UPDATE streamlion_coordination_connections_v1 SET expires_at=1",
      );
    if (mode === "paused") f.env.ENABLE_CLIENT_COORDINATION = "false";
    await maintainCoordination(f.env, Date.now() + 31 * 86400000);
    const s = f.sql
      .prepare("SELECT * FROM streamlion_public_submissions_v1")
      .get();
    assert.equal(s.state, "expired");
    for (const field of [
      "payload",
      "challenge_hash",
      "challenge_token",
      "challenge_expires",
      "verified_session_hash",
    ])
      assert.equal(s[field], null);
    const j = f.sql
      .prepare("SELECT * FROM streamlion_coordination_jobs_v1")
      .get();
    assert.equal(j.archived, 1);
    assert.equal(j.client_email, "");
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1 WHERE id LIKE 'public-verify-%'",
        )
        .get().n,
      0,
    );
    assert.equal(f.google.heads.size, 0);
  });
}

test("overdue completed public request closes while disconnected and reconciles after renewal using a bounded identity", async (t) => {
  const f = await publicFixture(t);
  const receipt = await f.submit(publicBody(f, "x".repeat(73)));
  const jobId = receipt.jobId;
  const job = f.google.heads.get(jobId);
  assert.ok(job);
  job.requestExpiresAt = Date.now() - 1;
  f.sql
    .prepare(
      "UPDATE streamlion_public_submissions_v1 SET expires_at=? WHERE job_id=?",
    )
    .run(job.requestExpiresAt, jobId);
  f.sql.exec("UPDATE streamlion_coordination_connections_v1 SET revoked=1");
  await maintainCoordination(f.env);
  assert.equal(
    f.sql
      .prepare(
        "SELECT state FROM streamlion_public_submissions_v1 WHERE job_id=?",
      )
      .get(jobId).state,
    "expired",
  );
  assert.ok(
    f.sql
      .prepare(
        "SELECT closed_at FROM streamlion_coordination_jobs_v1 WHERE id=?",
      )
      .get(jobId).closed_at,
  );
  assert.equal(f.google.heads.get(jobId).state, "submitted");
  await assert.rejects(
    () =>
      f.engine.command(
        "cannot-resurrect",
        jobId,
        {
          action: "edit",
          fields: { scope: "Expired correction" },
          expectedRevision: job.revision,
        },
        { role: "provider" },
      ),
    /expired|closed/i,
  );
  f.sql.exec("UPDATE streamlion_coordination_connections_v1 SET revoked=0");
  await syncPublicSubmission(f.env, f.engine, jobId);
  assert.equal(f.google.heads.get(jobId).state, "expired");
  const id = await hash("public-expiry:" + "public-" + "x".repeat(73));
  assert.equal(id.length, 43);
  assert.equal((await f.engine.operation(id)).state, "complete");
  await syncPublicSubmission(f.env, f.engine, jobId);
  assert.equal(f.google.events.size, 2);
});

test("concurrent public form creation atomically admits only the twentieth form and retains retry identity", async (t) => {
  const f = await publicFixture(t);
  const base = newClientJob({
    id: "base-limit",
    provider: "a",
    clientEmail: "",
    title: "",
    prospect: true,
    now: Date.now(),
  });
  for (let i = 1; i < 19; i++)
    await createPublicForm(f.env, f.connection, "form-limit-" + i, base);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      createPublicForm(f.env, f.connection, "racing-form-" + i, base),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_public_forms_v1").get()
      .n,
    20,
  );
  const winner = results.findIndex((r) => r.status === "fulfilled");
  assert.deepEqual(
    await createPublicForm(f.env, f.connection, "racing-form-" + winner, base),
    results[winner].value,
  );
});

test("expiry cleanup preserves accepted requests and an unresolved agreement journal", async (t) => {
  const f = await publicFixture(t);
  const first = await f.submit(publicBody(f, "accepted-retention"));
  const second = await f.submit(publicBody(f, "pending-agreement"));
  f.sql
    .prepare(
      "UPDATE streamlion_public_submissions_v1 SET expires_at=0 WHERE job_id=?",
    )
    .run(first.jobId);
  f.sql
    .prepare(
      "UPDATE streamlion_public_submissions_v1 SET expires_at=1 WHERE job_id=?",
    )
    .run(second.jobId);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES('agreement-in-flight',?,?,'provider','synthetic','encrypted',1)",
    )
    .run(f.connection.id, second.jobId);
  f.env.ENABLE_CLIENT_COORDINATION = "false";
  await maintainCoordination(f.env);
  for (const id of [first.jobId, second.jobId]) {
    assert.equal(
      f.sql
        .prepare(
          "SELECT closed_at FROM streamlion_coordination_jobs_v1 WHERE id=?",
        )
        .get(id).closed_at,
      null,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT state FROM streamlion_public_submissions_v1 WHERE job_id=?",
        )
        .get(id).state,
      "complete",
    );
  }
});

test("concurrent retries of the final public form return the same capability", async (t) => {
  const f = await publicFixture(t);
  const base = newClientJob({
    id: "retry-limit",
    provider: "a",
    clientEmail: "",
    title: "",
    prospect: true,
    now: Date.now(),
  });
  for (let i = 1; i < 19; i++)
    await createPublicForm(f.env, f.connection, "retry-limit-" + i, base);
  const forms = await Promise.all(
    Array.from({ length: 6 }, () =>
      createPublicForm(f.env, f.connection, "last-shared-identity", base),
    ),
  );
  for (const form of forms) assert.deepEqual(form, forms[0]);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_public_forms_v1").get()
      .n,
    20,
  );
});

for (const mode of ["refunded", "grant-expired", "paused"]) {
  test(`overdue submitted public requests close without Google writes while ${mode}`, async (t) => {
    const f = await publicFixture(t);
    const receipt = await f.submit(publicBody(f, "submitted-" + mode));
    f.sql
      .prepare(
        "UPDATE streamlion_public_submissions_v1 SET expires_at=1 WHERE job_id=?",
      )
      .run(receipt.jobId);
    if (mode === "refunded")
      f.sql.exec("UPDATE streamlion_purchases_v1 SET status='refunded'");
    if (mode === "grant-expired")
      f.sql.exec(
        "UPDATE streamlion_coordination_connections_v1 SET expires_at=1",
      );
    if (mode === "paused") f.env.ENABLE_CLIENT_COORDINATION = "false";
    t.mock.method(CoordinationGoogle.prototype, "snapshot", async () => {
      throw new Error("Unexpected Google access");
    });
    const result = await maintainCoordination(f.env);
    assert.equal(result.retained, 0);
    assert.equal(
      f.sql
        .prepare(
          "SELECT state FROM streamlion_public_submissions_v1 WHERE job_id=?",
        )
        .get(receipt.jobId).state,
      "expired",
    );
    assert.ok(
      f.sql
        .prepare(
          "SELECT closed_at FROM streamlion_coordination_jobs_v1 WHERE id=?",
        )
        .get(receipt.jobId).closed_at,
    );
    assert.equal(f.google.events.size, 1);
  });
}
