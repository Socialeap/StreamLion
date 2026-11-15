import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { hasCoreLicense, hasPurchase } from "../../server/purchase-access.js";
import { ownerLicensePreflight } from "../../scripts/preflight-owner-license.mjs";
import { handleCredits } from "../../server/stripe-credits.js";
import { handlePurchase } from "../../server/stripe-purchase.js";
import { hash } from "../../server/google-auth.js";
import { coordinationEligibilitySQL } from "../../server/coordination-qa-access.js";

const email = "shakoure@transcendencemedia.com";
function fixture(t, applyOwnerLicense = true) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const dir = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    if (applyOwnerLicense || file !== "0028_owner_license.sql")
      db.exec(readFileSync(new URL(file, dir), "utf8"));
  db.prepare(
    "INSERT INTO streamlion_admin_owners_v1 VALUES('live','owner',?,1)",
  ).run(email);
  db.prepare(
    "INSERT INTO streamlion_accounts_v1(google_subject,email,first_known_at,first_known_source) VALUES('owner',?,1,'fixture')",
  ).run(email);
  const wrap = (query, args = []) => ({
    bind: (...values) => wrap(query, values),
    first: async () => db.prepare(query).get(...args),
  });
  const env = {
    GOOGLE_SESSIONS: { prepare: wrap },
    GOOGLE_AUTH_ORIGIN: "https://streamlion.transcendencemedia.com",
    STREAMLION_PAYMENTS_MODE: "live",
  };
  return { db, env };
}
test("the durable owner license is separately enrolled, scoped and revocable, with no purchase", async (t) => {
  const { db, env } = fixture(t);
  assert.equal(await hasCoreLicense(env, "owner"), false);
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO streamlion_owner_licenses_v1 VALUES('live','other',1,1,10000000)",
      ),
    /owner_license_identity/,
  );
  db.exec(
    "INSERT INTO streamlion_owner_licenses_v1 VALUES('live','owner',1,1,10000000)",
  );
  assert.equal(await hasCoreLicense(env, "owner"), true);
  assert.equal(await hasPurchase(env, "owner"), false);
  assert.equal(await hasCoreLicense(env, "other"), false);
  assert.equal(
    await hasCoreLicense({ ...env, STREAMLION_PAYMENTS_MODE: "test" }, "owner"),
    false,
  );
  assert.equal(
    await hasCoreLicense(
      { ...env, GOOGLE_AUTH_ORIGIN: "https://preview.example" },
      "owner",
    ),
    false,
  );

  const coordination = db.prepare(
    "SELECT " +
      (await coordinationEligibilitySQL(env, "c")) +
      " AS eligible FROM (SELECT 'live' mode, ? google_subject) c",
  );
  assert.equal(coordination.get("owner").eligible, 1);
  assert.equal(coordination.get("other").eligible, 0);
  db.exec("UPDATE streamlion_admin_owners_v1 SET enabled=0");
  assert.equal(await hasCoreLicense(env, "owner"), false);
  assert.equal(coordination.get("owner").eligible, 0);
  db.exec(
    "UPDATE streamlion_admin_owners_v1 SET enabled=1; UPDATE streamlion_owner_licenses_v1 SET enabled=0",
  );
  assert.equal(await hasCoreLicense(env, "owner"), false);
});

test("the purchase status endpoint reports the owner license without requiring Stripe configuration", async (t) => {
  const { db, env } = fixture(t);
  db.exec(
    "INSERT INTO streamlion_owner_licenses_v1 VALUES('live','owner',1,1,10000000)",
  );
  const cookie = "a".repeat(43);
  db.prepare(
    "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,'owner',?,'fixture',?)",
  ).run(await hash(cookie), email, Date.now() + 100000);
  const status = await handlePurchase({
    request: new Request(env.GOOGLE_AUTH_ORIGIN + "/api/purchase/status", {
      headers: { Cookie: "__Host-streamlion-session=" + cookie },
    }),
    env: { ...env, STREAMLION_REQUIRE_LICENSE: "true" },
    params: { path: ["status"] },
  });
  assert.equal(status.status, 200);
  const receipt = await status.json();
  assert.equal(receipt.ownerLicensed, true);
  assert.equal(receipt.purchased, false);
  assert.equal(receipt.guarantee, null);
  const credits = await handleCredits({
    request: new Request(env.GOOGLE_AUTH_ORIGIN + "/api/credits/status", {
      headers: { Cookie: "__Host-streamlion-session=" + cookie },
    }),
    env,
    params: { path: ["status"] },
  });
  assert.equal(credits.status, 200);
  const wallet = await credits.json();
  assert.equal(wallet.ownerLicensed, true);
  assert.equal(wallet.balanceMicros, 0);
});

