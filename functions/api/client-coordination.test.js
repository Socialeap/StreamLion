import { expectedAdminSchema } from "../../scripts/preflight-admin.mjs";
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
    async withWriteSnapshot(callback) {
      return callback({
        event: (event) => this.event(event),
        projection: (revision) => this.projection(revision),
        verify: async () => {},
      });
    },
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
  assert.equal(queries, 1);
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
  const schema = expectedAdminSchema(false).schema.filter((r) =>
    r.name.startsWith("streamlion_"),
  );
  // Pending older migrations are tested before the source-aware 0025 successor.
  // Removing its prerequisites while retaining 0025 would be an unsafe partial state.
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
  assert.equal((await sharedWallet(db, "test", "a")).available, 7500000);
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
  assert.equal((await sharedWallet(db, "test", "a")).available, 7500000);
  await engine.command("confirm", job.id, command, { role: "client" });
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    0,
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
  // Model a link sealed before provider pricing existed, preserving legacy quote recovery tests.
  const legacy = f.sql
    .prepare("SELECT * FROM streamlion_prospect_links_v1 WHERE job_id=?")
    .get(job.id);
  const descriptor = await unseal(
    f.env,
    legacy.public_intake,
    "prospect-public:" + job.id,
  );
  delete descriptor.pricing;
  f.sql
    .prepare(
      "UPDATE streamlion_prospect_links_v1 SET public_intake=? WHERE job_id=?",
    )
    .run(await seal(f.env, descriptor, "prospect-public:" + job.id), job.id);
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
    schema = expectedAdminSchema(false).schema.filter((r) =>
      r.name.startsWith("streamlion_"),
    );
  // Pending older migrations are tested before the source-aware 0025 successor.
  // Removing its prerequisites while retaining 0025 would be an unsafe partial state.
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
test("expired public verification is renewed through matching-email recovery without replacing answers or creating another request", async (t) => {
  const f = await publicFixture(t, true),
    body = publicBody(f, "recover-verification", "client@example.com");
  Object.assign(body.fields, {
    title: "QA venue",
    propertySizeSqFt: "8400",
    address2: "Floor 3",
    city: "New York",
    region: "NY",
    postal: "10001",
    country: "United States",
    accessInstructions: "Escorted entry. Elevator dimensions unknown.",
    deliverables: "35–45 photos; measurements in feet and inches.",
    proposedTimes: "October 27, 2026, 9 AM–1 PM Eastern",
    deliveryDeadline: "October 30, 2026, 5 PM Eastern",
    notes: "No survey-grade measurements.",
    companyName: "QA Events",
    contact1Phone: "212-555-0147",
  });
  const receipt = await f.submit(body),
    id = "job-public-recover-verification";
  assert.equal(receipt.jobId, id);
  assert.equal(new URL(receipt.verificationUrl).searchParams.get("job"), id);
  const before = f.sql
    .prepare("SELECT * FROM streamlion_public_submissions_v1 WHERE job_id=?")
    .get(id);
  const priorNotice = f.sql
    .prepare("SELECT * FROM streamlion_coordination_outbox_v1 WHERE job_id=?")
    .get(id);
  f.sql
    .prepare(
      "UPDATE streamlion_public_submissions_v1 SET challenge_expires=? WHERE job_id=?",
    )
    .run(Date.now() - 1, id);
  f.sql
    .prepare(
      "UPDATE streamlion_coordination_outbox_v1 SET status='skipped',payload=? WHERE id=?",
    )
    .run(
      await seal(f.env, { skipped: true }, "mail:" + priorNotice.id),
      priorNotice.id,
    );
  const request = (email) =>
    handleCoordination({
      env: f.env,
      params: { path: "client/request" },
      request: new Request(
        "https://app.example/api/coordination/client/request",
        {
          method: "POST",
          headers: {
            Origin: "https://app.example",
            "Content-Type": "application/json",
            "CF-Connecting-IP": "192.0.2.17",
          },
          body: JSON.stringify({ jobId: id, email }),
        },
      ),
    });
  assert.equal((await request("other@example.com")).status, 200);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1")
      .get().n,
    1,
  );
  const recovered = await request(body.email);
  assert.equal(recovered.status, 200);
  const after = f.sql
    .prepare("SELECT * FROM streamlion_public_submissions_v1 WHERE job_id=?")
    .get(id);
  for (const key of [
    "job_id",
    "form_id",
    "operation",
    "fingerprint",
    "access_hash",
    "payload",
    "created_at",
    "expires_at",
    "state",
  ])
    assert.equal(after[key], before[key], key);
  assert.notEqual(after.challenge_hash, before.challenge_hash);
  assert.ok(after.challenge_expires > Date.now());
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_jobs_v1")
      .get().n,
    1,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_coordination_challenges_v1",
      )
      .get().n,
    0,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT status FROM streamlion_coordination_outbox_v1 WHERE id=?",
      )
      .get(priorNotice.id).status,
    "skipped",
  );
  await request(body.email);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1")
      .get().n,
    2,
  );
  const notice = f.sql
    .prepare("SELECT * FROM streamlion_coordination_outbox_v1 WHERE id!=?")
    .get(priorNotice.id);
  const mail = await unseal(f.env, notice.payload, "mail:" + notice.id);
  assert.equal(mail.to, body.email);
  assert.equal(mail.subject, "Confirm your work-order request");
  const token = new URLSearchParams(new URL(mail.url).hash.slice(1)).get(
    "verify",
  );
  assert.equal(
    await verifyPublicSubmission(
      f.env,
      await hash(token),
      await hash(randomProspectToken()),
      Date.now(),
    ),
    true,
  );
  await syncPublicSubmission(f.env, f.engine, id);
  const job = f.google.heads.get(id);
  for (const [key, value] of Object.entries(body.fields))
    assert.equal(job.fields[key], value, key);
  assert.equal(job.fields.requesterEmail, body.email);
  assert.equal(job.emailVerified, true);
  assert.equal(f.google.heads.size, 1);
  await syncPublicSubmission(f.env, f.engine, id);
  assert.equal(f.google.events.size, 1);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
});
test("public email verification rejects unapproved recipients before creating a stranded request", async (t) => {
  const f = await publicFixture(t, true);
  Object.assign(f.env, {
    ENABLE_RESEND_EMAIL: "true",
    RESEND_API_KEY: "synthetic",
    RESEND_FROM_EMAIL: "projects@example.com",
    RESEND_DAILY_LIMIT: "20",
    RESEND_MONTHLY_LIMIT: "500",
    RESEND_TEST_RECIPIENTS: "owner@example.com",
  });
  await assert.rejects(
    () => f.submit(publicBody(f, "blocked-client", "client@example.com")),
    /email.*test|recipient/i,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_jobs_v1")
      .get().n,
    0,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_public_submissions_v1")
      .get().n,
    0,
  );
  assert.equal(f.google.heads.size, 0);
});
test("concurrent public confirmation recovery queues one fresh challenge and invalidates the expired token", async (t) => {
  const f = await publicFixture(t, true),
    body = publicBody(f, "concurrent-recovery", "client@example.com");
  await f.submit(body);
  const id = "job-public-concurrent-recovery",
    before = f.sql
      .prepare("SELECT * FROM streamlion_public_submissions_v1")
      .get();
  f.sql
    .prepare("UPDATE streamlion_public_submissions_v1 SET challenge_expires=1")
    .run();
  const { renewPublicVerification } =
      await import("../../server/public-intake.js"),
    row = f.sql
      .prepare("SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?")
      .get(id);
  await Promise.all([
    renewPublicVerification(f.env, row),
    renewPublicVerification(f.env, row),
  ]);
  const after = f.sql
    .prepare("SELECT * FROM streamlion_public_submissions_v1")
    .get();
  assert.notEqual(after.challenge_hash, before.challenge_hash);
  assert.equal(after.payload, before.payload);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1")
      .get().n,
    2,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_public_submissions_v1")
      .get().n,
    1,
  );
  assert.equal(
    await verifyPublicSubmission(
      f.env,
      before.challenge_hash,
      await hash(randomProspectToken()),
      Date.now(),
    ),
    false,
  );
});
test("a skipped public confirmation can recover before token expiry without replaying its old outbox record", async (t) => {
  const f = await publicFixture(t, true),
    body = publicBody(f, "skipped-recovery", "client@example.com");
  await f.submit(body);
  const before = f.sql
      .prepare("SELECT * FROM streamlion_public_submissions_v1")
      .get(),
    notice = f.sql
      .prepare("SELECT * FROM streamlion_coordination_outbox_v1")
      .get();
  f.sql
    .prepare("UPDATE streamlion_coordination_outbox_v1 SET status='skipped'")
    .run();
  const { renewPublicVerification } =
    await import("../../server/public-intake.js");
  await renewPublicVerification(
    f.env,
    f.sql.prepare("SELECT * FROM streamlion_coordination_jobs_v1").get(),
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT status FROM streamlion_coordination_outbox_v1 WHERE id=?",
      )
      .get(notice.id).status,
    "skipped",
  );
  const after = f.sql
    .prepare("SELECT * FROM streamlion_public_submissions_v1")
    .get();
  assert.notEqual(after.challenge_hash, before.challenge_hash);
  assert.equal(after.payload, before.payload);
});
for (const paused of [false, true]) {
  test(
    "verified pending public request recovers lost-cookie sign-in; paused=" +
      paused,
    async (t) => {
      const f = await publicFixture(t, true);
      const body = publicBody(f, "pending-signin", "client@example.com");
      await f.submit(body);
      const id = "job-public-pending-signin";
      const original = f.sql
        .prepare("SELECT * FROM streamlion_public_submissions_v1")
        .get();
      assert.equal(
        await verifyPublicSubmission(
          f.env,
          original.challenge_hash,
          await hash(randomProspectToken()),
          Date.now(),
        ),
        true,
      );
      if (paused)
        f.sql.prepare("UPDATE streamlion_public_forms_v1 SET active=0").run();
      const pending = f.sql
        .prepare("SELECT * FROM streamlion_public_submissions_v1")
        .get();
      assert.equal(pending.state, "pending");
      assert.equal(f.google.heads.size, 0);
      const post = (route, data) =>
        handleCoordination({
          env: f.env,
          params: { path: route },
          request: new Request(
            "https://app.example/api/coordination/" + route,
            {
              method: "POST",
              headers: {
                Origin: "https://app.example",
                "Content-Type": "application/json",
                "CF-Connecting-IP": "192.0.2.29",
              },
              body: JSON.stringify(data),
            },
          ),
        });
      const response = await post("client/request", {
        jobId: id,
        email: body.email,
      });
      assert.equal(response.status, 200);
      const notice = f.sql
        .prepare(
          "SELECT * FROM streamlion_coordination_outbox_v1 WHERE id LIKE 'invite-%'",
        )
        .get();
      assert.ok(
        notice,
        "normal sign-in is queued while synchronization remains pending",
      );
      const mail = await unseal(f.env, notice.payload, "mail:" + notice.id);
      assert.equal(mail.to, body.email);
      assert.equal(mail.subject, "Open your StreamLion project");
      const token = new URLSearchParams(new URL(mail.url).hash.slice(1)).get(
        "verify",
      );
      const verified = await post("client/verify", { token });
      assert.equal(verified.status, 200);
      assert.match(verified.headers.get("Set-Cookie"), /HttpOnly/i);
      assert.equal((await post("client/verify", { token })).status, 401);
      assert.deepEqual(
        f.sql.prepare("SELECT * FROM streamlion_public_submissions_v1").get(),
        pending,
      );
      await syncPublicSubmission(f.env, f.engine, id);
      await syncPublicSubmission(f.env, f.engine, id);
      for (const [key, value] of Object.entries(body.fields))
        assert.equal(f.google.heads.get(id).fields[key], value, key);
      assert.equal(f.google.heads.size, 1);
      assert.equal(f.google.events.size, 1);
      assert.equal(
        f.sql
          .prepare("SELECT COUNT(*) AS n FROM streamlion_public_submissions_v1")
          .get().n,
        1,
      );
      assert.equal(
        f.sql
          .prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1")
          .get().n,
        0,
      );
    },
  );
}
for (const scenario of [
  "expired request",
  "paused form",
  "revoked provider",
  "refunded provider",
  "closed request",
  "blocked recipient",
]) {
  test(
    "public verification recovery fails closed for " + scenario,
    async (t) => {
      const f = await publicFixture(t, true),
        body = publicBody(f, "guarded-recovery", "client@example.com");
      await f.submit(body);
      f.sql
        .prepare(
          "UPDATE streamlion_public_submissions_v1 SET challenge_expires=1",
        )
        .run();
      if (scenario === "expired request")
        f.sql
          .prepare("UPDATE streamlion_public_submissions_v1 SET expires_at=1")
          .run();
      if (scenario === "paused form")
        f.sql.prepare("UPDATE streamlion_public_forms_v1 SET active=0").run();
      if (scenario === "revoked provider")
        f.sql
          .prepare(
            "UPDATE streamlion_coordination_connections_v1 SET revoked=1",
          )
          .run();
      if (scenario === "refunded provider")
        f.sql
          .prepare("UPDATE streamlion_purchases_v1 SET status='refunded'")
          .run();
      if (scenario === "closed request")
        f.sql
          .prepare("UPDATE streamlion_coordination_jobs_v1 SET closed_at=1")
          .run();
      if (scenario === "blocked recipient")
        Object.assign(f.env, {
          ENABLE_RESEND_EMAIL: "true",
          RESEND_API_KEY: "synthetic",
          RESEND_FROM_EMAIL: "projects@example.com",
          RESEND_DAILY_LIMIT: "20",
          RESEND_MONTHLY_LIMIT: "500",
          RESEND_TEST_RECIPIENTS: "owner@example.com",
        });
      const before = f.sql
        .prepare("SELECT * FROM streamlion_public_submissions_v1")
        .get();
      const recover = (email) =>
        handleCoordination({
          env: f.env,
          params: { path: "client/request" },
          request: new Request(
            "https://app.example/api/coordination/client/request",
            {
              method: "POST",
              headers: {
                Origin: "https://app.example",
                "Content-Type": "application/json",
                "CF-Connecting-IP": "192.0.2.18",
              },
              body: JSON.stringify({
                jobId: "job-public-guarded-recovery",
                email,
              }),
            },
          ),
        });
      const unmatched = await recover("other@example.com");
      const response = await recover(body.email);
      assert.equal(unmatched.status, 200);
      assert.deepEqual([...response.headers], [...unmatched.headers]);
      assert.deepEqual(await response.clone().json(), await unmatched.json());
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        message:
          "If the details match an open project, a private sign-in link will be sent.",
      });
      assert.deepEqual(
        f.sql.prepare("SELECT * FROM streamlion_public_submissions_v1").get(),
        before,
      );
      assert.equal(
        f.sql
          .prepare(
            "SELECT COUNT(*) AS n FROM streamlion_coordination_outbox_v1",
          )
          .get().n,
        1,
      );
      assert.equal(
        f.sql
          .prepare(
            "SELECT COUNT(*) AS n FROM streamlion_coordination_challenges_v1",
          )
          .get().n,
        0,
      );
      assert.equal(
        f.sql
          .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_jobs_v1")
          .get().n,
        1,
      );
    },
  );
}
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
    if (mode === "paused") {
      f.env.ENABLE_CLIENT_COORDINATION = "false";
      const hour = Math.floor((Date.now() + 31 * 86400000) / 3600000);
      f.sql
        .prepare(
          "INSERT INTO streamlion_coordination_rates_v1(key,window,count) VALUES(?,?,1)",
        )
        .run("old-scheduler-nonce", hour - 25);
      f.sql
        .prepare(
          "INSERT INTO streamlion_coordination_rates_v1(key,window,count) VALUES(?,?,1)",
        )
        .run("recent-scheduler-nonce", hour);
    }
    await maintainCoordination(f.env, Date.now() + 31 * 86400000);
    if (mode === "paused") {
      assert.equal(
        f.sql
          .prepare(
            "SELECT key FROM streamlion_coordination_rates_v1 WHERE key='old-scheduler-nonce'",
          )
          .get(),
        undefined,
      );
      assert.ok(
        f.sql
          .prepare(
            "SELECT key FROM streamlion_coordination_rates_v1 WHERE key='recent-scheduler-nonce'",
          )
          .get(),
      );
    }
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

