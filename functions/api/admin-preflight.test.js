import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
test("admin preflight accepts exact predecessor or full result and stops on partial or altered financial guards", async () => {
  let m;
  try {
    m = await import("../../scripts/preflight-admin.mjs");
  } catch {}
  assert.ok(m, "Admin preflight must exist");
  const db = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../../migrations/", import.meta.url);
    for (const f of readdirSync(dir)
      .filter((x) => x.endsWith(".sql") && x < "0025")
      .sort())
      db.exec(readFileSync(new URL(f, dir), "utf8"));
    const snapshot = () => ({
      schema: db
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
        )
        .all(),
      stamps: Object.fromEntries(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%schema_v1'",
          )
          .all()
          .map(({ name }) => [
            name,
            db.prepare("SELECT version FROM " + name).get()?.version,
          ]),
      ),
    });
    assert.equal(m.adminPreflight(snapshot()).migration, "pending");
    db.exec(
      readFileSync(
        new URL("../../migrations/0025_admin_portal.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(m.adminPreflight(snapshot()).migration, "already_applied");
    db.exec("DROP TRIGGER streamlion_admin_grant_guard_v1");
    assert.throws(() => m.adminPreflight(snapshot()), /STOP/);
  } finally {
    db.close();
  }
});
test("a complete admin successor cannot be classified as safe with an earlier prerequisite removed", async () => {
  const { expectedAdminSchema, adminPreflight } =
    await import("../../scripts/preflight-admin.mjs");
  const input = expectedAdminSchema(true);
  input.schema = input.schema.filter(
    (r) => r.name !== "streamlion_coordination_changes_v1",
  );
  assert.throws(() => adminPreflight(input), /STOP/);
});
test("unknown triggers cannot bypass preflight with quoted, bracketed or commented table names", async () => {
  const { expectedAdminSchema, adminPreflight } =
    await import("../../scripts/preflight-admin.mjs");
  for (const table of [
    '"streamlion_credit_wallets_v1"',
    "[streamlion_credit_wallets_v1]",
    "/* comment */ streamlion_credit_wallets_v1",
  ]) {
    const input = expectedAdminSchema(false);
    input.schema.push({
      name: "rogue",
      type: "trigger",
      sql: `CREATE TRIGGER rogue BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END`,
    });
    assert.throws(() => adminPreflight(input), /STOP/);
  }
});
test("prepared owner enrollment rejects unverified identity atomically rather than silently doing no work", async (t) => {
  const { adminFixture } = await import("../../test/admin-fixture.js");
  const f = await adminFixture(t);
  const { adminOperatorPlan } =
    await import("../../scripts/admin-operator.mjs");
  const plan = adminOperatorPlan({
    action: "recover",
    mode: "live",
    subject: "unverified",
    priorSubject: "owner",
    sha: "a".repeat(40),
  });
  assert.equal(plan.execute, false);
  assert.throws(() => {
    f.db.exec("BEGIN");
    try {
      for (const s of plan.statements) f.db.prepare(s.sql).run(...s.params);
      f.db.exec("COMMIT");
    } catch (e) {
      f.db.exec("ROLLBACK");
      throw e;
    }
  }, /admin_operator/);
  assert.equal(
    f.db
      .prepare(
        "SELECT enabled FROM streamlion_admin_owners_v1 WHERE google_subject='owner' AND mode='live'",
      )
      .get().enabled,
    1,
  );
});
test("owner recovery rolls back on audit failure and exact replay retains one disabled-write owner receipt", async (t) => {
  const { adminFixture, ADMIN_NOW } =
    await import("../../test/admin-fixture.js");
  const f = await adminFixture(t);
  const { adminOperatorPlan } =
    await import("../../scripts/admin-operator.mjs");
  f.db
    .prepare(
      "INSERT INTO streamlion_accounts_v1(google_subject,email,first_known_at,first_known_source) VALUES('new-owner','shakoure@transcendencemedia.com',?,'signin')",
    )
    .run(ADMIN_NOW);
  f.db
    .prepare(
      "UPDATE streamlion_google_sessions_v1 SET google_subject='new-owner',email='shakoure@transcendencemedia.com'",
    )
    .run();
  f.authorization("old-authorization");
  const plan = adminOperatorPlan({
    action: "recover",
    mode: "live",
    subject: "new-owner",
    priorSubject: "owner",
    sha: "a".repeat(40),
  });
  const execute = () => {
    const s = plan.statements[0];
    return f.db.prepare(s.sql).run(...s.params);
  };
  f.db.exec(
    "CREATE TRIGGER reject_operator_audit BEFORE INSERT ON streamlion_admin_audit_v1 BEGIN SELECT RAISE(ABORT,'audit_failure'); END",
  );
  assert.throws(execute, /audit_failure/);
  assert.equal(
    f.db
      .prepare(
        "SELECT enabled FROM streamlion_admin_owners_v1 WHERE mode='live' AND google_subject='owner'",
      )
      .get().enabled,
    1,
  );
  assert.equal(
    f.db
      .prepare("SELECT count(*) n FROM streamlion_admin_authorizations_v1")
      .get().n,
    1,
  );
  f.db.exec("DROP TRIGGER reject_operator_audit");
  execute();
  execute();
  assert.deepEqual(
    {
      ...f.db
        .prepare(
          "SELECT enabled,grants_enabled FROM streamlion_admin_policy_v1 WHERE mode='live'",
        )
        .get(),
    },
    { enabled: 1, grants_enabled: 0 },
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT google_subject FROM streamlion_admin_owners_v1 WHERE mode='live' AND enabled=1",
      )
      .get().google_subject,
    "new-owner",
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT count(*) n FROM streamlion_admin_windows_v1 WHERE mode='live'",
      )
      .get().n,
    0,
  );
  assert.equal(
    f.db.prepare(plan.verify.sql).get(...plan.verify.params).action,
    "recover",
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT count(*) n FROM streamlion_admin_audit_v1 WHERE action='recover'",
      )
      .get().n,
    1,
  );
  const s = plan.statements[0];
  assert.throws(
    () =>
      f.db
        .prepare(s.sql)
        .run(...s.params.map((v, i) => (i === 3 ? "other-owner" : v))),
    /admin_operator_replay/,
  );
});

