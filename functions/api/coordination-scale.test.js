import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { CoordinationEngine } from "../../server/coordination-engine.js";
import { CoordinationGoogle } from "../../server/coordination-google.js";
import { newClientJob, stableJSON } from "../../src/client-workflow.js";
import { seal } from "../../server/google-auth.js";
import { columnName } from "../../src/workbook.js";
import { archiveGoogleFixture } from "../../test/archive-fixture.js";

async function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sql.exec(
      readFileSync(
        new URL("../../migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  t.after(() => sql.close());
  const wrap = (query, values = []) => ({
    bind: (...args) => wrap(query, args),
    first: async () => sql.prepare(query).get(...values) || null,
    all: async () => ({ results: sql.prepare(query).all(...values) }),
    run: async () => ({
      meta: { changes: sql.prepare(query).run(...values).changes },
    }),
    sync: () => ({
      meta: { changes: sql.prepare(query).run(...values).changes },
    }),
  });
  const db = {
    prepare: wrap,
    batch: async (statements) => {
      sql.exec("BEGIN");
      try {
        const result = statements.map((s) => s.sync());
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = {
    STREAMLION_PAYMENTS_MODE: "test",
    GOOGLE_SESSIONS: db,
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    GOOGLE_AUTH_ORIGIN: "https://app.example",
  };
  sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='test'",
  );
  sql.exec(
    "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES('purchase-a','test','a','client@example.com','price','product',3995,'usd','paid',1,9999999999999,1)",
  );
  const connection = {
    id: "connection-a",
    google_subject: "a",
    mode: "test",
    workbook_id: "book-a",
    folder_id: "folder-a",
    credentials: "synthetic",
    client_brand: "Synthetic",
    expires_at: 9999999999999,
    revoked: 0,
  };
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at,revoked) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(...Object.values(connection));
  const transport = archiveGoogleFixture(connection, env);
  const counts = { snapshots: 0, appends: 0 };
  const originalJSON = transport.google.json;
  const json = async (...args) => {
    if (args[0].includes("/values:batchGet?")) counts.snapshots++;
    return originalJSON(...args);
  };
  let afterAppend = async (receipt) => receipt;
  const append = async (tab, values) => {
    counts.appends++;
    const tabIndex = [
      "Projects",
      "Observations",
      "CoordinationEvents",
      "ArchiveIndex",
    ].indexOf(tab);
    transport.rows[tabIndex].push([...values]);
    const row = transport.rows[tabIndex].length;
    const range = `${tab}!A${row}:${columnName(values.length - 1)}${row}`;
    return afterAppend(
      {
        spreadsheetId: connection.workbook_id,
        updates: {
          spreadsheetId: connection.workbook_id,
          updatedRows: 1,
          updatedRange: range,
          updatedData: { range, majorDimension: "ROWS", values: [[...values]] },
        },
      },
      tab,
      values,
    );
  };
  const fresh = () => {
    const google = new CoordinationGoogle(env, { ...connection });
    google.json = json;
    google.append = append;
    return new CoordinationEngine(env, { ...connection }, google);
  };
  const engine = fresh();
  const job = newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Office",
    now: 1,
  });
  Object.assign(job.fields, {
    address: "1 Main",
    scope: "Rooms",
    deliverables: "Tour",
    accessInstructions: "Meet owner",
  });
  sql
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES(?,?,?,?,1)",
    )
    .run(
      job.id,
      connection.id,
      job.id,
      await seal(env, "client@example.com", "job-email:" + job.id),
    );
  await engine.create("create-a", job);
  const head = () => JSON.parse(transport.rows[2].at(-1)[7]);
  await engine.command(
    "submit-a",
    job.id,
    { action: "submit", expectedRevision: head().revision },
    { role: "client" },
  );
  await engine.command(
    "approve-a",
    job.id,
    {
      action: "approve",
      expectedRevision: head().revision,
      authorizedMicros: 3000000,
    },
    { role: "provider" },
  );
  const command = { action: "approve", expectedRevision: head().revision };
  counts.snapshots = counts.appends = 0;
  return {
    sql,
    env,
    connection,
    counts,
    rows: transport.rows,
    engine,
    fresh,
    command,
    job,
    head,
    afterAppend: (hook) => {
      afterAppend = hook;
    },
  };
}

test("activation reuses verified snapshots while preserving both completion checkpoints", async (t) => {
  const f = await fixture(t);
  await f.engine.command("confirm-a", f.job.id, f.command, { role: "client" });
  assert.deepEqual(f.counts, { snapshots: 6, appends: 4 });
  assert.equal(f.head().state, "confirmed");
  f.counts.snapshots = f.counts.appends = 0;
  await f.fresh().command("confirm-a", f.job.id, f.command, { role: "client" });
  assert.deepEqual(f.counts, { snapshots: 0, appends: 0 });
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    0,
  );
});