test("saved business branding follows the link owner; a forwarded TM preset form never changes its recipient", async (t) => {
  const f = await publicFixture(t);
  const connectionB = {
    ...f.connection,
    id: "connection-b",
    google_subject: "b",
    workbook_id: "book-b",
    folder_id: "folder-b",
    client_brand: "Provider B",
  };
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at,revoked) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(...Object.values(connectionB));
  const brandingA = {
    name: "Harbor Capture",
    website: "https://example.com",
    logo: "",
    shape: "rectangle",
  };
  const brandingB = {
    ...brandingA,
    name: "Another Provider",
    website: "https://other.example",
  };
  for (const [subject, branding] of [
    ["a", brandingA],
    ["b", brandingB],
  ])
    f.sql
      .prepare(
        "INSERT INTO streamlion_provider_branding_v1 VALUES('test',?,?,1,?)",
      )
      .run(subject, JSON.stringify(branding), Date.now());
  // This token predates the saved profile and originally displayed "Provider".
  const opened = await openPublicForm(f.env, f.token);
  assert.equal(opened.brand, "Harbor Capture");
  assert.deepEqual(opened.branding, brandingA);
  assert.equal(
    (await formsForProvider(f.env, f.connection))[0].brand,
    "Harbor Capture",
  );
  assert.deepEqual(await formsForProvider(f.env, connectionB), []);
  const result = await f.submit({
    ...publicBody(f, "branded-lead"),
    connectionId: "connection-b",
    branding: brandingB,
  });
  assert.equal(
    f.sql
      .prepare(
        "SELECT connection_id FROM streamlion_coordination_jobs_v1 WHERE id=?",
      )
      .get(result.jobId).connection_id,
    "connection-a",
  );
  const row = f.sql
    .prepare("SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?")
    .get(result.jobId);
  const privateURL = await createProspectLink(
    f.env,
    row,
    { intake: { name: "Optional TM preset" }, fields: {} },
    f.connection,
  );
  const privateToken = new URLSearchParams(
    new URL(privateURL).hash.slice(1),
  ).get("invite");
  const privateView = await openProspect(f.env, privateToken);
  assert.deepEqual(privateView.branding, brandingA);
  assert.equal(privateView.brand, "Harbor Capture");
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
});