test("admin preflight accepts wholly absent optional saved-card schema before and after 0025", async () => {
  const { expectedAdminSchema, adminPreflight } =
    await import("../../scripts/preflight-admin.mjs");
  const optional = new Set([
    "streamlion_credit_cards_v1",
    "streamlion_credit_topups_v1",
    "streamlion_credit_cards_schema_v1",
  ]);
  for (const after of [false, true]) {
    const input = expectedAdminSchema(after);
    input.schema = input.schema.filter((r) => !optional.has(r.name));
    delete input.stamps.streamlion_credit_cards_schema_v1;
    assert.equal(
      adminPreflight(input).migration,
      after ? "already_applied" : "pending",
    );
  }
});

test("any optional saved-card object or stamp requires the exact complete 0017 schema", async () => {
  const { expectedAdminSchema, adminPreflight } =
    await import("../../scripts/preflight-admin.mjs");
  const names = [
    "streamlion_credit_cards_v1",
    "streamlion_credit_topups_v1",
    "streamlion_credit_cards_schema_v1",
  ];
  for (const after of [false, true]) {
    for (let mask = 1; mask < 8; mask++) {
      const input = expectedAdminSchema(after);
      input.schema = input.schema.filter(
        (r) =>
          !names.includes(r.name) ||
          Boolean(mask & (1 << names.indexOf(r.name))),
      );
      if (!(mask & 4)) delete input.stamps.streamlion_credit_cards_schema_v1;
      if (mask === 7) assert.doesNotThrow(() => adminPreflight(input));
      else assert.throws(() => adminPreflight(input), /STOP/);
    }
    const stray = expectedAdminSchema(after);
    stray.schema = stray.schema.filter((r) => !names.includes(r.name));
    assert.throws(() => adminPreflight(stray), /STOP/);
    const altered = expectedAdminSchema(after);
    altered.schema.find((r) => r.name === names[0]).sql += " /* drift */";
    assert.throws(() => adminPreflight(altered), /STOP/);
    const wrongStamp = expectedAdminSchema(after);
    wrongStamp.stamps.streamlion_credit_cards_schema_v1 = 2;
    assert.throws(() => adminPreflight(wrongStamp), /STOP/);
  }
});

test("0025 installs with 0017 absent without creating saved-card objects", async () => {
  const { adminPreflight } = await import("../../scripts/preflight-admin.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../../migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          f <= "0025_admin_portal.sql" &&
          !f.startsWith("0017"),
      )
      .sort())
      db.exec(readFileSync(new URL(file, dir), "utf8"));
    const schema = db
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    const stamps = Object.fromEntries(
      schema
        .filter((r) => r.type === "table" && r.name.endsWith("schema_v1"))
        .map((r) => [
          r.name,
          db.prepare("SELECT version FROM " + r.name).get().version,
        ]),
    );
    assert.equal(
      adminPreflight({ schema, stamps }).migration,
      "already_applied",
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM sqlite_master WHERE name IN ('streamlion_credit_cards_v1','streamlion_credit_topups_v1','streamlion_credit_cards_schema_v1')",
        )
        .get().n,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT sum(enabled+grants_enabled) n FROM streamlion_admin_policy_v1",
        )
        .get().n,
      0,
    );
  } finally {
    db.close();
  }
});
