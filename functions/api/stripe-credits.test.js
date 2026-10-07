import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  CREDIT_PACKS,
  handleCredits,
  reconcileCredits,
} from "../../server/stripe-credits.js";
import {
  creditPrice,
  creditAccount,
  reserveCreditTurn,
  finishCreditTurn,
  expireCreditTurns,
} from "../../server/ai-credit-ledger.js";
import { handleAI } from "../../server/ai-pilot.js";
import { hash } from "../../server/google-auth.js";
function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  for (const name of [
    "0001_google_sessions",
    "0002_google_request_limits",
    "0003_google_workspace_folder",
    "0004_streamlion_purchases",
    "0005_streamlion_launch_200",
    "0007_streamlion_ai_pilot",
    "0008_streamlion_ai_credits",
  ])
    sql.exec(
      readFileSync(
        new URL(`../../migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  t.after(() => sql.close());
  const wrap = (q, args = []) => ({
    bind: (...a) => wrap(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
    run: async () => ({
      meta: { changes: sql.prepare(q).run(...args).changes },
    }),
  });
  const db = { prepare: wrap };
  const env = {
    GOOGLE_SESSIONS: db,
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_CLIENT_SECRET: "synthetic",
    VITE_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    STREAMLION_PAYMENTS_MODE: "test",
    STREAMLION_AI_CREDITS_MODE: "test",
    STREAMLION_AI_CREDIT_SALES_ENABLED: "true",
    STREAMLION_REFUND_DAYS: "7",
    STRIPE_SECRET_KEY: "sk_test_synthetic" + crypto.randomUUID(),
    STRIPE_AI_WEBHOOK_SECRET: "whsec_synthetic",
    STRIPE_ACCOUNT_ID: "acct_synthetic",
    STRIPE_AI_PRODUCT_ID: "prod_credits",
    STRIPE_AI_PRICE_10: "price_small",
    STRIPE_AI_PRICE_25: "price_medium",
    STRIPE_AI_PRICE_50: "price_large",
  };
  const product = {
    id: "prod_credits",
    active: true,
    metadata: { app: "streamlion", kind: "ai_credits" },
  };
  const prices = Object.fromEntries(
    CREDIT_PACKS.map((p) => [
      env[p.priceSetting],
      {
        id: env[p.priceSetting],
        active: true,
        type: "one_time",
        currency: "usd",
        livemode: false,
        unit_amount: p.amount,
        product,
      },
    ]),
  );
  const sessions = new Map(),
    intents = new Map();
  let creates = 0,
    dispute = "needs_response";
  const stripe = {
    checkout: { sessions: { retrieve: async (id) => sessions.get(id) } },
    disputes: {
      list: async () => ({ has_more: false, data: [{ status: dispute }] }),
    },
  };
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(String(input));
    assert.equal(
      url.origin,
      "https://api.stripe.com",
      "never reach Google, AI or real networks",
    );
    const path = url.pathname;
    if (path === "/v1/account")
      return Response.json({ id: env.STRIPE_ACCOUNT_ID });
    if (path.startsWith("/v1/prices/"))
      return Response.json(prices[path.split("/").at(-1)]);
    if (path.startsWith("/v1/checkout/sessions/"))
      return Response.json(sessions.get(path.split("/").at(-1)));
    if (path.startsWith("/v1/payment_intents/"))
      return Response.json(intents.get(path.split("/").at(-1)));
    if (path === "/v1/disputes")
      return Response.json({ has_more: false, data: [{ status: dispute }] });
    if (path === "/v1/checkout/sessions" && options.method === "POST") {
      const p = new URLSearchParams(options.body),
        orderId = p.get("metadata[order_id]");
      assert.equal(p.get("mode"), "payment");
      assert.equal(p.get("payment_intent_data[metadata][kind]"), "ai_credits");
      const existing = [...sessions.values()].find(
        (s) => s.metadata.order_id === orderId,
      );
      if (existing) return Response.json(existing);
      const price = prices[p.get("line_items[0][price]")],
        id = "cs_test_" + ++creates;
      const session = {
        id,
        mode: "payment",
        livemode: false,
        status: "open",
        payment_status: "unpaid",
        metadata: { app: "streamlion", kind: "ai_credits", order_id: orderId },
        client_reference_id: orderId,
        currency: "usd",
        amount_subtotal: price.unit_amount,
        amount_total: price.unit_amount,
        total_details: { amount_discount: 0 },
        line_items: {
          has_more: false,
          data: [{ quantity: 1, price: { id: price.id, product: product.id } }],
        },
        url: "https://checkout.stripe.com/c/pay/" + id,
        payment_intent: null,
      };
      sessions.set(id, session);
      return Response.json(session);
    }
    throw new Error("Unexpected mock request " + path);
  });
  async function login(subject = "a") {
    const cookie = subject.padEnd(43, "_");
    sql
      .prepare(
        "INSERT OR REPLACE INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,?,?,?,?)",
      )
      .run(
        await hash(cookie),
        subject,
        subject + "@example.com",
        "encrypted",
        Date.now() + 86400000,
      );
    return cookie;
  }
  function license(subject = "a") {
    sql
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES(?,'test',?,?,'price_app','prod_app',3995,'usd','paid',1,2,1)",
      )
      .run("app-" + subject, subject, subject + "@example.com");
  }
  async function request(
    path,
    {
      subject = "a",
      cookie,
      method = "GET",
      body,
      origin = "https://app.example",
      account = subject,
      headers = {},
    } = {},
  ) {
    return handleCredits({
      env,
      params: { path: [path] },
      request: new Request("https://app.example/api/credits/" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: "__Host-streamlion-session=" + cookie } : {}),
          ...(method === "POST"
            ? { Origin: origin, "X-StreamLion-Account": account }
            : {}),
          ...headers,
        },
        ...(body !== undefined
          ? { body: typeof body === "string" ? body : JSON.stringify(body) }
          : {}),
      }),
    });
  }
  function pay(id) {
    const s = sessions.get(id),
      intent = {
        id: "pi_" + id,
        status: "succeeded",
        livemode: false,
        metadata: s.metadata,
        latest_charge: {
          id: "ch_" + id,
          paid: true,
          captured: true,
          currency: "usd",
          amount: s.amount_total,
          amount_refunded: 0,
          disputed: false,
        },
      };
    s.status = "complete";
    s.payment_status = "paid";
    s.payment_intent = intent;
    intents.set(intent.id, intent);
    return intent;
  }
  function manualOrder(id = "order-a", mode = "test", subject = "a") {
    sql
      .prepare(
        "INSERT INTO streamlion_credit_orders_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,credits_micros,created_at,expires_at,updated_at) VALUES(?,?,?,?, 'price_small','prod_credits',1000,'usd',10000000,1,2,1)",
      )
      .run(id, mode, subject, subject + "@example.com");
    const s = {
      id: "cs_test_" + id,
      mode: "payment",
      livemode: mode === "live",
      status: "open",
      payment_status: "unpaid",
      metadata: { app: "streamlion", kind: "ai_credits", order_id: id },
      client_reference_id: id,
      currency: "usd",
      amount_subtotal: 1000,
      amount_total: 1000,
      total_details: { amount_discount: 0 },
      line_items: {
        has_more: false,
        data: [
          {
            quantity: 1,
            price: { id: "price_small", product: "prod_credits" },
          },
        ],
      },
    };
    sessions.set(s.id, s);
    return s;
  }
  return {
    sql,
    db,
    env,
    prices,
    sessions,
    stripe,
    login,
    license,
    request,
    pay,
    manualOrder,
    creates: () => creates,
    setDispute: (value) => {
      dispute = value;
    },
  };
}
test("30 percent markup uses exact integer ceiling; unknown cost fails closed", () => {
  assert.equal(creditPrice(6000), 7800);
  assert.equal(creditPrice(10001), 13002);
  assert.throws(() => creditPrice(0));
  assert.throws(() => creditPrice(5999));
});
test("new paid-credit policy is closed and zero-budget; pilot remains separate", (t) => {
  const f = fixture(t);
  assert.deepEqual(
    f.sql
      .prepare(
        "SELECT active,cost_micros,daily_budget_micros,total_budget_micros FROM streamlion_credit_policy_v1",
      )
      .all()
      .map((r) => ({ ...r })),
    Array(2).fill({
      active: 0,
      cost_micros: 0,
      daily_budget_micros: 0,
      total_budget_micros: 0,
    }),
  );
  f.sql.exec("INSERT INTO streamlion_ai_wallets_v1 VALUES('a',1,12500)");
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_wallets_v1").get()
      .n,
    0,
  );
});
test("paid grants, replays, refunds after spending, and dispute recovery are atomic", async (t) => {
  const f = fixture(t),
    s = f.manualOrder();
  const intent = f.pay(s.id);
  await Promise.all([
    reconcileCredits(f.env, f.stripe, "order-a", s.id),
    reconcileCredits(f.env, f.stripe, "order-a", s.id),
  ]);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    10000000,
  );
  f.sql.exec(
    "UPDATE streamlion_credit_wallets_v1 SET balance_micros=100000 WHERE mode='test'",
  );
  intent.latest_charge.amount_refunded = 500;
  await reconcileCredits(f.env, f.stripe, "order-a", s.id);
  await reconcileCredits(f.env, f.stripe, "order-a", s.id);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    -4900000,
  );
  intent.latest_charge.disputed = true;
  await reconcileCredits(f.env, f.stripe, "order-a", s.id);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    -9900000,
  );
  f.setDispute("won");
  await reconcileCredits(f.env, f.stripe, "order-a", s.id);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    -4900000,
  );
  intent.latest_charge.amount_refunded = 1000;
  await reconcileCredits(f.env, f.stripe, "order-a", s.id);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    -9900000,
  );
});
test("tampered product, quantity, mode and amount cannot grant any credits", async (t) => {
  const f = fixture(t),
    s = f.manualOrder();
  f.pay(s.id);
  for (const [field, value] of [
    ["amount_subtotal", 999],
    ["livemode", true],
    ["mode", "subscription"],
  ]) {
    const old = s[field];
    s[field] = value;
    await assert.rejects(reconcileCredits(f.env, f.stripe, "order-a", s.id));
    s[field] = old;
  }
  s.line_items.data[0].quantity = 2;
  await assert.rejects(reconcileCredits(f.env, f.stripe, "order-a", s.id));
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_wallets_v1").get()
      .n,
    0,
  );
});
test("test, live and pilot balances never mix; provider reservations and refunds persist", async (t) => {
  const f = fixture(t);
  f.sql.exec(
    "INSERT INTO streamlion_credit_wallets_v1 VALUES('test','a',100000),('live','a',100000); UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=12000,total_budget_micros=12000,daily_requests=2 WHERE mode='live'",
  );
  await reserveCreditTurn(f.db, "live", "a", "one", 7800);
  await assert.rejects(reserveCreditTurn(f.db, "live", "a", "one", 7800));
  await assert.rejects(reserveCreditTurn(f.db, "live", "a", "two", 7800));
  await finishCreditTurn(f.db, "live", "a", "one", "failed");
  await finishCreditTurn(f.db, "live", "a", "one", "failed");
  assert.equal((await creditAccount(f.db, "live", "a")).balance_micros, 100000);
  assert.equal((await creditAccount(f.db, "test", "a")).balance_micros, 100000);
  await reserveCreditTurn(f.db, "live", "a", "two", 7800);
  await finishCreditTurn(f.db, "live", "a", "two", "complete");
  await finishCreditTurn(f.db, "live", "a", "two", "failed");
  assert.equal((await creditAccount(f.db, "live", "a")).balance_micros, 92200);
  await assert.rejects(
    reserveCreditTurn(
      f.db,
      "live",
      "a",
      "tomorrow",
      7800,
      Date.now() + 86400000,
    ),
  );
});
test("paused policy, debt, wrong price, missing wallet and stale reservations fail safely", async (t) => {
  const f = fixture(t);
  f.sql.exec(
    "INSERT INTO streamlion_credit_wallets_v1 VALUES('live','a',100000); UPDATE streamlion_credit_policy_v1 SET cost_micros=6000,daily_budget_micros=6000,total_budget_micros=6000,daily_requests=1 WHERE mode='live'",
  );
  await assert.rejects(reserveCreditTurn(f.db, "live", "a", "one", 7800));
  f.sql.exec("UPDATE streamlion_credit_policy_v1 SET active=1");
  await assert.rejects(reserveCreditTurn(f.db, "live", "a", "one", 12500));
  await assert.rejects(reserveCreditTurn(f.db, "live", "missing", "one", 7800));
  f.sql.exec("UPDATE streamlion_credit_wallets_v1 SET balance_micros=-1");
  await assert.rejects(reserveCreditTurn(f.db, "live", "a", "one", 7800));
  f.sql.exec("UPDATE streamlion_credit_wallets_v1 SET balance_micros=100000");
  const now = Date.now();
  await reserveCreditTurn(f.db, "live", "a", "one", 7800, now);
  await expireCreditTurns(f.db, "live", now + 300001);
  assert.equal((await creditAccount(f.db, "live", "a")).balance_micros, 100000);
  await assert.rejects(
    reserveCreditTurn(f.db, "live", "a", "two", 7800, now + 86400000),
  );
});
test("checkout binds identity, requires app purchase, and reuses pending sessions", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  assert.equal(
    (await f.request("checkout", { method: "POST", body: { packId: "small" } }))
      .status,
    401,
  );
  assert.equal(
    (
      await f.request("checkout", {
        cookie,
        method: "POST",
        account: "b",
        body: { packId: "small" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("checkout", {
        cookie,
        method: "POST",
        origin: "https://evil.example",
        body: { packId: "small" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await (
        await f.request("checkout", {
          cookie,
          method: "POST",
          body: { packId: "small" },
        })
      ).json()
    ).licenseRequired,
    true,
  );
  f.license();
  const a = await (
      await f.request("checkout", {
        cookie,
        method: "POST",
        body: { packId: "small", amount: 1 },
      })
    ).json(),
    b = await (
      await f.request("checkout", {
        cookie,
        method: "POST",
        body: { packId: "small" },
      })
    ).json();
  assert.equal(a.url, b.url);
  assert.equal(f.creates(), 1);
  const session = [...f.sessions.values()][0];
  f.pay(session.id);
  assert.equal(
    (
      await f.request("confirm", {
        cookie: await f.login("b"),
        subject: "b",
        method: "POST",
        body: { sessionId: session.id },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await (
        await f.request("confirm", {
          cookie,
          method: "POST",
          body: { sessionId: session.id },
        })
      ).json()
    ).credited,
    true,
  );
  assert.equal(
    (await (await f.request("status", { cookie })).json()).balanceMicros,
    10000000,
  );
});
test("wrong catalog or mode, closed sales, and unapproved live cost fail closed", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  f.license();
  f.prices.price_small.unit_amount = 1;
  assert.equal((await f.request("config")).status, 503);
  f.prices.price_small.unit_amount = 1000;
  f.env.STREAMLION_AI_CREDIT_SALES_ENABLED = "false";
  assert.equal((await (await f.request("config")).json()).enabled, false);
  assert.equal(
    (
      await f.request("checkout", {
        cookie,
        method: "POST",
        body: { packId: "small" },
      })
    ).status,
    503,
  );
  f.env.STREAMLION_AI_CREDITS_MODE = "live";
  assert.equal((await f.request("config")).status, 503);
  const config = await handleAI({
    env: f.env,
    request: new Request("https://app.example/api/ai/config"),
  });
  assert.equal((await config.json()).enabled, false);
  assert.equal(f.creates(), 0);
});
test("test funds cannot invoke any paid AI provider", async (t) => {
  const f = fixture(t);
  f.env.ENABLE_AI_PILOT = "true";
  f.env.OPENAI_API_KEY = "synthetic";
  f.env.DEEPINFRA_API_KEY = "synthetic";
  const r = await handleAI({
    env: f.env,
    request: new Request("https://app.example/api/ai/answer", {
      method: "POST",
      headers: { Origin: "https://app.example" },
      body: "{}",
    }),
  });
  assert.equal(r.status, 503);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_turns_v1").get().n,
    0,
  );
});
test("signed webhooks grant once, preserve current refunds, and reject unsigned/wrong-mode events", async (t) => {
  const f = fixture(t),
    s = f.manualOrder();
  const intent = f.pay(s.id);
  const deliver = async (event) => {
    const body = JSON.stringify(event),
      now = Math.floor(Date.now() / 1000),
      sig = createHmac("sha256", f.env.STRIPE_AI_WEBHOOK_SECRET)
        .update(now + "." + body)
        .digest("hex");
    return f.request("webhook", {
      method: "POST",
      body,
      headers: { "Stripe-Signature": `t=${now},v1=${sig}` },
    });
  };
  const event = {
    id: "evt_credit",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: s.id, metadata: s.metadata } },
  };
  assert.equal(
    (await f.request("webhook", { method: "POST", body: event })).status,
    400,
  );
  assert.equal((await deliver({ ...event, livemode: true })).status, 400);
  assert.equal((await deliver(event)).status, 200);
  assert.equal((await deliver(event)).status, 200);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    10000000,
  );
  intent.latest_charge.amount_refunded = 1000;
  assert.equal(
    (
      await deliver({
        ...event,
        id: "evt_refund",
        type: "charge.refunded",
        data: { object: { payment_intent: intent.id } },
      })
    ).status,
    200,
  );
  assert.equal(
    (await deliver({ ...event, id: "evt_old_completion" })).status,
    200,
  );
  assert.equal((await creditAccount(f.db, "test", "a")).balance_micros, 0);
});