test("public form retry after a lost response survives branding changes and retains immutable identity guards", async (t) => {
  const f = await publicFixture(t);
  const branding = {
    name: "Renamed Provider",
    website: "https://example.com",
    logo: "",
    shape: "square",
  };
  f.sql
    .prepare(
      "INSERT INTO streamlion_provider_branding_v1 VALUES('test','a',?,1,?)",
    )
    .run(JSON.stringify(branding), Date.now());
  const retry = () =>
    createPublicForm(f.env, f.connection, "public-form-test", { intake: null });
  assert.deepEqual(await retry(), f.form);
  assert.equal((await openPublicForm(f.env, f.token)).brand, branding.name);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_public_forms_v1").get()
      .n,
    1,
  );
  await assert.rejects(
    createPublicForm(
      f.env,
      { ...f.connection, id: "other-owner" },
      "public-form-test",
      { intake: null },
    ),
    /Form identity changed/,
  );
  await assert.rejects(
    createPublicForm(f.env, f.connection, "public-form-test", {
      intake: { id: "different-template" },
    }),
    /Form identity changed/,
  );
  await assert.rejects(
    createPublicForm(
      f.env,
      f.connection,
      "public-form-test",
      { intake: null },
      true,
    ),
    /Form identity changed/,
  );
  // Recovery does not need the current branding store to be available.
  const offlineBranding = {
    ...f.env,
    GOOGLE_SESSIONS: {
      ...f.db,
      prepare(query) {
        if (query.includes("streamlion_provider_branding_v1"))
          throw new Error("Branding store unavailable");
        return f.db.prepare(query);
      },
    },
  };
  const recovered = await createPublicForm(
    offlineBranding,
    f.connection,
    "public-form-test",
    { intake: null },
  );
  assert.equal(recovered.url, f.form.url);
  assert.equal(recovered.id, f.form.id);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
});

