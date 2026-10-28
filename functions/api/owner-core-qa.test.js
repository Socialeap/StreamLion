import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ownerWorkspaceQa } from "../../server/owner-core-qa.js";
function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(
    "CREATE TABLE streamlion_admin_policy_v1(mode TEXT,enabled INTEGER); CREATE TABLE streamlion_admin_owners_v1(mode TEXT,google_subject TEXT,email TEXT,enabled INTEGER); INSERT INTO streamlion_admin_policy_v1 VALUES('live',1); INSERT INTO streamlion_admin_owners_v1 VALUES('live','owner-sub','shakoure@transcendencemedia.com',1)",
  );
  const now = 1800000000000,
    identity = {
      google_subject: "owner-sub",
      email: "shakoure@transcendencemedia.com",
    };
  const grant = {
    version: 1,
    scope: "google-workspace",
    mode: "live",
    origin: "https://streamlion.transcendencemedia.com",
    subject: "owner-sub",
    issuedAt: now - 1000,
    expiresAt: now + 3600000,
    reason: "Owner workbook QA",
  };
  const wrap = (q, v = []) => ({
    bind: (...args) => wrap(q, args),
    first: async () => sql.prepare(q).get(...v),
  });
  const env = {
    GOOGLE_SESSIONS: { prepare: wrap },
    STREAMLION_PAYMENTS_MODE: "live",
    STREAMLION_CHECKOUT_MODE: "paused",
    GOOGLE_AUTH_ORIGIN: grant.origin,
    STREAMLION_OWNER_CORE_QA_LICENSE: JSON.stringify(grant),
  };
  return { sql, now, identity, grant, env };
}
test("QA licence is fresh, owner-bound and immediately rejects owner-role revocation", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await ownerWorkspaceQa(f.env, f.identity, f.now), {
    scope: "google-workspace",
    expiresAt: 1800003600000,
  });
  f.sql.exec("UPDATE streamlion_admin_owners_v1 SET enabled=0");
  assert.equal(await ownerWorkspaceQa(f.env, f.identity, f.now), null);
});
test("QA licence never accepts another identity, mode, origin, expired interval or malformed grant", async (t) => {
  const f = fixture(t);
  assert.ok(await ownerWorkspaceQa(f.env, f.identity, f.now));
  for (const identity of [
    null,
    {},
    { ...f.identity, google_subject: "other" },
    { ...f.identity, email: "other@example.com" },
  ])
    assert.equal(await ownerWorkspaceQa(f.env, identity, f.now), null);
  for (const patch of [
    { subject: "other" },
    { version: 2 },
    { scope: "all" },
    { mode: "test" },
    { origin: "https://other.example" },
    { issuedAt: f.now + 1 },
    { expiresAt: f.now },
    { issuedAt: f.now - 86400000, expiresAt: f.now + 1 },
    { expiresAt: String(f.grant.expiresAt) },
    { reason: "" },
  ])
    assert.equal(
      await ownerWorkspaceQa(
        {
          ...f.env,
          STREAMLION_OWNER_CORE_QA_LICENSE: JSON.stringify({
            ...f.grant,
            ...patch,
          }),
        },
        f.identity,
        f.now,
      ),
      null,
    );
  for (const value of ["", "{", "null", "[]"])
    assert.equal(
      await ownerWorkspaceQa(
        { ...f.env, STREAMLION_OWNER_CORE_QA_LICENSE: value },
        f.identity,
        f.now,
      ),
      null,
    );
  for (const patch of [
    { STREAMLION_PAYMENTS_MODE: "test" },
    { STREAMLION_CHECKOUT_MODE: "open" },
    { GOOGLE_AUTH_ORIGIN: "https://preview.example" },
    {
      GOOGLE_SESSIONS: {
        prepare: () => {
          throw Error("DB down");
        },
      },
    },
  ])
    assert.equal(
      await ownerWorkspaceQa({ ...f.env, ...patch }, f.identity, f.now),
      null,
    );
  f.sql.exec("UPDATE streamlion_admin_policy_v1 SET enabled=0");
  assert.equal(await ownerWorkspaceQa(f.env, f.identity, f.now), null);
});
