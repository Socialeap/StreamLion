import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { handlePurchase, reconcile } from "../../server/stripe-purchase.js";
import { hash, handleGoogle } from "../../server/google-auth.js";
import { hasPurchase } from "../../server/purchase-access.js";
function fixture(t, { launch = true } = {}) {
  const sql = new DatabaseSync(":memory:");
  for (const name of [
    "0001_google_sessions",
    "0002_google_request_limits",
    "0003_google_workspace_folder",
    "0004_streamlion_purchases",
    "0005_streamlion_launch_200",
  ])
    sql.exec(
      readFileSync(
        new URL(`../../migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  const wrap = (query, values = []) => ({
    bind: (...v) => wrap(query, v),
    first: async () => sql.prepare(query).get(...values) || null,
    run: async () => ({
      meta: { changes: sql.prepare(query).run(...values).changes },
    }),
  });
  const env = {
    GOOGLE_SESSIONS: { prepare: wrap },
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_CLIENT_SECRET: "synthetic-google-secret",
    VITE_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    STREAMLION_PAYMENTS_MODE: "test",
    STREAMLION_REQUIRE_LICENSE: "true",
    STREAMLION_REFUND_DAYS: "7",
    STRIPE_SECRET_KEY: "sk_test_synthetic" + crypto.randomUUID(),
    STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
    STRIPE_ACCOUNT_ID: "acct_synthetic",
    STRIPE_PRODUCT_ID: "prod_streamlion",
    STRIPE_PRICE_ID: "price_standard",
    ...(launch ? { STRIPE_LAUNCH_PRICE_ID: "price_launch" } : {}),
  };
  const product = {
    id: "prod_streamlion",
    active: true,
    metadata: { app: "streamlion" },
  };
  const catalog = {
    price_standard: { id: "price_standard", unit_amount: 3995 },
    price_launch: { id: "price_launch", unit_amount: 2996 },
  };
  for (const price of Object.values(catalog))
    Object.assign(price, {
      active: true,
      type: "one_time",
      livemode: false,
      currency: "usd",
      product,
    });
  const sessions = new Map(),
    intents = new Map();
  let creates = 0;
  const response = (value) =>
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(String(input)),
      path = url.pathname;
    assert.equal(
      url.origin,
      "https://api.stripe.com",
      "tests must never reach any real provider",
    );
    if (path === "/v1/account") return response({ id: env.STRIPE_ACCOUNT_ID });
    if (path.startsWith("/v1/prices/"))
      return response(catalog[path.split("/").at(-1)]);
    if (path === "/v1/checkout/sessions" && options.method === "POST") {
      const params = new URLSearchParams(options.body);
      assert.ok(
        params
          .get("custom_text[submit][message]")
          .includes(
            `Request a full refund within ${env.STREAMLION_REFUND_DAYS} days of purchase`,
          ),
      );
      const orderId = params.get("metadata[order_id]");
      const existing = [...sessions.values()].find(
        (s) => s.metadata.order_id === orderId,
      );
      if (existing) return response(existing);
      creates++;
      const price = catalog[params.get("line_items[0][price]")],
        id = `cs_test_${creates}`;
      const session = {
        id,
        livemode: false,
        mode: "payment",
        status: "open",
        payment_status: "unpaid",
        client_reference_id: orderId,
        metadata: { app: "streamlion", order_id: orderId },
        currency: "usd",
        amount_subtotal: price.unit_amount,
        total_details: { amount_discount: 0 },
        line_items: {
          has_more: false,
          data: [{ quantity: 1, price: { id: price.id, product: product.id } }],
        },
        url: "https://checkout.stripe.com/c/pay/" + id,
        payment_intent: null,
      };
      sessions.set(id, session);
      return response(session);
    }
    if (path.startsWith("/v1/checkout/sessions/"))
      return response(sessions.get(path.split("/").at(-1)));
    if (path.startsWith("/v1/payment_intents/"))
      return response(intents.get(path.split("/").at(-1)));
    if (path === "/v1/disputes")
      return response({
        has_more: false,
        data: [{ status: "needs_response" }],
      });
    throw new Error("Unexpected Stripe test request: " + path);
  });
  async function login(subject = "account-a") {
    const cookie = subject.padEnd(43, "_"),
      sessionHash = await hash(cookie);
    sql
      .prepare(
        "INSERT OR REPLACE INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,?,?,?,?)",
      )
      .run(
        sessionHash,
        subject,
        subject + "@example.com",
        "encrypted",
        Date.now() + 86400000,
      );
    return cookie;
  }
  async function request(
    path,
    {
      subject = "account-a",
      cookie,
      method = "GET",
      origin = "https://app.example",
      body,
      headers = {},
    } = {},
  ) {
    return handlePurchase({
      env,
      params: { path: [path] },
      request: new Request("https://app.example/api/purchase/" + path, {
        method,
        headers: {
          Cookie: cookie ? `__Host-streamlion-session=${cookie}` : "",
          Origin: origin,
          "X-StreamLion-Account": subject,
          ...headers,
        },
        body,
      }),
    });
  }
  async function checkout(subject = "account-a") {
    const cookie = await login(subject),
      result = await request("checkout", { method: "POST", cookie, subject });
    assert.equal(result.status, 200, await result.clone().text());
    return {
      cookie,
      order: sql
        .prepare(
          "SELECT * FROM streamlion_purchases_v1 WHERE google_subject=? AND status='pending'",
        )
        .get(subject),
    };
  }
  function paid(order, { refund = 0, dispute = false } = {}) {
    const session = sessions.get(order.checkout_session),
      intent = {
        id: "pi_" + order.order_id.replaceAll("-", ""),
        livemode: false,
        status: "succeeded",
        metadata: { app: "streamlion", order_id: order.order_id },
        latest_charge: {
          id: "ch_1",
          paid: true,
          captured: true,
          currency: "usd",
          amount: order.amount,
          amount_refunded: refund,
          disputed: dispute,
        },
      };
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = intent;
    intents.set(intent.id, intent);
    return session;
  }
  async function event(
    type,
    object,
    {
      id = "evt_" + crypto.randomUUID().replaceAll("-", ""),
      valid = true,
      livemode = false,
    } = {},
  ) {
    const body = JSON.stringify({ id, type, livemode, data: { object } }),
      time = Math.floor(Date.now() / 1000);
    const sig = createHmac(
      "sha256",
      valid ? env.STRIPE_WEBHOOK_SECRET : "wrong",
    )
      .update(`${time}.${body}`)
      .digest("hex");
    return request("webhook", {
      method: "POST",
      body,
      headers: { "Stripe-Signature": `t=${time},v1=${sig}` },
    });
  }
  return {
    sql,
    env,
    sessions,
    catalog,
    login,
    request,
    checkout,
    paid,
    event,
    get creates() {
      return creates;
    },
  };
}
test("the 200-place migration preserves financial state and uniqueness safeguards", () => {
  const sql = new DatabaseSync(":memory:");
  try {
    sql.exec(
      readFileSync(
        new URL(
          "../../migrations/0004_streamlion_purchases.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const insert = sql.prepare(`INSERT INTO streamlion_purchases_v1
      (order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,promo_slot,
       checkout_session,checkout_url,payment_intent,status,amount_refunded,created_at,expires_at,updated_at,revision)
      VALUES(?,'live',?,'owner@example.com','price_old','prod_old',2996,'usd',?,?,?, ?,?,?,11,22,33,4)`);
    for (const [index, status] of [
      "paid",
      "refunded",
      "pending",
      "processing",
      "disputed",
    ].entries())
      insert.run(
        "order" + index,
        "owner" + index,
        index + 1,
        "cs_old" + index,
        "https://checkout.stripe.com/old" + index,
        "pi_old" + index,
        status,
        status === "refunded" ? 2996 : 0,
      );
    sql.exec(
      "INSERT INTO streamlion_stripe_events_v1 VALUES('evt_preserved','live','charge.refunded',44)",
    );
    const before = sql
      .prepare("SELECT * FROM streamlion_purchases_v1 ORDER BY order_id")
      .all();
    sql.exec("BEGIN");
    sql.exec(
      readFileSync(
        new URL(
          "../../migrations/0005_streamlion_launch_200.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    sql.exec("COMMIT");
    assert.deepEqual(
      sql
        .prepare("SELECT * FROM streamlion_purchases_v1 ORDER BY order_id")
        .all(),
      before,
    );
    assert.equal(
      sql.prepare("SELECT event_id FROM streamlion_stripe_events_v1").get()
        .event_id,
      "evt_preserved",
    );
    assert.equal(
      sql.prepare("SELECT version FROM streamlion_purchase_schema_v2").get()
        .version,
      2,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='streamlion_purchases_200_stage'",
        )
        .get(),
      undefined,
    );
    insert.run(
      "last",
      "last-owner",
      200,
      "cs_last",
      "https://checkout.stripe.com/last",
      "pi_last",
      "paid",
      0,
    );
    assert.throws(
      () =>
        insert.run(
          "extra",
          "extra-owner",
          201,
          "cs_extra",
          "url",
          "pi_extra",
          "paid",
          0,
        ),
      /CHECK constraint/,
    );
    assert.throws(
      () =>
        insert.run(
          "same-slot",
          "other-owner",
          200,
          "cs_duplicate",
          "url",
          "pi_duplicate",
          "paid",
          0,
        ),
      /UNIQUE constraint/,
    );
    assert.throws(
      () =>
        insert.run(
          "duplicate-pending",
          "owner2",
          199,
          "cs_pending",
          "url",
          "pi_pending",
          "pending",
          0,
        ),
      /UNIQUE constraint/,
    );
    assert.throws(
      () =>
        insert.run(
          "duplicate-session",
          "session-owner",
          198,
          "cs_old0",
          "url",
          "pi_new",
          "paid",
          0,
        ),
      /UNIQUE constraint/,
    );
    assert.throws(
      () =>
        insert.run(
          "duplicate-intent",
          "intent-owner",
          197,
          "cs_new",
          "url",
          "pi_old0",
          "paid",
          0,
        ),
      /UNIQUE constraint/,
    );
  } finally {
    sql.close();
  }
});
test("quotes report 200 places and seven days; unmigrated checkout fails closed", async (t) => {
  const f = fixture(t);
  const quote = await (await f.request("config")).json();
  assert.equal(quote.launchCapacity, 200);
  assert.equal(quote.launchRemaining, 200);
  assert.equal(quote.refundDays, 7);
  f.sql.exec("DROP TABLE streamlion_purchase_schema_v2");
  assert.equal((await f.request("config")).status, 503);
  const cookie = await f.login();
  assert.equal(
    (await f.request("checkout", { method: "POST", cookie })).status,
    503,
  );
  assert.equal(f.creates, 0);
});
test("disabled checkout leaves existing app available; incomplete or wrong-mode configuration fails closed", async (t) => {
  const f = fixture(t);
  f.env.STREAMLION_REQUIRE_LICENSE = "false";
  f.env.STREAMLION_PAYMENTS_MODE = "disabled";
  assert.deepEqual(await (await f.request("status")).json(), {
    enabled: false,
    required: false,
    purchased: false,
  });
  f.env.STREAMLION_REQUIRE_LICENSE = "true";
  assert.equal((await f.request("status")).status, 503);
  f.env.STREAMLION_REQUIRE_LICENSE = "false";
  f.env.STREAMLION_PAYMENTS_MODE = "test";
  const savedKey = f.env.STRIPE_SECRET_KEY;
  delete f.env.STRIPE_SECRET_KEY;
  assert.equal((await (await f.request("status")).json()).required, false);
  assert.equal((await f.request("config")).status, 503);
  f.env.STRIPE_SECRET_KEY = savedKey;
  f.env.STREAMLION_REQUIRE_LICENSE = "true";
  f.env.STREAMLION_PAYMENTS_MODE = "test";
  f.env.ENABLE_PERSISTENT_GOOGLE = "false";
  assert.equal((await f.request("config")).status, 503);
  assert.equal(f.creates, 0);
  f.env.ENABLE_PERSISTENT_GOOGLE = "true";
  f.env.STREAMLION_PAYMENTS_MODE = "live";
  assert.equal((await f.request("config")).status, 503);
});
test("only an authenticated matching account can create checkout; client price tampering has no effect", async (t) => {
  const f = fixture(t);
  assert.equal((await f.request("checkout", { method: "POST" })).status, 401);
  const cookie = await f.login();
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie,
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie,
        subject: "account-b",
      })
    ).status,
    403,
  );
  const response = await f.request("checkout", {
    method: "POST",
    cookie,
    body: JSON.stringify({ price_id: "price_evil", amount: 1 }),
  });
  assert.equal(response.status, 200);
  assert.equal(
    f.sql.prepare("SELECT amount FROM streamlion_purchases_v1").get().amount,
    2996,
  );
});
test("concurrent repeated checkout clicks create one order and one Stripe session", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      f.request("checkout", { method: "POST", cookie }),
    ),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(f.creates, 1);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_purchases_v1").get().n,
    1,
  );
});
test("success URL cannot grant unpaid access or claim another account purchase", async (t) => {
  const f = fixture(t),
    { order, cookie } = await f.checkout(),
    other = await f.login("account-b");
  const body = JSON.stringify({ sessionId: order.checkout_session });
  assert.equal(
    (
      await f.request("confirm", {
        method: "POST",
        cookie: other,
        subject: "account-b",
        body,
      })
    ).status,
    403,
  );
  const result = await f.request("confirm", { method: "POST", cookie, body });
  assert.equal((await result.json()).purchased, false);
  assert.equal(await hasPurchase(f.env, "account-a"), false);
});
test("signed paid fulfillment survives replay and concurrent duplicate delivery and restores only the buyer", async (t) => {
  const f = fixture(t),
    { order } = await f.checkout(),
    session = f.paid(order);
  assert.equal(
    (await f.event("checkout.session.completed", session, { valid: false }))
      .status,
    400,
  );
  assert.equal(await hasPurchase(f.env, "account-a"), false);
  const id = "evt_replayed";
  const deliveries = await Promise.all([
    f.event("checkout.session.completed", session, { id }),
    f.event("checkout.session.completed", session, { id }),
  ]);
  assert.ok(deliveries.every((r) => r.status === 200));
  assert.equal(await hasPurchase(f.env, "account-a"), true);
  assert.equal(await hasPurchase(f.env, "account-b"), false);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM streamlion_stripe_events_v1").get()
      .n,
    1,
  );
  const newCookie = await f.login();
  assert.equal(
    (await (await f.request("status", { cookie: newCookie })).json()).purchased,
    true,
  );
});
test("a refund arriving before completion remains refunded when stale completion is delivered", async (t) => {
  const f = fixture(t),
    { order } = await f.checkout(),
    session = f.paid(order, { refund: order.amount });
  // No session-completed event has linked the intent yet: find it by trusted metadata.
  const charge = { payment_intent: session.payment_intent.id };
  assert.equal((await f.event("charge.refunded", charge)).status, 200);
  assert.equal(
    (await f.event("checkout.session.completed", session)).status,
    200,
  );
  assert.equal(await hasPurchase(f.env, "account-a"), false);
  assert.equal(
    f.sql.prepare("SELECT status FROM streamlion_purchases_v1").get().status,
    "refunded",
  );
});
test("partial refunds retain access; full refunds and unresolved disputes suspend it", async (t) => {
  const f = fixture(t),
    { order } = await f.checkout(),
    session = f.paid(order, { refund: 100 });
  await f.event("checkout.session.completed", session);
  assert.equal(await hasPurchase(f.env, "account-a"), true);
  session.payment_intent.latest_charge.disputed = true;
  await f.event("charge.dispute.created", {
    payment_intent: session.payment_intent.id,
  });
  assert.equal(await hasPurchase(f.env, "account-a"), false);
});
test("expired and failed delayed payments release their slots; processing payments do not grant access", async (t) => {
  const f = fixture(t),
    { order } = await f.checkout(),
    session = f.sessions.get(order.checkout_session);
  session.status = "complete";
  session.payment_intent = { id: "pi_unpaid", status: "processing" };
  await f.event("checkout.session.completed", session);
  assert.equal(await hasPurchase(f.env, "account-a"), false);
  session.payment_intent.status = "requires_payment_method";
  await f.event("checkout.session.async_payment_failed", session);
  const receipt = f.sql
    .prepare("SELECT status,promo_slot FROM streamlion_purchases_v1")
    .get();
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.promo_slot, null);
});
test("two hundred launch slots cannot be oversold by simultaneous purchasers", async (t) => {
  const f = fixture(t);
  const insert = f.sql
    .prepare(`INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,promo_slot,status,created_at,expires_at,updated_at)
    VALUES(?,'test',?,'x@example.com','price_launch','prod_streamlion',2996,'usd',?,'paid',1,1,1)`);
  for (let n = 1; n < 200; n++) insert.run("old" + n, "old" + n, n);
  const receipts = await Promise.all([
    f.checkout("buyer-a"),
    f.checkout("buyer-b"),
  ]);
  assert.deepEqual(receipts.map((r) => r.order.amount).sort(), [2996, 3995]);
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_purchases_v1 WHERE promo_slot IS NOT NULL",
      )
      .get().n,
    200,
  );
  const quote = await (await f.request("config")).json();
  assert.equal(quote.launchRemaining, 0);
  assert.equal(quote.amount, 3995);
});
test("the Google proxy refuses unpaid accounts while leaving disconnect available", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  Object.assign(f.env, {
    ENABLE_PERSISTENT_GOOGLE: "true",
    VITE_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "synthetic",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
  });
  const route = async (path) =>
    handleGoogle({
      env: f.env,
      params: { path: [path] },
      request: new Request("https://app.example/api/google/" + path, {
        method: "POST",
        headers: {
          Cookie: `__Host-streamlion-session=${cookie}`,
          Origin: "https://app.example",
          "X-StreamLion-Account": "account-a",
        },
        body: "{}",
      }),
    });
  assert.equal((await route("picker-token")).status, 402);
  assert.equal((await route("disconnect")).status, 200);
});
test("wrong product, quantity, discount, or payment environment cannot activate access", async (t) => {
  const f = fixture(t),
    { order } = await f.checkout(),
    session = f.paid(order);
  session.line_items.data[0].quantity = 2;
  assert.equal(
    (await f.event("checkout.session.completed", session)).status,
    503,
  );
  assert.equal(await hasPurchase(f.env, "account-a"), false);
  session.line_items.data[0].quantity = 1;
  assert.equal(
    (await f.event("checkout.session.completed", session, { livemode: true }))
      .status,
    400,
  );
  session.total_details.amount_discount = order.amount;
  assert.equal(
    (await f.event("checkout.session.completed", session)).status,
    503,
  );
});
test("concurrent stale completion read cannot overwrite a refund due to compare-and-swap", async (t) => {
  const f = fixture(t),
    { order } = await f.checkout(),
    session = f.paid(order);
  let release;
  const barrier = new Promise((r) => (release = r));
  let reached;
  const started = new Promise((r) => (reached = r));
  let reads = 0;
  const stripe = {
    checkout: {
      sessions: {
        retrieve: async () => {
          reads++;
          const copy = structuredClone(session);
          if (reads === 1) {
            reached();
            await barrier;
          }
          return copy;
        },
      },
    },
  };
  const old = reconcile(f.env, stripe, order.order_id, order.checkout_session);
  await started;
  session.payment_intent.latest_charge.amount_refunded = order.amount;
  await reconcile(f.env, stripe, order.order_id, order.checkout_session);
  release();
  await old;
  assert.equal(await hasPurchase(f.env, "account-a"), false);
});