test("concurrent form retry with different branding recovers the winning insert without duplicating the form", async (t) => {
  const f = await publicFixture(t),
    operation = "concurrent-branding",
    job = { intake: null };
  let winner,
    raced = false;
  const env = {
    ...f.env,
    GOOGLE_SESSIONS: {
      ...f.db,
      prepare(query) {
        const statement = f.db.prepare(query);
        if (
          !query.startsWith("INSERT OR IGNORE INTO streamlion_public_forms_v1")
        )
          return statement;
        return {
          ...statement,
          bind(...args) {
            const bound = statement.bind(...args);
            return {
              ...bound,
              async run() {
                if (!raced) {
                  raced = true;
                  f.sql
                    .prepare(
                      "INSERT INTO streamlion_provider_branding_v1 VALUES('test','a',?,1,?)",
                    )
                    .run(
                      JSON.stringify({
                        name: "New Profile",
                        website: "",
                        logo: "",
                        shape: "rounded",
                      }),
                      Date.now(),
                    );
                  winner = await createPublicForm(
                    f.env,
                    f.connection,
                    operation,
                    job,
                  );
                }
                return bound.run();
              },
            };
          },
        };
      },
    },
  };
  const recovered = await createPublicForm(env, f.connection, operation, job);
  assert.equal(raced, true);
  assert.deepEqual(recovered, winner);
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_public_forms_v1 WHERE id=?",
      )
      .get("form-" + operation).n,
    1,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
});

const { updateFormPricing } = await import("../../server/public-intake.js");
const { blankPricing, validatePricing } =
  await import("../../src/provider-pricing.js");
