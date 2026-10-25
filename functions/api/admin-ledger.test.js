import test from "node:test";
import assert from "node:assert/strict";
import { adminFixture, ADMIN_NOW } from "../../test/admin-fixture.js";
import { readFileSync, readdirSync } from "node:fs";
import { extensionFixture } from "../../test/extension-fixture.js";
test("migration preserves existing reserved charges without a second debit and restores their original sources", async (t) => {
  const f = await extensionFixture();
  t.after(() => f.db.close());
  const dir = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((n) => n.endsWith(".sql") && n >= "0007" && n < "0025")
    .sort())
    f.db.exec(readFileSync(new URL(file, dir), "utf8"));
  f.db.exec(
    "INSERT INTO streamlion_credit_wallets_v1 VALUES('live','account-a',10000000); INSERT INTO streamlion_promotional_wallets_v1 VALUES('live','account-a',1000000); UPDATE streamlion_coordination_policy_v1 SET active=1; UPDATE streamlion_speech_policy_v1 SET active=1,cost_micros=1000,daily_requests=1000,daily_budget_micros=1000000,total_budget_micros=10000000;",
  );
  f.db
    .prepare(
      "INSERT INTO streamlion_shared_spends_v1 VALUES('live','account-a','old-project','coordination',3000000,1000000,2000000,'reserved',?)",
    )
    .run(ADMIN_NOW);
  f.db
    .prepare(
      "INSERT INTO streamlion_speech_turns_v1 VALUES('live','account-a','old-speech','scope','input',12500,1000,'reserved',?)",
    )
    .run(ADMIN_NOW);
  const balances = () => [
    f.db
      .prepare("SELECT balance_micros n FROM streamlion_credit_wallets_v1")
      .get().n,
    f.db
      .prepare("SELECT balance_micros n FROM streamlion_promotional_wallets_v1")
      .get().n,
  ];
  const before = balances();
  f.db.exec(readFileSync(new URL("0025_admin_portal.sql", dir), "utf8"));
  assert.deepEqual(balances(), before);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM streamlion_spend_funding_v1").get().n,
    2,
  );
  f.db.exec(
    "UPDATE streamlion_shared_spends_v1 SET state='failed' WHERE id='old-project'; UPDATE streamlion_speech_turns_v1 SET state='failed' WHERE request_id='old-speech';",
  );
  assert.deepEqual(balances(), [10000000, 1000000]);
});
test("approved grant limits are enforced at the database and failed writes leave no wallet/audit changes", async (t) => {
  const f = await adminFixture(t);
  const g = f.grant();
  assert.equal(f.balance(), 10000000);
  assert.throws(() => f.grant("account-a", 1), /admin_account_cap/);
  assert.equal(f.balance(), 10000000);
  for (let i = 0; i < 4; i++) {
    f.paid("user" + i);
    f.grant("user" + i);
  }
  f.paid("sixth");
  assert.throws(() => f.grant("sixth", 1), /admin_month_cap/);
  assert.equal(f.balance("sixth"), 0);
  assert.equal(
    f.db
      .prepare(
        "SELECT count(*) n FROM streamlion_admin_audit_v1 WHERE action='grant'",
      )
      .get().n,
    5,
  );
  assert.throws(() => f.grant("sixth", 801), /admin_grant_cap/);
  assert.equal(
    f.db
      .prepare(
        "SELECT remaining_micros n FROM streamlion_admin_grant_balances_v1 WHERE grant_id=?",
      )
      .get(g).n,
    10000000,
  );
});
test("speech consumes manual goodwill before purchased funds, restores failed attempts once, and never spends starter", async (t) => {
  const f = await adminFixture(t);
  f.grant("account-a", 1);
  f.speech();
  assert.equal(f.balance(), 0);
  f.db.exec(
    "UPDATE streamlion_speech_turns_v1 SET state='failed' WHERE request_id='speech'",
  );
  assert.equal(f.balance(), 12500);
  assert.throws(
    () =>
      f.db.exec(
        "UPDATE streamlion_speech_turns_v1 SET state='failed' WHERE request_id='speech'",
      ),
    /speech_transition/,
  );
  assert.equal(f.balance(), 12500);
  f.speech("complete");
  f.db.exec(
    "UPDATE streamlion_speech_turns_v1 SET state='complete' WHERE request_id='complete'",
  );
  assert.equal(f.balance(), 0);
  f.db.exec(
    "INSERT INTO streamlion_promotional_wallets_v1 VALUES('live','account-a',100000)",
  );
  assert.throws(() => f.speech("starter-only"), /speech_capacity/);
});
test("refund retains admin goodwill, revokes starter funds, and does not confer spending access", async (t) => {
  const f = await adminFixture(t);
  f.grant("account-a", 10);
  f.db
    .prepare(
      "INSERT INTO streamlion_starter_grants_v1 VALUES('live','account-a',7500000,?,0)",
    )
    .run(ADMIN_NOW);
  f.db.exec(
    "UPDATE streamlion_purchases_v1 SET status='refunded' WHERE google_subject='account-a'",
  );
  assert.equal(f.balance(), 125000);
  assert.equal(
    f.db
      .prepare(
        "SELECT balance_micros n FROM streamlion_promotional_wallets_v1 WHERE google_subject='account-a'",
      )
      .get().n,
    0,
  );
  assert.throws(() => f.grant("account-a", 1), /admin_eligibility/);
  f.paid();
  f.speech();
  f.db.exec(
    "UPDATE streamlion_speech_turns_v1 SET state='failed' WHERE request_id='speech'",
  );
  assert.equal(f.balance(), 125000);
});
test("a grant reversal cannot take reserved or spent funds or refill issuance allowance", async (t) => {
  const f = await adminFixture(t);
  const id = f.grant("account-a", 800);
  f.speech();
  assert.throws(() => f.reverse(id, 800), /admin_reversal_balance/);
  f.reverse(id, 799);
  assert.equal(f.balance(), 0);
  assert.throws(() => f.reverse(id, 1), /admin_reversal_balance/);
  f.db.exec(
    "UPDATE streamlion_speech_turns_v1 SET state='failed' WHERE request_id='speech'",
  );
  assert.equal(f.balance(), 12500);
  f.reverse(id, 1);
  assert.equal(f.balance(), 0);
  assert.throws(() => f.grant("account-a", 1), /admin_account_cap/);
  assert.throws(
    () => f.db.exec("DELETE FROM streamlion_admin_grants_v1"),
    /admin_immutable/,
  );
});
test("audit failure rolls the entire grant back and mode allowances remain isolated", async (t) => {
  const f = await adminFixture(t);
  f.db.exec(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON streamlion_admin_audit_v1 BEGIN SELECT RAISE(ABORT,'audit_failure'); END;",
  );
  assert.throws(() => f.grant(), /audit_failure/);
  assert.equal(f.balance(), 0);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM streamlion_admin_grants_v1").get().n,
    0,
  );
  f.db.exec("DROP TRIGGER reject_audit");
  f.grant();
  f.paid("account-a", "test");
  f.grant("account-a", 800, { mode: "test" });
  assert.equal(f.balance("account-a", "test"), 10000000);
});
test("shared wallet and project reservation see goodwill without changing the starter source", async (t) => {
  const f = await adminFixture(t);
  f.grant("account-a", 400);
  const { sharedWallet, reserveProject, finishProject } =
    await import("../../server/shared-credits.js");
  const w = await sharedWallet(f.env.GOOGLE_SESSIONS, "live", "account-a");
  assert.equal(w.available, 5000000);
  assert.equal(w.goodwill, 5000000);
  const row = await reserveProject(
    f.env.GOOGLE_SESSIONS,
    "live",
    "account-a",
    "job-test",
    ADMIN_NOW,
  );
  assert.equal(row.promotional, 3000000);
  assert.equal(f.balance(), 2000000);
  await finishProject(
    f.env.GOOGLE_SESSIONS,
    "live",
    "account-a",
    "job-test",
    "failed",
  );
  assert.equal(f.balance(), 5000000);
});
test("database time rejects an authorization that expires while an old request waits to write", async (t) => {
  const f = await adminFixture(t);
  f.authorization("late");
  f.db.function(
    "unixepoch",
    { varargs: true },
    () => (ADMIN_NOW + 200000) / 1000,
  );
  assert.throws(
    () =>
      f.db
        .prepare(
          "INSERT INTO streamlion_admin_grants_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          "late",
          "live",
          "account-a",
          "owner",
          12500,
          "2026-10",
          ADMIN_NOW,
          "Delayed request",
          "late",
          "hash",
          1,
        ),
    /admin_authorization/,
  );
  assert.equal(f.balance(), 0);
});