for (const lostAppend of [1, 2, 3, 4]) {
  test(`cold recovery reconciles lost acknowledgement ${lostAppend} without duplicates or a project charge`, async (t) => {
    const f = await fixture(t);
    f.afterAppend(async (receipt) => {
      if (f.counts.appends === lostAppend)
        throw new Error("synthetic lost acknowledgement");
      return receipt;
    });
    await assert.rejects(
      () =>
        f.engine.command("confirm-a", f.job.id, f.command, { role: "client" }),
      /lost acknowledgement/,
    );
    await assert.rejects(
      () =>
        f
          .fresh()
          .store(
            "other",
            "job-other",
            "provider",
            { action: "x" },
            { events: [] },
          ),
      /Another save/,
    );
    f.afterAppend(async (receipt) => receipt);
    await f
      .fresh()
      .command("confirm-a", f.job.id, f.command, { role: "client" });
    assert.equal(f.head().state, "confirmed");
    assert.equal(f.counts.appends, 4);
    for (const id of ["confirm-a", "confirm-a-confirmed"])
      assert.equal(f.rows[2].filter((row) => row[0] === id).length, 1);
    for (const id of ["confirm-a-project", "confirm-a-ready"])
      assert.equal(f.rows[0].filter((row) => row[1] === id).length, 1);
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get()
        .n,
      0,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT state FROM streamlion_coordination_operations_v1 WHERE id='confirm-a'",
        )
        .get().state,
      "complete",
    );
  });
}

for (const fault of [
  "missing values",
  "wrong values",
  "wrong destination",
  "wrong workbook",
  "wrong row",
  "wrong width",
  "unbalanced quotes",
]) {
  test(`an append response with ${fault} retains a recoverable journal`, async (t) => {
    const f = await fixture(t);
    f.afterAppend(async (receipt) => {
      if (fault === "missing values") delete receipt.updates.updatedData;
      if (fault === "wrong values")
        receipt.updates.updatedData.values[0][0] = "wrong";
      if (fault === "wrong destination")
        receipt.updates.updatedRange = "Observations!A2:I2";
      if (fault === "wrong workbook") receipt.spreadsheetId = "other-book";
      if (["wrong row", "wrong width", "unbalanced quotes"].includes(fault)) {
        const range =
          fault === "wrong row"
            ? "CoordinationEvents!A999:I999"
            : fault === "wrong width"
              ? `CoordinationEvents!A${f.rows[2].length}:A${f.rows[2].length}`
              : `'CoordinationEvents!A${f.rows[2].length}:I${f.rows[2].length}`;
        receipt.updates.updatedRange = receipt.updates.updatedData.range =
          range;
      }
      return receipt;
    });
    await assert.rejects(
      () =>
        f.engine.command("confirm-a", f.job.id, f.command, { role: "client" }),
      /unverified/,
    );
    assert.equal(
      f.counts.appends,
      1,
      "reject malformed metadata before the next append",
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT state FROM streamlion_coordination_operations_v1 WHERE id='confirm-a'",
        )
        .get().state,
      "pending",
    );
    f.afterAppend(async (receipt) => receipt);
    await f
      .fresh()
      .command("confirm-a", f.job.id, f.command, { role: "client" });
    assert.equal(f.counts.appends, 4);
  });
}

test("parallel original-operation recovery retains one logical history and no project charge", async (t) => {
  const f = await fixture(t);
  f.afterAppend(async (receipt) => {
    if (f.counts.appends === 1) throw new Error("lost acknowledgement");
    return receipt;
  });
  await assert.rejects(
    () =>
      f.engine.command("confirm-a", f.job.id, f.command, { role: "client" }),
    /lost acknowledgement/,
  );
  f.afterAppend(async (receipt) => receipt);
  await Promise.allSettled([
    f.fresh().command("confirm-a", f.job.id, f.command, { role: "client" }),
    f.fresh().command("confirm-a", f.job.id, f.command, { role: "client" }),
  ]);
  await f.fresh().command("confirm-a", f.job.id, f.command, { role: "client" });
  const snapshot = await f.fresh().google.snapshot();
  assert.equal(snapshot.heads.get(f.job.id).state, "confirmed");
  assert.equal(snapshot.events.size, 5);
  assert.equal(snapshot.projects.revisions.length, 2);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_shared_spends_v1").get().n,
    0,
  );
});