async function pricedPublicFixture(t) {
  const f = await publicFixture(t),
    config = validatePricing({
      ...blankPricing(),
      method: "area",
      rate: "0.15",
      allowBudget: true,
      extras: [
        {
          id: "editing",
          name: "Editing",
          unit: "hour",
          price: "50",
          required: false,
          maxQuantity: "10",
          defaultQuantity: "1",
        },
      ],
    });
  f.sql
    .prepare(
      "INSERT INTO streamlion_provider_pricing_v1 VALUES('test','a','default','Capture pricing',?,1,?)",
    )
    .run(JSON.stringify(config), Date.now());
  const form = await createPublicForm(
    f.env,
    f.connection,
    "provider-priced-form",
    { intake: null },
  );
  f.token = new URLSearchParams(new URL(form.url).hash.slice(1)).get("form");
  f.form = form;
  return { ...f, config };
}
test("provider pricing is recomputed server-side; client budgets and extras survive Google readback without becoming agreed fees", async (t) => {
  const f = await pricedPublicFixture(t),
    body = {
      ...publicBody(f, "priced-request"),
      pricingKey: "default:1",
      quantities: { editing: "3" },
      budget: "600",
    };
  body.fields.propertySizeSqFt = "5000";
  body.estimate = { totalCents: 1 };
  const result = await f.submit(body),
    job = f.google.heads.get(result.jobId);
  assert.equal(job.pricingRequest.estimate.totalCents, 90000);
  assert.equal(job.pricingRequest.budgetCents, 60000);
  assert.equal(job.fields.agreedFee, "");
  assert.equal(job.pricingRequest.pricing.version, 1);
  assert.equal(job.estimate, undefined);
  assert.deepEqual(await f.submit(body), result);
  assert.equal(f.google.events.size, 1);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_shared_spends_v1").get()
      .n,
    0,
  );
});
test("explicit form repricing rejects stale fresh submissions but recovers an already-saved original submission", async (t) => {
  const f = await pricedPublicFixture(t),
    body = {
      ...publicBody(f, "lost-price-ack"),
      pricingKey: "default:1",
      quantities: {},
      budget: "600",
    };
  body.fields.propertySizeSqFt = "5000";
  const saved = await f.submit(body);
  f.sql
    .prepare(
      "UPDATE streamlion_provider_pricing_v1 SET config=?,version=2 WHERE google_subject='a'",
    )
    .run(JSON.stringify({ ...f.config, rate: "0.20" }));
  const publish = {
    formId: f.form.id,
    expectedPricingKey: "default:1",
    targetPricingKey: "default:2",
  };
  await updateFormPricing(f.env, f.connection, publish);
  assert.deepEqual(await f.submit(body), saved);
  assert.equal(
    f.google.heads.get(saved.jobId).pricingRequest.estimate.totalCents,
    75000,
  );
  const stale = {
    ...body,
    operation: "new-stale-price",
    accessToken: randomProspectToken(),
  };
  await assert.rejects(
    f.submit(stale),
    (e) => e.code === "pricing_changed" && e.status === 409,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_public_submissions_v1")
      .get().n,
    1,
  );
  const latest = { ...stale, pricingKey: "default:2" };
  const result = await f.submit(latest);
  assert.equal(
    f.google.heads.get(result.jobId).pricingRequest.estimate.totalCents,
    100000,
  );
  assert.equal((await openPublicForm(f.env, f.token)).pricing.version, 2);
  // A lost publish response can recover even after Account pricing changes again.
  f.sql
    .prepare(
      "UPDATE streamlion_provider_pricing_v1 SET version=3 WHERE google_subject='a'",
    )
    .run();
  assert.deepEqual(await updateFormPricing(f.env, f.connection, publish), {
    updated: true,
  });
  await assert.rejects(
    updateFormPricing(f.env, { ...f.connection, id: "other-owner" }, publish),
  );
});
test("new TM question presets use only explicitly published pricing; no default rates leak between providers", async (t) => {
  const f = await publicFixture(t),
    form = await createPublicForm(f.env, f.connection, "no-silent-tm", {
      intake: { estimateProfile: TM_ESTIMATE },
    });
  const token = new URLSearchParams(new URL(form.url).hash.slice(1)).get(
    "form",
  );
  assert.equal((await openPublicForm(f.env, token)).pricing, null);
  const result = await f.submit({
    ...publicBody({ ...f, token }, "quote-only"),
    fields: { ...publicBody(f).fields, propertySizeSqFt: "5000" },
    creative: true,
  });
  assert.equal(f.google.heads.get(result.jobId).estimate, undefined);
  assert.equal(f.google.heads.get(result.jobId).pricingRequest.pricing, null);
});

