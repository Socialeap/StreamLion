import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { hash } from "../../server/google-auth.js";
import {
  signProfileAssertion,
  PROFILE_AUDIENCE,
} from "../../src/f3d-profile.js";
import { handleF3DProfile } from "../../server/f3d-profile.js";
const keys = await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
]);
const privateKey = await crypto.subtle.exportKey("jwk", keys.privateKey),
  publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
const snapshot = {
  schemaVersion: 1,
  kind: "f3d.provider-profile",
  accountId: "11111111-1111-4111-8111-111111111111",
  businessProfile: null,
  directoryProfile: null,
};
async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const f of readdirSync(new URL("../../migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(
      readFileSync(new URL("../../migrations/" + f, import.meta.url), "utf8"),
    );
  const wrap = (q, args = []) => ({
    bind: (...a) => wrap(q, a),
    first: async () => db.prepare(q).get(...args) || null,
    run: async () => ({
      meta: { changes: db.prepare(q).run(...args).changes },
    }),
  });
  const env = {
    GOOGLE_SESSIONS: { prepare: wrap },
    GOOGLE_AUTH_ORIGIN: PROFILE_AUDIENCE,
    STREAMLION_PAYMENTS_MODE: "test",
    ENABLE_F3D_PROFILE_BRIDGE: "true",
    F3D_PROVIDER_PROFILE_PUBLIC_JWK: JSON.stringify(publicKey),
  };
  for (const [token, subject] of [
    ["A", "a"],
    ["B", "b"],
    ["C", "a"],
  ])
    db.prepare(
      "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,?,?,?,?)",
    ).run(
      await hash(token.repeat(43)),
      subject,
      subject + "@example.com",
      "encrypted",
      Date.now() + 86400000,
    );
  const call = (body, token = "A", headers = {}) =>
    handleF3DProfile({
      env,
      request: new Request(PROFILE_AUDIENCE + "/api/f3d-profile", {
        method: body ? "POST" : "GET",
        headers: {
          Cookie: "__Host-streamlion-session=" + token.repeat(43),
          Origin: PROFILE_AUDIENCE,
          "Content-Type": "application/json",
          "X-StreamLion-Account": token === "B" ? "b" : "a",
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    });
  const start = async () => {
    const r = await call({ action: "start" });
    assert.equal(r.status, 200);
    return r.json();
  };
  return { db, env, call, start };
}
test("explicit connection is isolated by account/mode and keeps no assertion credentials", async (t) => {
  const f = await fixture(t),
    initial = await (await f.call()).json();
  assert.equal(initial.connected, false);
  const attempt = await f.start();
  const assertion = await signProfileAssertion(
    snapshot,
    attempt.nonce,
    PROFILE_AUDIENCE,
    privateKey,
  );
  const response = await f.call({
    action: "complete",
    nonce: attempt.nonce,
    assertion,
  });
  assert.equal(response.status, 200);
  const linked = await response.json();
  assert.equal(linked.connected, true);
  assert.deepEqual(linked.snapshot, snapshot);
  assert(linked.verifiedAt);
  assert.equal((await (await f.call(null, "B")).json()).connected, false);
  assert(
    !JSON.stringify(
      f.db.prepare("SELECT * FROM streamlion_f3d_profile_v1").all(),
    ).includes(assertion),
  );
  assert.equal((await f.call({ action: "unlink" })).status, 200);
  assert.equal((await (await f.call()).json()).connected, false);
});
test("nonce cannot cross sessions even for the same Google owner, or be replayed", async (t) => {
  const f = await fixture(t),
    a = await f.start(),
    assertion = await signProfileAssertion(
      snapshot,
      a.nonce,
      PROFILE_AUDIENCE,
      privateKey,
    ),
    body = { action: "complete", nonce: a.nonce, assertion };
  assert.equal((await f.call(body, "B")).status, 409);
  assert.equal((await f.call(body, "C")).status, 409);
  assert.equal((await f.call(body)).status, 200);
  assert.equal((await f.call(body)).status, 409);
});
test("bad signatures and expired attempts do not overwrite a saved snapshot", async (t) => {
  const f = await fixture(t),
    a = await f.start();
  assert.equal(
    (await f.call({ action: "complete", nonce: a.nonce, assertion: "bad" }))
      .status,
    400,
  );
  f.db.exec("UPDATE streamlion_f3d_profile_v1 SET pending_expires_at=0");
  const assertion = await signProfileAssertion(
    snapshot,
    a.nonce,
    PROFILE_AUDIENCE,
    privateKey,
  );
  assert.equal(
    (await f.call({ action: "complete", nonce: a.nonce, assertion })).status,
    409,
  );
  assert.equal((await (await f.call()).json()).connected, false);
});
test("switching F3D identity requires an explicit unlink", async (t) => {
  const f = await fixture(t),
    a = await f.start();
  await f.call({
    action: "complete",
    nonce: a.nonce,
    assertion: await signProfileAssertion(
      snapshot,
      a.nonce,
      PROFILE_AUDIENCE,
      privateKey,
    ),
  });
  const b = await f.start(),
    other = { ...snapshot, accountId: "22222222-2222-4222-8222-222222222222" };
  assert.equal(
    (
      await f.call({
        action: "complete",
        nonce: b.nonce,
        assertion: await signProfileAssertion(
          other,
          b.nonce,
          PROFILE_AUDIENCE,
          privateKey,
        ),
      })
    ).status,
    409,
  );
  assert.equal(
    (await (await f.call()).json()).snapshot.accountId,
    snapshot.accountId,
  );
});
test("origin, account, content shape, configuration and migration gates fail closed", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.call({ action: "start" }, "A", { Origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal(
    (await f.call({ action: "start" }, "A", { "X-StreamLion-Account": "b" }))
      .status,
    403,
  );
  assert.equal(
    (await f.call({ action: "start" }, "A", { "Content-Type": "text/plain" }))
      .status,
    415,
  );
  assert.equal((await f.call({ action: "start", owner: "b" })).status, 400);
  assert.equal((await f.call(null, "Z")).status, 401);
  f.env.ENABLE_F3D_PROFILE_BRIDGE = "false";
  assert.equal((await (await f.call()).json()).available, false);
  assert.equal((await f.call({ action: "start" })).status, 503);
  f.env.ENABLE_F3D_PROFILE_BRIDGE = "true";
  delete f.env.F3D_PROVIDER_PROFILE_PUBLIC_JWK;
  assert.equal((await f.call({ action: "start" })).status, 503);
  f.env.F3D_PROVIDER_PROFILE_PUBLIC_JWK = JSON.stringify(publicKey);
  f.db.exec("DROP TABLE streamlion_f3d_profile_v1");
  assert.equal((await (await f.call()).json()).available, false);
});
