import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { coordinationReady } from "../../server/coordination-readiness.js";

function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const name of [
    "coordination",
    "coordination_notifications",
    "coordination_efficiency",
  ])
    sql.exec(
      `CREATE TABLE streamlion_${name}_schema_v1(version INTEGER PRIMARY KEY); INSERT INTO streamlion_${name}_schema_v1 VALUES(1)`,
    );
  sql.exec(
    "CREATE TABLE streamlion_coordination_policy_v1(mode TEXT PRIMARY KEY,active INTEGER); INSERT INTO streamlion_coordination_policy_v1 VALUES('test',1),('live',0)",
  );
  let reads = 0;
  const wrap = (query, values = []) => ({
    bind: (...args) => wrap(query, args),
    first: async () => {
      reads++;
      return sql.prepare(query).get(...values) || null;
    },
  });
  const env = {
    GOOGLE_SESSIONS: { prepare: wrap },
    ENABLE_CLIENT_COORDINATION: "true",
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_CLIENT_SECRET: "synthetic",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    VITE_GOOGLE_CLIENT_ID: "synthetic",
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    STREAMLION_PAYMENTS_MODE: "test",
    STREAMLION_AI_CREDITS_MODE: "test",
  };
  return {
    sql,
    env,
    reads: () => reads,
    reset: () => {
      reads = 0;
    },
  };
}

test("coordination eligibility uses one fresh database read and immediately respects policy changes", async (t) => {
  const f = fixture(t);
  assert.equal(await coordinationReady(f.env), true);
  assert.equal(f.reads(), 1, "one consistent eligibility read per call");
  f.sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=0 WHERE mode='test'",
  );
  f.reset();
  assert.equal(await coordinationReady(f.env), false);
  assert.equal(f.reads(), 1);
  f.sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='test'",
  );
  f.reset();
  assert.equal(await coordinationReady(f.env), true);
  assert.equal(f.reads(), 1);
  assert.equal(
    await coordinationReady({
      ...f.env,
      STREAMLION_PAYMENTS_MODE: "live",
      STREAMLION_AI_CREDITS_MODE: "live",
    }),
    false,
  );
});

test("every missing readiness marker or table fails closed without cached authorization", async (t) => {
  const f = fixture(t);
  for (const name of [
    "coordination",
    "coordination_notifications",
    "coordination_efficiency",
  ]) {
    const table = `streamlion_${name}_schema_v1`;
    assert.equal(await coordinationReady(f.env), true);
    f.sql.exec(`DELETE FROM ${table}`);
    assert.equal(await coordinationReady(f.env), false);
    f.sql.exec(`INSERT INTO ${table} VALUES(1)`);
  }
  f.sql.exec("DROP TABLE streamlion_coordination_notifications_schema_v1");
  assert.equal(await coordinationReady(f.env), false);
  assert.equal(
    await coordinationReady({ ...f.env, STREAMLION_AI_CREDITS_MODE: "live" }),
    false,
  );
});