test("a service pricing override resolves only within its provider account and retains its published version", async (t) => {
  const f = await pricedPublicFixture(t);
  for (const [subject, rate] of [
    ["a", "0.25"],
    ["b", "9"],
  ])
    f.sql
      .prepare(
        "INSERT INTO streamlion_provider_pricing_v1 VALUES('test',?,'floor-plan','Floor plan',?,1,?)",
      )
      .run(subject, JSON.stringify({ ...f.config, rate }), Date.now());
  const form = await createPublicForm(f.env, f.connection, "service-priced", {
      intake: { pricingProfile: "floor-plan" },
    }),
    token = new URLSearchParams(new URL(form.url).hash.slice(1)).get("form");
  const opened = await openPublicForm(f.env, token);
  assert.equal(opened.pricing.profileId, "floor-plan");
  assert.equal(opened.pricing.config.rate, "0.25");
  const result = await f.submit({
    ...publicBody({ ...f, token }, "service-lead"),
    pricingKey: "floor-plan:1",
    quantities: {},
    budget: "",
    fields: { ...publicBody(f).fields, propertySizeSqFt: "5000" },
  });
  assert.equal(
    f.google.heads.get(result.jobId).pricingRequest.estimate.totalCents,
    125000,
  );
});
test("a pricing publish racing a fresh submission fails atomically without a partial job or duplicate append", async (t) => {
  const f = await pricedPublicFixture(t);
  f.sql
    .prepare(
      "UPDATE streamlion_provider_pricing_v1 SET version=2,config=? WHERE google_subject='a'",
    )
    .run(JSON.stringify({ ...f.config, rate: "0.20" }));
  let raced = false;
  const originalDB = f.db;
  f.env.GOOGLE_SESSIONS = {
    ...originalDB,
    batch: async (statements) => {
      if (!raced) {
        raced = true;
        await updateFormPricing(
          { ...f.env, GOOGLE_SESSIONS: originalDB },
          f.connection,
          {
            formId: f.form.id,
            expectedPricingKey: "default:1",
            targetPricingKey: "default:2",
          },
        );
      }
      return originalDB.batch(statements);
    },
  };
  const body = {
    ...publicBody(f, "racing-price"),
    pricingKey: "default:1",
    quantities: {},
    fields: { ...publicBody(f).fields, propertySizeSqFt: "5000" },
  };
  await assert.rejects(f.submit(body), (e) => e.code === "pricing_changed");
  assert.equal(raced, true);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_public_submissions_v1")
      .get().n,
    0,
  );
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_jobs_v1")
      .get().n,
    0,
  );
  assert.equal(f.google.events.size, 0);
});
test("per-client budgets follow each form's own choice and survive explicit repricing", async (t) => {
  const f = await publicFixture(t);
  const config = validatePricing({
    ...blankPricing(),
    method: "area",
    rate: "0.15",
    allowBudget: false,
    budgetPerClient: true,
  });
  f.sql
    .prepare(
      "INSERT INTO streamlion_provider_pricing_v1 VALUES('test','a','default','Capture pricing',?,1,?)",
    )
    .run(JSON.stringify(config), Date.now());
  const open = async (operation, clientBudget) => {
    const form = await createPublicForm(
      f.env,
      f.connection,
      operation,
      { intake: null },
      false,
      clientBudget,
    );
    return {
      form,
      token: new URLSearchParams(new URL(form.url).hash.slice(1)).get("form"),
    };
  };
  const budgeted = await open("per-client-yes", true),
    fixed = await open("per-client-no", false);
  const body = (token, op) => {
    const value = {
      ...publicBody({ token }, op),
      pricingKey: "default:1",
      quantities: {},
      budget: "600",
    };
    value.fields.propertySizeSqFt = "5000";
    return value;
  };
  const saved = await f.submit(body(budgeted.token, "budget-allowed"));
  assert.equal(
    f.google.heads.get(saved.jobId).pricingRequest.budgetCents,
    60000,
  );
  await assert.rejects(
    f.submit(body(fixed.token, "budget-refused")),
    /not accepting proposed budgets/,
  );
  // A retry that changes the client's budget choice is a different form.
  await assert.rejects(open("per-client-yes", false), /Form identity changed/);
  // Publishing new rates keeps each form's budget choice.
  f.sql
    .prepare(
      "UPDATE streamlion_provider_pricing_v1 SET config=?,version=2 WHERE google_subject='a'",
    )
    .run(JSON.stringify({ ...config, rate: "0.20" }));
  await updateFormPricing(f.env, f.connection, {
    formId: budgeted.form.id,
    expectedPricingKey: "default:1",
    targetPricingKey: "default:2",
  });
  const repriced = body(budgeted.token, "budget-after-reprice");
  repriced.pricingKey = "default:2";
  const after = await f.submit(repriced);
  assert.equal(
    f.google.heads.get(after.jobId).pricingRequest.budgetCents,
    60000,
  );
});
test("a retried share link keeps its identity only with the same per-client budget choice", async (t) => {
  const f = fixture(t);
  f.sql
    .prepare(
      "INSERT INTO streamlion_provider_pricing_v1 VALUES('test','a','default','Capture pricing',?,1,?)",
    )
    .run(
      JSON.stringify(
        validatePricing({
          ...blankPricing(),
          method: "area",
          allowBudget: false,
          budgetPerClient: true,
        }),
      ),
      Date.now(),
    );
  const job = newClientJob({
    id: "job-budget-retry",
    provider: "a",
    clientEmail: "",
    title: "Retry",
    prospect: true,
    now: Date.now(),
  });
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES(?,?,?,?,?)",
    )
    .run(
      job.id,
      f.connection.id,
      job.id,
      await seal(f.env, "", "job-email:" + job.id),
      job.createdAt,
    );
  const row = f.sql
    .prepare("SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?")
    .get(job.id);
  const url = await createProspectLink(f.env, row, job, f.connection, true);
  assert.equal(
    await createProspectLink(f.env, row, job, f.connection, true),
    url,
  );
  await assert.rejects(
    createProspectLink(f.env, row, job, f.connection, false),
    /Request identity changed/,
  );
  const link = f.sql
    .prepare(
      "SELECT public_intake FROM streamlion_prospect_links_v1 WHERE job_id=?",
    )
    .get(job.id);
  assert.equal(
    (await unseal(f.env, link.public_intake, "prospect-public:" + job.id))
      .clientBudget,
    true,
  );
});
test("a public request can email its status link once, only to the address given", async (t) => {
  const f = await publicFixture(t);
  const plain = await f.submit(publicBody(f, "no-link", "client@example.com"));
  assert.equal(Object.hasOwn(plain, "linkEmailed"), false);
  const body = {
    ...publicBody(f, "with-link", "client@example.com"),
    emailLink: true,
  };
  const receipt = await f.submit(body);
  assert.equal(receipt.linkEmailed, true);
  await f.submit(body);
  const notices = f.sql
    .prepare(
      "SELECT * FROM streamlion_coordination_outbox_v1 WHERE id LIKE 'public-link-%'",
    )
    .all();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].id, "public-link-" + receipt.jobId);
  const mail = await unseal(f.env, notices[0].payload, "mail:" + notices[0].id);
  assert.equal(mail.to, "client@example.com");
  assert.equal(mail.url, receipt.url);
  // Without an email there is nothing to send.
  const none = await f.submit({
    ...publicBody(f, "no-email"),
    emailLink: true,
  });
  assert.equal(Object.hasOwn(none, "linkEmailed"), false);
});

