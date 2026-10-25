import test from "node:test";
import assert from "node:assert/strict";
import { adminFixture, ADMIN_NOW } from "../../test/admin-fixture.js";
import { generateKeyPair, SignJWT } from "jose";
async function modules() {
  let m;
  try {
    m = await import("../../server/admin-portal.js");
  } catch {}
  assert.ok(m, "Admin portal server must exist");
  return m;
}
async function owner(t) {
  const f = await adminFixture(t);
  f.db
    .prepare(
      "UPDATE streamlion_google_sessions_v1 SET google_subject='owner',email='shakoure@transcendencemedia.com' WHERE session_hash=?",
    )
    .run(f.sessionHash);
  f.db
    .prepare(
      "INSERT INTO streamlion_admin_windows_v1 VALUES(?,'owner','live',?,?,?)",
    )
    .run(f.sessionHash, ADMIN_NOW, ADMIN_NOW, ADMIN_NOW);
  f.env.STREAMLION_PAYMENTS_MODE = "live";
  const { observeAccount } = await import("../../server/admin-data.js");
  await observeAccount(
    f.env.GOOGLE_SESSIONS,
    { sub: "account-a", email: "member@example.com" },
    "live",
    ADMIN_NOW,
  );
  const m = await modules();
  f.call = (path, { body, headers = {} } = {}) =>
    m.handleAdmin(
      {
        env: f.env,
        params: { path: path.split("/") },
        request: new Request("https://app.example/api/admin/" + path, {
          method: body ? "POST" : "GET",
          headers: {
            Cookie: "__Host-streamlion-session=" + f.cookie,
            Origin: "https://app.example",
            "Content-Type": "application/json",
            "X-StreamLion-Account": "owner",
            ...headers,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      },
      { now: () => ADMIN_NOW },
    );
  return f;
}
test("non-owner and forged account headers cannot retrieve admin account data", async (t) => {
  const f = await adminFixture(t);
  const { handleAdmin } = await modules();
  f.env.STREAMLION_PAYMENTS_MODE = "live";
  const r = await handleAdmin({
    env: f.env,
    params: { path: ["users"] },
    request: new Request("https://app.example/api/admin/users", {
      headers: {
        Cookie: "__Host-streamlion-session=" + f.cookie,
        "X-StreamLion-Account": "owner",
      },
    }),
  });
  assert.equal(r.status, 403);
  assert.doesNotMatch(
    await r.text(),
    /synthetic-google-access|credentials|provider@example/,
  );
});
test("grant/reversal authorizations bind exact payload and replay returns original receipt after refund/pause", async (t) => {
  const f = await owner(t);
  const op = {
    operationId: crypto.randomUUID(),
    type: "grant",
    target: "account-a",
    credits: 100,
    reason: "Service recovery",
  };
  const a = await (await f.call("authorize", { body: op })).json();
  assert.ok(a.authorization);
  let r = await f.call("grants", {
    body: { ...op, credits: 101, authorization: a.authorization },
  });
  assert.equal(r.status, 403);
  r = await f.call("grants", {
    body: { ...op, authorization: a.authorization },
  });
  assert.equal(r.status, 200);
  const receipt = await r.json();
  assert.equal(receipt.amountCredits, 100);
  assert.equal(f.balance(), 1250000);
  f.db.exec(
    "UPDATE streamlion_purchases_v1 SET status='refunded'; UPDATE streamlion_admin_policy_v1 SET grants_enabled=0",
  );
  r = await f.call("grants", {
    body: { ...op, authorization: a.authorization },
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).id, receipt.id);
  const locked = await (await f.call("users/account-a")).json();
  assert.equal(locked.user.wallet.available, 0);
  assert.equal(f.balance(), 1250000);
});
test("expired admin windows and cross-origin mutations fail closed", async (t) => {
  const f = await owner(t);
  const op = {
    operationId: crypto.randomUUID(),
    type: "grant",
    target: "account-a",
    credits: 1,
    reason: "Help",
  };
  assert.equal(
    (
      await f.call("authorize", {
        body: op,
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  f.db
    .prepare("UPDATE streamlion_admin_windows_v1 SET last_seen_at=? WHERE id=?")
    .run(ADMIN_NOW - 900001, f.sessionHash);
  assert.equal((await f.call("users")).status, 401);
});
test("owner reporting is mode scoped, distinguishes first-known dates, and never exposes session credentials", async (t) => {
  const f = await owner(t);
  const { observeAccount } = await import("../../server/admin-data.js");
  await observeAccount(
    f.env.GOOGLE_SESSIONS,
    { sub: "account-a", email: "member@example.com" },
    "live",
    ADMIN_NOW,
  );
  f.paid("test-user", "test");
  await observeAccount(
    f.env.GOOGLE_SESSIONS,
    { sub: "test-user", email: "test@example.com" },
    "test",
    ADMIN_NOW,
  );
  const r = await f.call("users");
  assert.equal(r.status, 200);
  const value = await r.json();
  assert.equal(value.users.length, 1);
  assert.equal(value.users[0].email, "member@example.com");
  assert.equal(value.users[0].name, "");
  assert.doesNotMatch(
    JSON.stringify(value),
    /credentials|refreshToken|test@example.com/,
  );
  const o = await (await f.call("overview")).json();
  assert.equal(o.registered, 1);
  assert.equal(o.mode, "live");
});
test("New York daily/month boundaries use daylight-saving-aware calendar dates", async () => {
  await modules();
  const { localDate } = await import("../../server/admin-data.js");
  assert.equal(localDate(Date.parse("2026-11-01T03:59:00Z")), "2026-10-31");
  assert.equal(localDate(Date.parse("2026-11-01T05:30:00Z")), "2026-11-01");
  assert.equal(localDate(Date.parse("2026-11-01T06:30:00Z")), "2026-11-01");
  assert.equal(localDate(Date.parse("2026-03-08T04:59:00Z")), "2026-03-07");
});
test("mutation freshness requires a signed nonce-bound Google auth_time rather than current token issue time", async () => {
  await modules();
  const { verifyOwnerClaims } = await import("../../server/admin-auth.js");
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const now = ADMIN_NOW;
  const claims = {
    sub: "owner",
    nonce: "nonce",
    auth_time: Math.floor(now / 1000),
    amr: ["mfa"],
  };
  const jwt = async (extra) =>
    new SignJWT({ ...claims, ...extra })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://accounts.google.com")
      .setAudience("client")
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + 600)
      .sign(privateKey);
  assert.equal(
    await verifyOwnerClaims(await jwt({}), {
      subject: "owner",
      nonce: "nonce",
      clientId: "client",
      now,
      key: publicKey,
    }),
    Math.floor(now / 1000) * 1000,
  );
  await assert.rejects(async () =>
    verifyOwnerClaims(await jwt({ auth_time: Math.floor(now / 1000) - 1000 }), {
      subject: "owner",
      nonce: "nonce",
      clientId: "client",
      now,
      key: publicKey,
    }),
  );
  await assert.rejects(async () =>
    verifyOwnerClaims(await jwt({ nonce: "wrong" }), {
      subject: "owner",
      nonce: "nonce",
      clientId: "client",
      now,
      key: publicKey,
    }),
  );
});
test("Google sign-in accepts only exact admin entries and returns to the network entry", async () => {
  const { googleReturnPath } = await import("../../server/google-auth.js");
  assert.equal(googleReturnPath("/admin/", {}), "/api/admin-portal");
  assert.equal(googleReturnPath("/api/admin-portal", {}), "/api/admin-portal");
  for (const path of [
    "/api/admin-portal/",
    "/api/admin-portal?next=https://evil.example",
    "/api/admin-portal/https://evil.example",
    "//evil.example/api/admin-portal",
  ])
    assert.equal(googleReturnPath(path, {}), "/");
  assert.equal(googleReturnPath("/admin/https://evil.example", {}), "/");
});
test("unused fractional AI credit remainder can be corrected exactly", async (t) => {
  const f = await owner(t);
  const id = f.grant("account-a", 1);
  f.db.exec(
    "UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=60000,total_budget_micros=600000,daily_requests=100 WHERE mode='live'",
  );
  f.db
    .prepare(
      "INSERT INTO streamlion_credit_turns_v1 VALUES('live','account-a','fraction',?,7800,6000,'reserved')",
    )
    .run(ADMIN_NOW);
  f.db.exec(
    "UPDATE streamlion_credit_turns_v1 SET state='complete' WHERE request_id='fraction'",
  );
  const op = {
    operationId: crypto.randomUUID(),
    type: "reversal",
    target: id,
    credits: 0.376,
    reason: "Correct remaining grant",
  };
  const a = await (await f.call("authorize", { body: op })).json();
  assert.ok(a.authorization);
  assert.equal(
    (
      await f.call("reversals", {
        body: { ...op, authorization: a.authorization },
      })
    ).status,
    200,
  );
  assert.equal(f.balance(), 0);
});
test("global credit activity stays mode-scoped and overview includes first-known account growth", async (t) => {
  const f = await owner(t);
  const { observeAccount } = await import("../../server/admin-data.js");
  await observeAccount(
    f.env.GOOGLE_SESSIONS,
    { sub: "new-user", email: "new@example.com" },
    "live",
    ADMIN_NOW,
  );
  f.grant("account-a", 20);
  const r = await f.call("activity");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).entries.length, 1);
  const o = await (await f.call("overview")).json();
  assert.equal(
    o.trend.reduce((n, r) => n + r.known, 0),
    1,
  );
});
