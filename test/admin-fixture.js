import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { extensionFixture } from "./extension-fixture.js";
export const ADMIN_NOW = Date.now();
export async function adminFixture(t) {
  const f = await extensionFixture();
  t.after(() => f.db.close());
  const dir = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".sql") && n >= "0007")
    .sort())
    f.db.exec(readFileSync(new URL(name, dir), "utf8"));
  assert.equal(
    f.db
      .prepare(
        "SELECT count(*) n FROM sqlite_master WHERE name='streamlion_admin_schema_v1'",
      )
      .get().n,
    1,
    "Admin schema must be installed",
  );
  f.db.exec(
    "UPDATE streamlion_admin_policy_v1 SET enabled=1,grants_enabled=1; INSERT INTO streamlion_admin_owners_v1 VALUES('live','owner','shakoure@transcendencemedia.com',1); INSERT INTO streamlion_admin_owners_v1 VALUES('test','owner','shakoure@transcendencemedia.com',1);",
  );
  f.db
    .prepare(
      "INSERT INTO streamlion_admin_windows_v1 VALUES('window','owner','live',?,?,?)",
    )
    .run(ADMIN_NOW, ADMIN_NOW, ADMIN_NOW);
  f.db.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=1; UPDATE streamlion_speech_policy_v1 SET active=1,cost_micros=1000,daily_requests=1000,daily_budget_micros=1000000,total_budget_micros=10000000;",
  );
  let seq = 0;
  function paid(subject = "account-a", mode = "live") {
    f.db
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,3995,'usd','paid',?,?,?)",
      )
      .run(
        "core-" + ++seq,
        mode,
        subject,
        subject + "@example.com",
        "price",
        "prod",
        ADMIN_NOW,
        ADMIN_NOW + 100000,
        ADMIN_NOW,
      );
    f.db
      .prepare(
        "INSERT OR IGNORE INTO streamlion_credit_wallets_v1 VALUES(?,?,0)",
      )
      .run(mode, subject);
  }
  function authorization(id, payload = "hash", mode = "live") {
    const window = mode === "live" ? "window" : "window-test";
    if (mode === "test")
      f.db
        .prepare(
          "INSERT OR IGNORE INTO streamlion_admin_windows_v1 VALUES('window-test','owner','test',?,?,?)",
        )
        .run(ADMIN_NOW, ADMIN_NOW, ADMIN_NOW);
    f.db
      .prepare(
        "INSERT INTO streamlion_admin_authorizations_v1 VALUES(?,?,?,?,?,?,0,?)",
      )
      .run(id, mode, "owner", window, payload, ADMIN_NOW + 100000, id);
  }
  function grant(
    subject = "account-a",
    credits = 800,
    { id = "g" + ++seq, mode = "live", month = "2026-10" } = {},
  ) {
    authorization(id, "hash", mode);
    f.db
      .prepare(
        "INSERT INTO streamlion_admin_grants_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        mode,
        subject,
        "owner",
        credits * 12500,
        month,
        ADMIN_NOW,
        "Service recovery",
        id,
        "hash",
        1,
      );
    return id;
  }
  function reverse(id, credits, { operation = "r" + ++seq } = {}) {
    authorization(operation);
    f.db
      .prepare(
        "INSERT INTO streamlion_admin_reversals_v1 VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        operation,
        id,
        "owner",
        credits * 12500,
        "Correction",
        ADMIN_NOW,
        operation,
        "hash",
        1,
      );
    return operation;
  }
  const balance = (subject = "account-a", mode = "live") =>
    f.db
      .prepare(
        "SELECT COALESCE(sum(b.remaining_micros),0) n FROM streamlion_admin_grant_balances_v1 b JOIN streamlion_admin_grants_v1 g ON g.id=b.grant_id WHERE g.google_subject=? AND g.mode=?",
      )
      .get(subject, mode).n;
  function speech(id = "speech", price = 12500) {
    f.db
      .prepare(
        "INSERT INTO streamlion_speech_turns_v1 VALUES('live','account-a',?,'scope','input',?,1000,'reserved',?)",
      )
      .run(id, price, ADMIN_NOW);
  }
  paid();
  return { ...f, paid, grant, reverse, balance, speech, authorization };
}