async function deliveryFixture(t) {
  const f = fixture(t),
    google = googleFixture();
  const uploads = [];
  google.privateFolder = async () => {};
  google.json = async () => ({ ids: ["completion-file"] });
  google.upload = async (plan) => {
    uploads.push(plan);
  };
  let job = newClientJob({
    id: "delivery-job",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Delivery test",
    now: 1,
  });
  job = reduceClientJob(
    job,
    {
      action: "edit",
      expectedRevision: job.revision,
      fields: {
        address: "1 Main",
        scope: "Capture lobby",
        deliverables: "Tour link",
        accessInstructions: "Meet owner",
        sourceNotes: "PRIVATE-DO-NOT-SHARE",
      },
    },
    { role: "provider" },
    2,
  );
  job = reduceClientJob(
    job,
    { action: "submit", expectedRevision: job.revision },
    { role: "client" },
    3,
  );
  google.heads.set(job.id, job);
  f.sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES('delivery-job','connection-a','delivery-job',?,1)",
    )
    .run(await seal(f.env, "client@example.com", "job-email:delivery-job"));
  const engine = new CoordinationEngine(f.env, f.connection, google);
  const command = async (id, action, extra = {}, role = "provider") =>
    engine.command(
      id,
      job.id,
      { action, expectedRevision: google.heads.get(job.id).revision, ...extra },
      { role },
    );
  await command("provider-agrees", "approve", { authorizedMicros: 3000000 });
  return { ...f, google, engine, command, uploads, jobId: job.id };
}

test("new scope approval and field progress preserve all 600 starter credits; reviewed completion delivery settles once", async (t) => {
  const f = await deliveryFixture(t);
  await f.command("client-agrees", "approve", {}, "client");
  assert.equal(f.google.heads.get(f.jobId).projectBilling, "delivery");
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 7500000);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    0,
  );
  await f.command("working", "progress", { state: "in_progress" });
  await f.command("finished", "progress", { state: "work_completed" });
  const { completionBrief } = await import("../../server/completion-brief.js");
  const preview = await completionBrief(
    f.google.heads.get(f.jobId),
    await f.google.snapshot(),
    "Provider",
  );
  assert.match(preview.document, /Completion Brief/);
  assert.doesNotMatch(preview.document, /PRIVATE-DO-NOT-SHARE/);
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 7500000);
  await assert.rejects(
    () => f.command("unreviewed", "progress", { state: "delivered" }),
    /Review the Completion Brief/,
  );
  const delivery = {
    state: "delivered",
    completionHash: preview.hash,
    completionReviewed: true,
    authorizedMicros: 3000000,
  };
  const originalRevision = f.google.heads.get(f.jobId).revision;
  await f.command("send-completion", "progress", delivery);
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 4500000);
  assert.equal(f.google.heads.get(f.jobId).state, "delivered");
  assert.equal(f.google.heads.get(f.jobId).completion.hash, preview.hash);
  assert.equal(
    f.google.heads.get(f.jobId).attachments.at(-1).visibility,
    "client",
  );
  assert.equal(
    Buffer.from(f.uploads[0].content, "base64").toString(),
    preview.document,
  );
  await f.engine.command(
    "send-completion",
    f.jobId,
    { action: "progress", expectedRevision: originalRevision, ...delivery },
    { role: "provider" },
  );
  await f.command("client-received", "accept_delivery", {}, "client");
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    1,
  );
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 4500000);
});

test("insufficient delivery credits preserve work and upload nothing; the original operation recovers after top-up", async (t) => {
  const f = await deliveryFixture(t);
  await f.command("client-agrees", "approve", {}, "client");
  await f.command("finished", "progress", { state: "work_completed" });
  const { completionBrief } = await import("../../server/completion-brief.js");
  const preview = await completionBrief(
    f.google.heads.get(f.jobId),
    await f.google.snapshot(),
    "Provider",
  );
  f.sql.exec(
    "UPDATE streamlion_promotional_wallets_v1 SET balance_micros=0 WHERE google_subject='a'",
  );
  const delivery = {
    action: "progress",
    expectedRevision: f.google.heads.get(f.jobId).revision,
    state: "delivered",
    completionHash: preview.hash,
    completionReviewed: true,
    authorizedMicros: 3000000,
  };
  await assert.rejects(
    () =>
      f.engine.command("delivery-retry", f.jobId, delivery, {
        role: "provider",
      }),
    /Insufficient/,
  );
  assert.equal(f.google.heads.get(f.jobId).state, "work_completed");
  assert.equal(f.uploads.length, 0);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    0,
  );
  f.sql.exec(
    "UPDATE streamlion_credit_wallets_v1 SET balance_micros=3000000 WHERE google_subject='a'",
  );
  await f.engine.command("delivery-retry", f.jobId, delivery, {
    role: "provider",
  });
  assert.equal(f.google.heads.get(f.jobId).state, "delivered");
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 0);
});

test("changed saved evidence invalidates the reviewed report before any financial or delivery operation", async (t) => {
  const f = await deliveryFixture(t);
  await f.command("client-agrees", "approve", {}, "client");
  await f.command("finished", "progress", { state: "work_completed" });
  const { completionBrief } = await import("../../server/completion-brief.js");
  const preview = await completionBrief(
    f.google.heads.get(f.jobId),
    await f.google.snapshot(),
    "Provider",
  );
  const snapshot = await f.google.snapshot();
  snapshot.notes.heads.push({
    recordId: "note-a",
    projectId: f.jobId,
    area: "Lobby",
    text: "New reviewed evidence",
    reviewState: "reviewed",
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  });
  const original = f.google.snapshot;
  f.google.snapshot = async () => ({
    ...(await original()),
    notes: snapshot.notes,
  });
  await assert.rejects(
    () =>
      f.command("stale-delivery", "progress", {
        state: "delivered",
        completionHash: preview.hash,
        completionReviewed: true,
        authorizedMicros: 3000000,
      }),
    /saved job changed/,
  );
  assert.equal(await f.engine.operation("stale-delivery"), null);
  assert.equal(f.uploads.length, 0);
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 7500000);
});

