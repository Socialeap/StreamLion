import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { hash, seal, unseal } from "../../server/google-auth.js";
import {
  enqueueNotice,
  dispatchNotifications,
  notificationSettings,
  validateSubscription,
  resendReady,
} from "../../server/coordination-notifications.js";
import { handleResendWebhook } from "../../server/resend-webhook.js";
import { coordinationPreflight } from "../../scripts/preflight-coordination.mjs";
const base64 = (b) => Buffer.from(b).toString("base64url");
function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../../migrations/", import.meta.url))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    sql.exec(
      readFileSync(
        new URL("../../migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  t.after(() => sql.close());
  const wrap = (q, args = []) => ({
    bind: (...a) => wrap(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => ({
      meta: { changes: sql.prepare(q).run(...args).changes },
    }),
  });
  const db = { prepare: wrap };
  const env = {
    GOOGLE_SESSIONS: db,
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    ENABLE_CLIENT_COORDINATION: "true",
    ENABLE_RESEND_EMAIL: "true",
    RESEND_API_KEY: "synthetic-server-key",
    RESEND_FROM_EMAIL: "projects@example.com",
    RESEND_DAILY_LIMIT: "100",
    RESEND_MONTHLY_LIMIT: "3000",
    RESEND_TEST_RECIPIENTS: "client@example.com",
    STREAMLION_PAYMENTS_MODE: "test",
    STREAMLION_AI_CREDITS_MODE: "test",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
  };
  sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='test'; INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at) VALUES('connection','owner','test','book','folder','encrypted','Provider',9999999999999); INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES('order','test','owner','owner@example.com','price','product',3995,'usd','paid',1,9999999999999,1);",
  );
  return { env, db, sql };
}
async function job(f, id = "job-one") {
  const row = {
    id,
    connection_id: "connection",
    client_email: await seal(f.env, "client@example.com", "job-email:" + id),
  };
  await f.db
    .prepare(
      "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES(?,?,?,?,?)",
    )
    .bind(id, row.connection_id, id, row.client_email, Date.now())
    .run();
  return row;
}
const message = {
  subject: "Review project",
  text: "An update needs attention.",
  url: "https://app.example/api/client-portal?job=job-one",
};
async function notice(f, row, id = "one", extra = {}) {
  await enqueueNotice(f.env, row, id, { ...message, ...extra });
}
function network(t, response = () => Response.json({ id: "receipt-one" })) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    calls.push(args);
    return response(...args);
  });
  return calls;
}
test("transport configuration and activation fail closed without invoking Resend", async (t) => {
  const f = fixture(t),
    row = await job(f),
    calls = network(t);
  await notice(f, row);
  for (const change of [
    { RESEND_API_KEY: "" },
    { RESEND_DAILY_LIMIT: "0" },
    { RESEND_MONTHLY_LIMIT: "" },
    { RESEND_TEST_RECIPIENTS: "" },
    { ENABLE_RESEND_EMAIL: "false" },
  ]) {
    assert.equal(resendReady({ ...f.env, ...change }), false);
    await dispatchNotifications({ ...f.env, ...change }, Date.now() + 1000);
  }
  await dispatchNotifications(
    { ...f.env, ENABLE_CLIENT_COORDINATION: "false" },
    Date.now() + 1000,
  );
  assert.equal(calls.length, 0);
});
test("Resend sends only approved recipient with stable identity and records acceptance separately from delivery", async (t) => {
  const f = fixture(t),
    row = await job(f),
    calls = network(t);
  await notice(f, row);
  assert.equal((await dispatchNotifications(f.env, Date.now() + 1000)).sent, 1);
  assert.equal(calls[0][0], "https://api.resend.com/emails");
  const options = calls[0][1];
  assert.equal(options.headers.Authorization, "Bearer synthetic-server-key");
  assert.equal(options.headers["Idempotency-Key"], "streamlion/one");
  assert.equal(options.redirect, "manual");
  const body = JSON.parse(options.body);
  assert.deepEqual(body.to, ["client@example.com"]);
  assert.equal(body.from, "StreamLion <projects@example.com>");
  assert.ok(body.text.endsWith(message.url));
  assert.equal(body.bcc, undefined);
  const saved = f.sql
    .prepare("SELECT * FROM streamlion_coordination_outbox_v1")
    .get();
  assert.equal(saved.status, "accepted");
  assert.deepEqual(await unseal(f.env, saved.payload, "mail:one"), {
    accepted: true,
  });
  await dispatchNotifications(f.env, Date.now() + 2000);
  assert.equal(calls.length, 1);
});
test("expired invitations, revoked connection, refund and test-recipient restrictions prevent sends", async (t) => {
  for (const reason of ["expired", "revoked", "refunded", "recipient"]) {
    const f = fixture(t),
      row = await job(f),
      calls = network(t);
    await notice(
      f,
      row,
      "one",
      reason === "expired" ? { expiresAt: Date.now() - 1 } : {},
    );
    if (reason === "revoked")
      f.sql.exec("UPDATE streamlion_coordination_connections_v1 SET revoked=1");
    if (reason === "refunded")
      f.sql.exec("UPDATE streamlion_purchases_v1 SET status='refunded'");
    if (reason === "recipient")
      f.env.RESEND_TEST_RECIPIENTS = "another@example.com";
    await dispatchNotifications(f.env, Date.now() + 1000);
    assert.equal(calls.length, 0, reason);
  }
});
test("uncertain mail retries stop before Resend idempotency expires", async (t) => {
  const f = fixture(t),
    row = await job(f),
    calls = network(t, () => {
      throw new Error("Synthetic timeout");
    });
  await notice(f, row);
  const now = Date.now() + 1000;
  await dispatchNotifications(f.env, now);
  await dispatchNotifications(f.env, now + 60000);
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0][1].headers["Idempotency-Key"],
    calls[1][1].headers["Idempotency-Key"],
  );
  await dispatchNotifications(f.env, now + 24 * 3600000);
  assert.equal(calls.length, 2);
  assert.equal(
    f.sql.prepare("SELECT status FROM streamlion_coordination_outbox_v1").get()
      .status,
    "uncertain",
  );
});
test("one dispatcher owns concurrent mail sends and respects daily and monthly caps", async (t) => {
  const f = fixture(t),
    row = await job(f);
  f.env.RESEND_DAILY_LIMIT = "1";
  f.env.RESEND_MONTHLY_LIMIT = "1";
  await notice(f, row, "one");
  await notice(f, row, "two");
  let release, invoked;
  const started = new Promise((r) => {
    invoked = r;
  });
  const wait = new Promise((r) => {
    release = r;
  });
  const calls = network(t, async () => {
    invoked();
    await wait;
    return Response.json({ id: "receipt-one" });
  });
  const now = Date.now() + 1000,
    first = dispatchNotifications(f.env, now);
  await started;
  assert.equal((await dispatchNotifications(f.env, now)).sent, 0);
  release();
  await first;
  await dispatchNotifications(f.env, now + 86400000);
  assert.equal(calls.length, 1);
});
test("routine email coalesces; invitations and requests for action remain queued", async (t) => {
  const f = fixture(t),
    row = await job(f);
  await notice(f, row, "edit-a", { kind: "routine" });
  await notice(f, row, "edit-b", { kind: "routine" });
  await notice(f, row, "approval");
  await notice(f, row, "invite", { expiresAt: Date.now() + 1200000 });
  const rows = f.sql
    .prepare(
      "SELECT id,status FROM streamlion_coordination_outbox_v1 ORDER BY id",
    )
    .all();
  assert.equal(rows.find((r) => r.id === "edit-a").status, "skipped");
  assert.ok(
    rows.filter((r) => r.id !== "edit-a").every((r) => r.status === "queued"),
  );
  assert.deepEqual(
    await unseal(
      f.env,
      f.sql
        .prepare(
          "SELECT payload FROM streamlion_coordination_outbox_v1 WHERE id='edit-a'",
        )
        .get().payload,
      "mail:edit-a",
    ),
    { skipped: true },
  );
});
async function pushConfig(env) {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  env.ENABLE_WEB_PUSH = "true";
  env.VAPID_PUBLIC_KEY = base64(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  env.VAPID_PRIVATE_KEY = (
    await crypto.subtle.exportKey("jwk", pair.privateKey)
  ).d;
  env.VAPID_SUBJECT = "mailto:owner@example.com";
  const device = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    endpoint: "https://fcm.googleapis.com/fcm/send/synthetic",
    keys: {
      p256dh: base64(await crypto.subtle.exportKey("raw", device.publicKey)),
      auth: base64(crypto.getRandomValues(new Uint8Array(16))),
    },
  };
}
test("push subscription rejects arbitrary endpoints and cannot be rebound to another client job", async (t) => {
  const f = fixture(t),
    subscription = await pushConfig(f.env);
  for (const endpoint of [
    "http://fcm.googleapis.com/a",
    "https://127.0.0.1/a",
    "https://fcm.googleapis.com.evil.example/a",
    "https://user:password@fcm.googleapis.com/a",
    "https://fcm.googleapis.com:8443/a",
  ])
    assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  const principal = {
    role: "client",
    connection: { id: "connection" },
    jobId: "job-one",
    grantHash: "grant",
    expiresAt: Date.now() + 100000,
  };
  const request = new Request(
    "https://app.example/api/coordination/client/notifications",
    { method: "POST" },
  );
  await notificationSettings(f.env, principal, request, {
    action: "subscribe",
    subscription,
  });
  const renewed = { ...principal, grantHash: "renewed-grant" };
  assert.equal(
    (
      await notificationSettings(
        f.env,
        renewed,
        new Request("https://app.example/settings"),
        null,
      )
    ).devices.length,
    0,
  );
  await notificationSettings(f.env, renewed, request, {
    action: "subscribe",
    subscription,
  });
  assert.equal(
    f.sql
      .prepare(
        "SELECT grant_hash FROM streamlion_coordination_push_subscriptions_v1",
      )
      .get().grant_hash,
    "renewed-grant",
  );
  await assert.rejects(
    notificationSettings(
      f.env,
      { ...principal, jobId: "job-two", grantHash: "other" },
      request,
      { action: "subscribe", subscription },
    ),
    /another session/,
  );
  const saved = f.sql
    .prepare(
      "SELECT payload FROM streamlion_coordination_push_subscriptions_v1",
    )
    .get().payload;
  assert.ok(!saved.includes(subscription.endpoint));
  f.sql.exec(
    "UPDATE streamlion_coordination_connections_v1 SET revoked=1 WHERE id='connection'; INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at) VALUES('connection-new','owner','test','book-new','folder-new','encrypted','Provider',9999999999999)",
  );
  await notificationSettings(
    f.env,
    {
      role: "provider",
      connection: { id: "connection-new" },
      expiresAt: Date.now() + 100000,
    },
    request,
    { action: "subscribe", subscription },
  );
  assert.equal(
    f.sql
      .prepare(
        "SELECT connection_id FROM streamlion_coordination_push_subscriptions_v1",
      )
      .get().connection_id,
    "connection-new",
  );
});
test("a redirect never forwards the Resend authorization to another origin", async (t) => {
  const f = fixture(t),
    row = await job(f);
  const calls = network(
    t,
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://untrusted.example/collect" },
      }),
  );
  await notice(f, row);
  await dispatchNotifications(f.env, Date.now() + 1000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].redirect, "manual");
  assert.equal(
    f.sql.prepare("SELECT status FROM streamlion_coordination_outbox_v1").get()
      .status,
    "queued",
  );
});
test("encrypted web push is grant-scoped; revoked client sessions prevent delivery", async (t) => {
  const f = fixture(t),
    row = await job(f),
    subscription = await pushConfig(f.env);
  await f.db
    .prepare(
      "INSERT INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) VALUES('grant',?,?)",
    )
    .bind(row.id, Date.now() + 100000)
    .run();
  const principal = {
    role: "client",
    connection: { id: "connection" },
    jobId: row.id,
    grantHash: "grant",
    expiresAt: Date.now() + 100000,
  };
  await notificationSettings(
    f.env,
    principal,
    new Request("https://app.example/settings", { method: "POST" }),
    { action: "subscribe", subscription },
  );
  const calls = network(t, (url) =>
    url.includes("resend")
      ? Response.json({ id: "receipt-one" })
      : new Response(null, { status: 201 }),
  );
  await notice(f, row);
  const result = await dispatchNotifications(f.env, Date.now() + 1000);
  assert.equal(result.pushed, 1);
  const push = calls.find((c) => c[0] === subscription.endpoint);
  assert.ok(push);
  assert.equal(
    new Headers(push[1].headers).get("Content-Encoding"),
    "aes128gcm",
  );
  assert.equal(push[1].redirect, "manual");
  assert.ok(
    new Headers(push[1].headers).get("Authorization").startsWith("vapid "),
  );
  f.sql.exec("UPDATE streamlion_coordination_sessions_v1 SET revoked=1");
  await notice(f, row, "two");
  await dispatchNotifications(f.env, Date.now() + 2000);
  assert.equal(calls.filter((c) => c[0] === subscription.endpoint).length, 1);
});
async function signedWebhook(
  env,
  event,
  stamp = Math.floor(Date.now() / 1000),
) {
  const secret = Buffer.alloc(32, 1),
    raw = JSON.stringify(event),
    id = "msg_synthetic_" + event.type;
  env.RESEND_WEBHOOK_SECRET = "whsec_" + secret.toString("base64");
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(id + "." + stamp + "." + raw),
    ),
  ).toString("base64");
  return new Request("https://app.example/api/resend-webhook", {
    method: "POST",
    headers: {
      "svix-id": id,
      "svix-timestamp": String(stamp),
      "svix-signature": "v1," + signature,
    },
    body: raw,
  });
}
test("only signed fresh Resend webhooks update delivery; complaints survive duplicates and late delivery", async (t) => {
  const f = fixture(t),
    row = await job(f);
  network(t);
  await notice(f, row);
  await dispatchNotifications(f.env, Date.now() + 1000);
  const event = (type) => ({ type, data: { email_id: "receipt-one" } });
  const invalid = await signedWebhook(f.env, event("email.delivered"));
  invalid.headers.set("svix-signature", "v1,invalid");
  assert.equal(
    (await handleResendWebhook({ env: f.env, request: invalid })).status,
    401,
  );
  assert.equal(
    (
      await handleResendWebhook({
        env: f.env,
        request: await signedWebhook(
          f.env,
          event("email.delivered"),
          Math.floor(Date.now() / 1000) - 600,
        ),
      })
    ).status,
    401,
  );
  for (const type of [
    "email.delivered",
    "email.complained",
    "email.delivered",
    "email.complained",
  ])
    assert.equal(
      (
        await handleResendWebhook({
          env: f.env,
          request: await signedWebhook(f.env, event(type)),
        })
      ).status,
      204,
    );
  assert.equal(
    f.sql.prepare("SELECT status FROM streamlion_coordination_outbox_v1").get()
      .status,
    "complained",
  );
});
test("an early webhook survives the race with the send acceptance receipt", async (t) => {
  const f = fixture(t),
    row = await job(f);
  network(t, async () => {
    const request = await signedWebhook(f.env, {
      type: "email.delivered",
      data: { email_id: "receipt-one" },
    });
    assert.equal(
      (await handleResendWebhook({ env: f.env, request })).status,
      204,
    );
    return Response.json({ id: "receipt-one" });
  });
  await notice(f, row);
  await dispatchNotifications(f.env, Date.now() + 1000);
  assert.equal(
    f.sql.prepare("SELECT status FROM streamlion_coordination_outbox_v1").get()
      .status,
    "delivered",
  );
});
test("routine updates prefer accepted push; expired endpoints fall back to email", async (t) => {
  for (const status of [201, 410]) {
    const f = fixture(t),
      row = await job(f),
      subscription = await pushConfig(f.env);
    const principal = {
      role: "provider",
      connection: { id: "connection" },
      expiresAt: Date.now() + 200000,
    };
    await notificationSettings(
      f.env,
      principal,
      new Request("https://app.example/settings", { method: "POST" }),
      { action: "subscribe", subscription },
    );
    const calls = network(t, (url) =>
      url.includes("resend")
        ? Response.json({ id: "receipt-one" })
        : new Response(null, { status }),
    );
    await f.db
      .prepare(
        "UPDATE streamlion_coordination_connections_v1 SET notification_email=?",
      )
      .bind(
        await seal(f.env, "client@example.com", "connection-email:connection"),
      )
      .run();
    await enqueueNotice(
      f.env,
      row,
      "routine",
      { ...message, kind: "routine" },
      "provider",
    );
    const now = Date.now() + 1000;
    await dispatchNotifications(f.env, now);
    await dispatchNotifications(f.env, now + 60000);
    assert.equal(
      calls.filter((c) => c[0].includes("resend")).length,
      status === 201 ? 0 : 1,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT COUNT(*) AS count FROM streamlion_coordination_push_subscriptions_v1",
        )
        .get().count,
      status === 201 ? 1 : 0,
    );
  }
});
test("worker displays neutral alerts and refuses cross-origin click destinations", async () => {
  const handlers = {},
    displayed = [],
    opened = [];
  const self = {
    location: { origin: "https://app.example" },
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    registration: {
      showNotification: async (...args) => {
        displayed.push(args);
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url) => {
        opened.push(url);
      },
    },
  };
  vm.runInNewContext(
    readFileSync(
      new URL("../../public/notification-sw.js", import.meta.url),
      "utf8",
    ),
    { self, URL },
  );
  let pending;
  handlers.push({
    data: {
      json: () => ({
        title: "Private name",
        body: "Access code",
        url: "https://evil.example/steal",
      }),
    },
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  assert.equal(displayed[0][0], "StreamLion");
  assert.ok(!displayed[0][1].body.includes("Access code"));
  handlers.notificationclick({
    notification: { data: { url: "https://evil.example/steal" }, close() {} },
    waitUntil: (p) => {
      pending = p;
    },
  });
  await pending;
  assert.equal(opened.length, 0);
});
test("0010 migration preflight verifies full shape and stops on partial state", (t) => {
  const f = fixture(t);
  const schema = f.sql
    .prepare(
      "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL",
    )
    .all();
  const stamps = Object.fromEntries(
    schema
      .filter((r) => r.name.includes("_schema_"))
      .map((r) => [
        r.name,
        f.sql.prepare("SELECT version FROM " + r.name).get().version,
      ]),
  );
  assert.equal(
    coordinationPreflight(
      { schema, stamps },
      "0010_coordination_notifications.sql",
    ).migration,
    "already_applied",
  );
  assert.throws(
    () =>
      coordinationPreflight(
        {
          schema: schema.filter(
            (r) => r.name !== "streamlion_coordination_email_budget_v1",
          ),
          stamps,
        },
        "0010_coordination_notifications.sql",
      ),
    /Partial/,
  );
});