test("owner goodwill funds AI and speech once under the lifetime cap and provider policies", (t) => {
  const { db } = fixture(t);
  const now = Date.now();
  db.exec(
    "UPDATE streamlion_admin_policy_v1 SET enabled=1,grants_enabled=1 WHERE mode='live'",
  );
  db.prepare(
    "INSERT INTO streamlion_admin_windows_v1 VALUES('window','owner','live',?,?,?)",
  ).run(now, now, now);
  const grant = (id, month, credits) => {
    db.prepare(
      "INSERT INTO streamlion_admin_authorizations_v1 VALUES(?,'live','owner','window','hash',?,0,?)",
    ).run(id, now + 60000, id);
    db.prepare(
      "INSERT INTO streamlion_admin_grants_v1 VALUES(?,'live','owner','owner',?,?,?,'Owner allowance',?,'hash',1)",
    ).run(id, credits * 12500, month, now, id);
  };
  assert.throws(() => grant("unlicensed", "2026-11", 800), /admin_eligibility/);
  db.exec(
    "INSERT INTO streamlion_owner_licenses_v1 VALUES('live','owner',1,1,10000000)",
  );
  grant("initial", "2026-11", 800);
  assert.throws(
    () => grant("next-month", "2026-12", 1),
    /owner_license_credit_cap/,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM streamlion_admin_audit_v1 WHERE action='grant'",
      )
      .get().n,
    1,
  );

  const ai = db.prepare(
    "INSERT INTO streamlion_credit_turns_v1 VALUES('live','owner','answer',?,7800,6000,'reserved')",
  );
  const speech = db.prepare(
    "INSERT INTO streamlion_speech_turns_v1 VALUES('live','owner','speech','scope','hash',12500,1000,'reserved',?)",
  );
  assert.throws(() => ai.run(now), /credit_capacity/);
  assert.throws(() => speech.run(now), /speech_capacity/);
  db.exec(`UPDATE streamlion_speech_policy_v1 SET active=1,cost_micros=1000,daily_budget_micros=1000,total_budget_micros=1000,daily_requests=1 WHERE mode='live';
           UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=6000,total_budget_micros=6000,daily_requests=1 WHERE mode='live';`);
  ai.run(now);
  speech.run(now);
  const balance = () =>
    db
      .prepare(
        "SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode='live' AND google_subject='owner'",
      )
      .get().balance_micros;
  assert.equal(balance(), 10000000 - 7800 - 12500);
  db.exec(
    "UPDATE streamlion_credit_turns_v1 SET state='complete'; UPDATE streamlion_speech_turns_v1 SET state='failed'",
  );
  assert.equal(balance(), 10000000 - 7800);
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO streamlion_speech_turns_v1 VALUES('live','owner','speech-2','scope','hash',12500,1000,'reserved',?)",
        )
        .run(now),
    /speech_capacity/,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM streamlion_purchases_v1").get().n,
    0,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM streamlion_credit_orders_v1").get().n,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode='live' AND google_subject='owner'",
      )
      .get().balance_micros,
    0,
  );
});

test("release preflight rejects an interrupted owner migration and an altered grant guard", async (t) => {
  const { db, env } = fixture(t, false);
  const snapshot = () => {
    const schema = db
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    return {
      schema,
      stamps: Object.fromEntries(
        schema
          .filter((r) => r.type === "table" && r.name.endsWith("_schema_v1"))
          .map(({ name }) => [
            name,
            db.prepare("SELECT version FROM " + name).get().version,
          ]),
      ),
    };
  };
  assert.equal(await hasCoreLicense(env, "owner"), false);
  assert.equal(ownerLicensePreflight(snapshot()).migration, "pending");
  db.exec(
    readFileSync(
      new URL("../../migrations/0028_owner_license.sql", import.meta.url),
      "utf8",
    ),
  );
  const applied = snapshot();
  assert.equal(ownerLicensePreflight(applied).migration, "already_applied");
  assert.throws(
    () =>
      ownerLicensePreflight({
        ...applied,
        stamps: {
          ...applied.stamps,
          streamlion_owner_license_schema_v1: undefined,
        },
      }),
    /owner license stamp/,
  );
  const guard = applied.schema.find(
    (r) => r.name === "streamlion_admin_grant_guard_v1",
  );
  guard.sql = guard.sql.replace("owner_license_credit_cap", "different_cap");
  assert.throws(
    () => ownerLicensePreflight(applied),
    /altered owner license schema/,
  );
});