test("a response lost during delivery recovers the reviewed report and settles its reserved fee once", async (t) => {
  const f = await deliveryFixture(t);
  await f.command("client-agrees", "approve", {}, "client");
  await f.command("finished", "progress", { state: "work_completed" });
  const { completionBrief } = await import("../../server/completion-brief.js");
  const preview = await completionBrief(
    f.google.heads.get(f.jobId),
    await f.google.snapshot(),
    "Provider",
  );
  const event = f.google.event.bind(f.google);
  let fail = true;
  f.google.event = async (e) => {
    if (e.action === "settle_delivery" && fail)
      throw new Error("synthetic response loss");
    return event(e);
  };
  const command = {
    action: "progress",
    expectedRevision: f.google.heads.get(f.jobId).revision,
    state: "delivered",
    completionHash: preview.hash,
    completionReviewed: true,
    authorizedMicros: 3000000,
  };
  await assert.rejects(
    () =>
      f.engine.command("recover-delivery", f.jobId, command, {
        role: "provider",
      }),
    /response loss/,
  );
  assert.equal(f.google.heads.get(f.jobId).state, "delivery_pending");
  assert.equal(f.google.heads.get(f.jobId).completion, undefined);
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 4500000);
  fail = false;
  await f.engine.command("recover-delivery", f.jobId, command, {
    role: "provider",
  });
  assert.equal(f.google.heads.get(f.jobId).state, "delivered");
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 4500000);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    1,
  );
});

test("an encrypted legacy activation journal retains its original approval-time settlement contract", async (t) => {
  const f = await deliveryFixture(t);
  const originalRun = f.engine.run.bind(f.engine);
  f.engine.run = async () => {
    throw new Error("legacy operation queued");
  };
  await assert.rejects(
    () => f.command("legacy-confirmation", "approve", {}, "client"),
    /queued/,
  );
  const operation = await f.engine.operation("legacy-confirmation");
  const plan = await unseal(
    f.env,
    operation.payload,
    "operation:legacy-confirmation",
  );
  delete plan.deferProjectCharge;
  for (const e of plan.events) delete e.job.projectBilling;
  f.sql
    .prepare(
      "UPDATE streamlion_coordination_operations_v1 SET payload=? WHERE id=?",
    )
    .run(
      await seal(f.env, plan, "operation:legacy-confirmation"),
      "legacy-confirmation",
    );
  await originalRun("legacy-confirmation");
  assert.equal(f.google.heads.get(f.jobId).state, "confirmed");
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 4500000);
  await originalRun("legacy-confirmation");
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    1,
  );
});

test("a draft checklist cannot leak private exceptions into a client Completion Brief", async (t) => {
  const f = await deliveryFixture(t);
  await f.command("client-agrees", "approve", {}, "client");
  const snapshot = await f.google.snapshot();
  snapshot.notes.heads.push({
    recordId: "private-checklist",
    projectId: f.jobId,
    area: "StreamLion project checklist",
    text: "DRAFT-PRIVATE-SECRET",
    reviewState: "draft",
    updatedAt: new Date().toISOString(),
  });
  const { completionBrief } = await import("../../server/completion-brief.js");
  await assert.rejects(
    () => completionBrief(f.google.heads.get(f.jobId), snapshot, "Provider"),
    /Review and save the project checklist/,
  );
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 7500000);
});

test("twenty existing references do not consume the generated Completion Brief slot, and reopened jobs do not pay again", async (t) => {
  const f = await deliveryFixture(t);
  await f.command("client-agrees", "approve", {}, "client");
  for (let n = 0; n < 20; n++)
    f.google.heads.get(f.jobId).attachments.push({
      id: "reference-" + n,
      name: "reference.pdf",
      visibility: "client",
      driveId: "file-" + n,
      type: "application/pdf",
      bytes: 5,
      at: 1,
    });
  await f.command("finished", "progress", { state: "work_completed" });
  const { completionBrief } = await import("../../server/completion-brief.js");
  async function deliver(id) {
    const preview = await completionBrief(
      f.google.heads.get(f.jobId),
      await f.google.snapshot(),
      "Provider",
      f.env.GOOGLE_AUTH_ORIGIN,
    );
    await f.command(id, "progress", {
      state: "delivered",
      completionHash: preview.hash,
      completionReviewed: true,
      authorizedMicros: 3000000,
    });
  }
  await deliver("first-delivery");
  assert.equal(f.google.heads.get(f.jobId).attachments.length, 21);
  await f.command("acknowledged", "accept_delivery", {}, "client");
  await f.command("closed", "close");
  await f.command("reopened", "reopen", {
    reason: "Client requested a correction",
  });
  await f.command("correction-finished", "progress", {
    state: "work_completed",
  });
  f.sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET project_micros=2000000 WHERE mode='test'",
  );
  await deliver("corrected-delivery");
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 4500000);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    1,
  );
});

test("a workbook with one event slot left cannot reserve credits for a two-checkpoint delivery", async (t) => {
  const f = await deliveryFixture(t);
  await f.command("client-agrees", "approve", {}, "client");
  await f.command("finished", "progress", { state: "work_completed" });
  const original = f.google.snapshot;
  f.google.snapshot = async () => ({
    ...(await original()),
    rows: [[], [], Array(9999)],
  });
  await assert.rejects(
    () =>
      f.command("full-history", "progress", {
        state: "delivered",
        completionReviewed: true,
        authorizedMicros: 3000000,
        completionHash: "a".repeat(64),
      }),
    /cannot fit both delivery checkpoints/,
  );
  assert.equal(await f.engine.operation("full-history"), null);
  assert.equal((await sharedWallet(f.db, "test", "a")).available, 7500000);
  assert.equal(f.uploads.length, 0);
});