test("trimmed trailing blank values and quoted Sheets ranges remain valid", async (t) => {
  const f = await fixture(t);
  f.afterAppend(async (receipt) => {
    const values = receipt.updates.updatedData.values[0];
    while (values.at(-1) === "") values.pop();
    const range = receipt.updates.updatedRange.replace(/^([^!]+)!/, "'$1'!");
    receipt.updates.updatedRange = receipt.updates.updatedData.range = range;
    return receipt;
  });
  await f.engine.command("confirm-a", f.job.id, f.command, { role: "client" });
  assert.deepEqual(f.counts, { snapshots: 6, appends: 4 });
});

for (const tamperAfter of [2, 4]) {
  test(`history tampering after append ${tamperAfter} is detected before operation completion`, async (t) => {
    const f = await fixture(t);
    f.afterAppend(async (receipt) => {
      if (f.counts.appends === tamperAfter) {
        const old = JSON.parse(f.rows[2][1][7]);
        old.fields.scope = "Tampered";
        f.rows[2][1][7] = stableJSON(old);
      }
      return receipt;
    });
    await assert.rejects(
      () =>
        f.engine.command("confirm-a", f.job.id, f.command, { role: "client" }),
      /signature/,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT state FROM streamlion_coordination_operations_v1 WHERE id='confirm-a'",
        )
        .get().state,
      "pending",
    );
    assert.equal(
      f.sql.prepare("SELECT state FROM streamlion_shared_spends_v1").get(),
      undefined,
    );
  });
}

test("the journal execution rechecks a head changed after command planning", async (t) => {
  const f = await fixture(t);
  const store = f.engine.store.bind(f.engine);
  f.engine.store = async (...args) => {
    const previous = f.head();
    const next = { ...previous, revision: previous.revision + 1, updatedAt: 5 };
    const event = {
      id: "racing",
      jobId: previous.id,
      revision: next.revision,
      parent: previous.revision,
      at: 5,
      actor: "provider",
      action: "attach",
      job: next,
    };
    f.rows[2].push([
      event.id,
      event.jobId,
      event.revision,
      event.parent,
      event.at,
      event.actor,
      event.action,
      stableJSON(next),
      await f.engine.google.signature(event),
    ]);
    return store(...args);
  };
  await assert.rejects(
    () =>
      f.engine.command("confirm-a", f.job.id, f.command, { role: "client" }),
    /changed before saving/,
  );
  assert.equal(f.counts.appends, 0);
});

test("a manual Projects edit during the event request is rejected before a conflicting projection is appended", async (t) => {
  const f = await fixture(t);
  f.afterAppend(async (receipt) => {
    if (f.counts.appends === 1) {
      const revision = {
        ...f.job.fields,
        recordId: f.job.id,
        revisionId: "manual-edit",
        parentRevisionId: "",
        updatedAt: new Date().toISOString(),
        reviewState: "draft",
      };
      const { rowFor, PROJECT_HEADERS } = await import("../../src/workbook.js");
      f.rows[0].push(rowFor(revision, PROJECT_HEADERS));
    }
    return receipt;
  });
  await assert.rejects(
    () =>
      f.engine.command("confirm-a", f.job.id, f.command, { role: "client" }),
    /Field brief changed outside coordination/,
  );
  assert.equal(f.counts.appends, 1);
  assert.equal(f.rows[0].length, 2);
  const snapshot = await f.fresh().google.snapshot();
  assert.equal(snapshot.projects.heads[0].revisionId, "manual-edit");
  await assert.rejects(
    () =>
      f.fresh().command("confirm-a", f.job.id, f.command, { role: "client" }),
    /Field brief changed outside coordination/,
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT state FROM streamlion_coordination_operations_v1 WHERE id='confirm-a'",
      )
      .get().state,
    "pending",
  );
  assert.equal(
    f.sql.prepare("SELECT state FROM streamlion_shared_spends_v1").get(),
    undefined,
  );
});

test("append requests return raw echoed values for verification", async () => {
  const google = new CoordinationGoogle(
    {},
    { workbook_id: "book", folder_id: "folder" },
  );
  const expected = { spreadsheetId: "book", updates: {} };
  google.json = async (url, options) => {
    const query = new URL(url).searchParams;
    assert.equal(query.get("includeValuesInResponse"), "true");
    assert.equal(query.get("responseValueRenderOption"), "UNFORMATTED_VALUE");
    assert.equal(query.get("valueInputOption"), "RAW");
    assert.deepEqual(JSON.parse(options.body).values, [["one", ""]]);
    return expected;
  };
  assert.equal(await google.append("Projects", ["one", ""]), expected);
});
