import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import {
  CREDIT_PACKS,
  featurePrices,
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
import { reserveProject, finishProject } from "../../server/shared-credits.js";
function fixture(t, { tax = false } = {}) {
  const sql = new DatabaseSync(":memory:");
  for (const name of [
    "0001_google_sessions",
    "0002_google_request_limits",
    "0003_google_workspace_folder",
    "0004_streamlion_purchases",
    "0005_streamlion_launch_200",
    "0007_streamlion_ai_pilot",
    "0008_streamlion_ai_credits",
    "0017_streamlion_saved_cards",
    ...(tax ? ["0019_checkout_tax"] : []),
    "0020_checkout_business",
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
    ...(tax
      ? {
          STREAMLION_CHECKOUT_TAX_MODE: "stripe",
          STREAMLION_CREDIT_TAX_TREATMENT: "tax_on_purchase",
        }
      : {}),
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
    ...(tax ? { tax_code: "txcd_10103101" } : {}),
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
        ...(tax ? { tax_behavior: "exclusive" } : {}),
      },
    ]),
  );
  const sessions = new Map(),
    intents = new Map(),
    created = [],
    customers = new Map(),
    topups = [],
    detached = [],
    lists = [];
  // Saved-card top-ups: "succeed", "authenticate", "decline", "missing" or "lost".
  const card = { next: "succeed" };
  let creates = 0,
    dispute = "needs_response";
  const key = (options) => new Headers(options.headers).get("Idempotency-Key");
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
    if (path === "/v1/payment_intents/search")
      throw new Error("Search is eventually consistent; never use it here");
    if (path === "/v1/payment_intents" && (options.method || "GET") === "GET") {
      const customer = url.searchParams.get("customer");
      lists.push(customer);
      return Response.json({
        object: "list",
        has_more: false,
        data: [...intents.values()].filter(
          (intent) => intent.customer === customer,
        ),
      });
    }
    if (path.startsWith("/v1/payment_intents/"))
      return Response.json(intents.get(path.split("/").at(-1)));
    if (path === "/v1/disputes")
      return Response.json({ has_more: false, data: [{ status: dispute }] });
    if (path === "/v1/customers" && options.method === "POST") {
      const p = new URLSearchParams(options.body);
      if (!customers.has(key(options)))
        customers.set(key(options), {
          id: "cus_" + (customers.size + 1),
          livemode: false,
          email: p.get("email"),
          metadata: { app: p.get("metadata[app]") },
        });
      return Response.json(customers.get(key(options)));
    }
    if (path.endsWith("/detach") && options.method === "POST") {
      const id = path.split("/").at(-2);
      detached.push(id);
      for (const intent of intents.values())
        if (intent.payment_method?.id === id)
          intent.payment_method.customer = null;
      return Response.json({ id, customer: null });
    }
    if (path === "/v1/payment_intents" && options.method === "POST") {
      const p = new URLSearchParams(options.body);
      const existing = topups.find((t) => t.key === key(options));
      if (existing) {
        // A lost response stays lost until the network recovers.
        if (card.next === "lost") throw new TypeError("network lost");
        return existing.response.clone();
      }
      const id = "pi_topup_" + (topups.length + 1),
        amount = Number(p.get("amount"));
      const failed = ["authenticate", "decline"].includes(card.next);
      const intent = {
        id,
        object: "payment_intent",
        livemode: false,
        amount,
        currency: p.get("currency"),
        customer: p.get("customer"),
        payment_method: p.get("payment_method"),
        status: failed ? "requires_payment_method" : "succeeded",
        metadata: Object.fromEntries(
          [...p]
            .filter(([k]) => k.startsWith("metadata["))
            .map(([k, v]) => [k.slice(9, -1), v]),
        ),
        ...(failed
          ? {
              last_payment_error: {
                code:
                  card.next === "authenticate"
                    ? "authentication_required"
                    : "card_declined",
              },
            }
          : {}),
        latest_charge: failed
          ? null
          : {
              id: "ch_" + id,
              paid: true,
              captured: true,
              currency: "usd",
              amount,
              amount_refunded: 0,
              disputed: false,
            },
      };
      const record = { key: key(options), params: p, intent };
      topups.push(record);
      if (card.next === "missing")
        record.response = Response.json(
          {
            error: {
              type: "invalid_request_error",
              code: "resource_missing",
              param: "payment_method",
              message: "No such PaymentMethod",
            },
          },
          { status: 400 },
        );
      else {
        intents.set(id, intent);
        record.response = failed
          ? Response.json(
              {
                error: {
                  type: "card_error",
                  code: intent.last_payment_error.code,
                  message: "Card not charged",
                  payment_intent: { ...intent, latest_charge: null },
                },
              },
              { status: 402 },
            )
          : Response.json({ ...intent, latest_charge: "ch_" + id });
        if (card.next === "lost") throw new TypeError("network lost");
      }
      return record.response.clone();
    }
    if (path === "/v1/checkout/sessions" && options.method === "POST") {
      const p = new URLSearchParams(options.body),
        orderId = p.get("metadata[order_id]");
      created.push(p);
      card.onSession?.(orderId);
      assert.equal(p.get("mode"), "payment");
      assert.equal(p.get("payment_intent_data[metadata][kind]"), "ai_credits");
      const existing = [...sessions.values()].find(
        (s) => s.metadata.order_id === orderId,
      );
      if (existing) return Response.json(existing);
      const price = prices[p.get("line_items[0][price]")],
        id = `cs_${price.livemode ? "live" : "test"}_` + ++creates;
      const session = {
        id,
        mode: "payment",
        livemode: price.livemode,
        status: "open",
        payment_status: "unpaid",
        metadata: {
          app: "streamlion",
          kind: "ai_credits",
          order_id: orderId,
          ...(p.get("metadata[save_card]") ? { save_card: "1" } : {}),
        },
        customer: p.get("customer"),
        custom_fields: p.has("custom_fields[0][key]")
          ? [
              {
                key: "business_name",
                text: { value: "Synthetic Provider LLC" },
              },
            ]
          : [],
        consent: { terms_of_service: "accepted" },
        client_reference_id: orderId,
        currency: "usd",
        amount_subtotal: price.unit_amount,
        amount_total: price.unit_amount + (tax ? 200 : 0),
        total_details: {
          amount_discount: 0,
          ...(tax ? { amount_tax: 200 } : {}),
        },
        ...(tax
          ? { automatic_tax: { enabled: true, status: "complete" } }
          : {}),
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
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES(?,?,?,?,'price_app','prod_app',3995,'usd','paid',1,2,1)",
      )
      .run(
        "app-" + subject,
        env.STREAMLION_PAYMENTS_MODE,
        subject,
        subject + "@example.com",
      );
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
    if (
      path === "checkout" &&
      body &&
      typeof body === "object" &&
      !(body instanceof Uint8Array)
    )
      body = { businessUse: true, ...body };
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
          ? {
              body:
                typeof body === "string" || body instanceof Uint8Array
                  ? body
                  : JSON.stringify(body),
            }
          : {}),
      }),
    });
  }
  function pay(id) {
    const s = sessions.get(id),
      intent = {
        id: "pi_" + id,
        status: "succeeded",
        livemode: s.livemode,
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
    if (s.metadata.save_card)
      intent.payment_method = {
        id: "pm_card_" + id.slice(-6),
        type: "card",
        customer: s.customer,
        card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
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
    intents,
    created,
    customers,
    topups,
    detached,
    lists,
    card,
    creates: () => creates,
    setDispute: (value) => {
      dispute = value;
    },
  };
}
function coordinationTopups(f, mode = "live") {
  for (const name of [
    "0009_client_coordination",
    "0010_coordination_notifications",
    "0011_coordination_efficiency",
  ])
    f.sql.exec(
      readFileSync(
        new URL(`../../migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  Object.assign(f.env, {
    STREAMLION_PAYMENTS_MODE: mode,
    STREAMLION_AI_CREDITS_MODE: mode,
    STREAMLION_LIVE_PAYMENTS_APPROVED: "true",
    STREAMLION_CHECKOUT_MODE: "open",
    STREAMLION_COORDINATION_CREDIT_SALES_ENABLED: "true",
    STREAMLION_AI_CREDIT_SALES_ENABLED: "false",
    STREAMLION_AI_COST_APPROVED: "false",
    ENABLE_CLIENT_COORDINATION: "true",
    STRIPE_SECRET_KEY: `sk_${mode}_synthetic` + crypto.randomUUID(),
  });
  for (const price of Object.values(f.prices)) price.livemode = mode === "live";
  f.sql
    .prepare(
      "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode=?",
    )
    .run(mode);
}
async function signedCreditEvent(f, event) {
  const body = JSON.stringify(event),
    timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", f.env.STRIPE_AI_WEBHOOK_SECRET)
    .update(timestamp + "." + body)
    .digest("hex");
  return f.request("webhook", {
    method: "POST",
    body,
    headers: { "Stripe-Signature": `t=${timestamp},v1=${signature}` },
  });
}
test("live coordination top-ups fund projects with AI off and retain refund/replay recovery", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  coordinationTopups(f);
  f.license();
  const policies = f.sql
    .prepare("SELECT * FROM streamlion_credit_policy_v1")
    .all();
  assert.equal((await (await f.request("config")).json()).enabled, true);
  const started = await f.request("checkout", {
    method: "POST",
    cookie,
    body: { packId: "small" },
  });
  assert.equal(started.status, 200);
  const session = [...f.sessions.values()][0],
    intent = f.pay(session.id);
  // Closing both sales paths must still permit confirmation and reconciliation.
  f.env.STREAMLION_COORDINATION_CREDIT_SALES_ENABLED = "false";
  f.env.STREAMLION_CHECKOUT_MODE = "paused";
  assert.equal(
    (
      await f.request("confirm", {
        method: "POST",
        cookie,
        body: { sessionId: session.id },
      })
    ).status,
    200,
  );
  const completion = {
    id: "evt_coordination_paid",
    type: "checkout.session.completed",
    livemode: true,
    data: { object: session },
  };
  assert.equal((await signedCreditEvent(f, completion)).status, 200);
  assert.equal((await signedCreditEvent(f, completion)).status, 200);
  assert.equal(
    (await creditAccount(f.db, "live", "a")).balance_micros,
    10000000,
  );
  const fundedAI = await handleAI({
    env: f.env,
    request: new Request("https://app.example/api/ai/answer", {
      method: "POST",
      headers: {
        Origin: f.env.GOOGLE_AUTH_ORIGIN,
        Cookie: "__Host-streamlion-session=" + cookie,
      },
      body: "{}",
    }),
  });
  assert.equal(fundedAI.status, 503);
  assert.equal((await creditAccount(f.db, "test", "a")).balance_micros, 0);
  assert.equal((await creditAccount(f.db, "live", "b")).balance_micros, 0);
  await reserveProject(f.db, "live", "a", "qa-job", Date.now());
  await finishProject(f.db, "live", "a", "qa-job", "complete");
  await reserveProject(f.db, "live", "a", "qa-job", Date.now());
  assert.equal(
    (await creditAccount(f.db, "live", "a")).balance_micros,
    7000000,
  );
  intent.latest_charge.amount_refunded = 100;
  const refund = {
    id: "evt_coordination_partial_refund",
    type: "charge.refunded",
    livemode: true,
    data: { object: { payment_intent: intent.id } },
  };
  assert.equal((await signedCreditEvent(f, refund)).status, 200);
  assert.equal(
    (await creditAccount(f.db, "live", "a")).balance_micros,
    6000000,
  );
  intent.latest_charge.amount_refunded = 1000;
  assert.equal(
    (
      await signedCreditEvent(f, {
        ...refund,
        id: "evt_coordination_full_refund",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await signedCreditEvent(f, {
        ...completion,
        id: "evt_coordination_old_completion",
      })
    ).status,
    200,
  );
  assert.equal(
    (await creditAccount(f.db, "live", "a")).balance_micros,
    -3000000,
  );
  assert.equal(
    (await (await f.request("status", { cookie })).json()).creditHold,
    true,
  );
  await assert.rejects(
    reserveProject(f.db, "live", "a", "another-job", Date.now()),
  );
  const ai = await handleAI({
    env: f.env,
    request: new Request("https://app.example/api/ai/answer", {
      method: "POST",
      body: "{}",
    }),
  });
  assert.equal(ai.status, 503);
  assert.deepEqual(
    f.sql.prepare("SELECT * FROM streamlion_credit_policy_v1").all(),
    policies,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_turns_v1").get().n,
    0,
  );
  assert.equal(f.creates(), 1);
});
test("coordination sales never enable AI or bypass its cost, policy, key and budget checks", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  coordinationTopups(f);
  f.license();
  f.env.ENABLE_AI_PILOT = "true";
  f.env.OPENAI_API_KEY = "synthetic";
  f.env.DEEPINFRA_API_KEY = "synthetic";
  const ai = () =>
    handleAI({
      env: f.env,
      request: new Request("https://app.example/api/ai/config", {
        headers: { Cookie: "__Host-streamlion-session=" + cookie },
      }),
    });
  assert.equal((await (await ai()).json()).enabled, false);
  f.env.STREAMLION_AI_COST_APPROVED = "true";
  assert.equal((await (await ai()).json()).enabled, false); // Inactive, zero-budget policy.
  f.sql.exec(
    "UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=0,total_budget_micros=0,daily_requests=1 WHERE mode='live'",
  );
  assert.equal((await (await ai()).json()).enabled, false);
  delete f.env.OPENAI_API_KEY;
  assert.equal((await (await ai()).json()).enabled, false);
  assert.equal((await (await f.request("config")).json()).enabled, true);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_turns_v1").get().n,
    0,
  );
});
test("the existing AI top-up path still requires its independent approvals and available budget", async (t) => {
  const f = fixture(t);
  coordinationTopups(f);
  f.env.STREAMLION_COORDINATION_CREDIT_SALES_ENABLED = "false";
  f.env.STREAMLION_AI_CREDIT_SALES_ENABLED = "true";
  f.env.ENABLE_AI_PILOT = "true";
  f.env.OPENAI_API_KEY = "synthetic";
  f.env.DEEPINFRA_API_KEY = "synthetic";
  f.sql.exec(
    "UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=6000,total_budget_micros=6000,daily_requests=1 WHERE mode='live'",
  );
  assert.equal((await (await f.request("config")).json()).enabled, false);
  f.env.STREAMLION_AI_COST_APPROVED = "true";
  assert.equal((await (await f.request("config")).json()).enabled, true);
  f.sql.exec(
    "UPDATE streamlion_credit_policy_v1 SET daily_budget_micros=0 WHERE mode='live'",
  );
  assert.equal((await (await f.request("config")).json()).enabled, false);
});
test("coordination top-ups fail closed for missing approval, mode, service or schema readiness", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  coordinationTopups(f);
  f.license();
  for (const [key, blocked] of [
    ["STREAMLION_COORDINATION_CREDIT_SALES_ENABLED", undefined],
    ["STREAMLION_COORDINATION_CREDIT_SALES_ENABLED", "false"],
    ["STREAMLION_COORDINATION_CREDIT_SALES_ENABLED", "TRUE"],
    ["ENABLE_CLIENT_COORDINATION", "false"],
    ["ENABLE_PERSISTENT_GOOGLE", "false"],
    ["STREAMLION_LIVE_PAYMENTS_APPROVED", "false"],
    ["STREAMLION_AI_CREDITS_MODE", "test"],
  ]) {
    const before = f.env[key];
    f.env[key] = blocked;
    const config = await f.request("config");
    assert(
      config.status === 503 || (await config.json()).enabled === false,
      key,
    );
    assert.equal(
      (
        await f.request("checkout", {
          method: "POST",
          cookie,
          body: { packId: "small" },
        })
      ).status,
      503,
      key,
    );
    f.env[key] = before;
  }
  f.sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=CASE mode WHEN 'test' THEN 1 ELSE 0 END",
  );
  assert.equal((await (await f.request("config")).json()).enabled, false);
  f.sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='live'; DELETE FROM streamlion_coordination_notifications_schema_v1",
  );
  assert.equal((await (await f.request("config")).json()).enabled, false);
  f.sql.exec(
    "INSERT INTO streamlion_coordination_notifications_schema_v1 VALUES(1)",
  );
  f.sql.exec("DELETE FROM streamlion_credit_policy_v1 WHERE mode='live'");
  assert.equal((await f.request("config")).status, 503);
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie,
        body: { packId: "small" },
      })
    ).status,
    503,
  );
  assert.equal(f.creates(), 0);
});
test("coordination-only sales retain owner QA, account, license and pending-checkout gates", async (t) => {
  const f = fixture(t),
    owner = await f.login(),
    other = await f.login("b");
  coordinationTopups(f);
  f.license();
  f.env.STREAMLION_CHECKOUT_MODE = "owner_qa";
  f.env.STREAMLION_CHECKOUT_QA_SUBJECTS = '["a"]';
  assert.equal((await (await f.request("config")).json()).enabled, false);
  assert.equal(
    (await (await f.request("config", { cookie: owner })).json()).enabled,
    true,
  );
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie: other,
        subject: "b",
        account: "a",
        body: { packId: "small" },
      })
    ).status,
    403,
  );
  f.env.STREAMLION_CHECKOUT_QA_SUBJECTS = '["a","b"]';
  assert.equal(
    (
      await (
        await f.request("checkout", {
          method: "POST",
          cookie: other,
          subject: "b",
          body: { packId: "small" },
        })
      ).json()
    ).licenseRequired,
    true,
  );
  const first = await (
    await f.request("checkout", {
      method: "POST",
      cookie: owner,
      body: { packId: "small" },
    })
  ).json();
  const retry = await (
    await f.request("checkout", {
      method: "POST",
      cookie: owner,
      body: { packId: "small" },
    })
  ).json();
  assert.equal(first.url, retry.url);
  f.env.STREAMLION_COORDINATION_CREDIT_SALES_ENABLED = "false";
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie: owner,
        body: { packId: "small" },
      })
    ).status,
    503,
  );
  f.env.STREAMLION_COORDINATION_CREDIT_SALES_ENABLED = "true";
  f.env.STREAMLION_CHECKOUT_MODE = "paused";
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie: owner,
        body: { packId: "small" },
      })
    ).status,
    403,
  );
  assert.equal(f.creates(), 1);
});
test("30 percent markup uses exact integer ceiling; unknown cost fails closed", () => {
  assert.equal(creditPrice(6000), 7800);
  assert.equal(creditPrice(10001), 13002);
  assert.throws(() => creditPrice(0));
  assert.throws(() => creditPrice(5999));
});
test("checkout pause blocks credit sessions and pending URL reuse without changing balances", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  f.license();
  const first = await f.request("checkout", {
    method: "POST",
    cookie,
    body: { packId: "small" },
  });
  assert.equal(first.status, 200);
  f.env.STREAMLION_CHECKOUT_MODE = "paused";
  assert.equal(
    (await (await f.request("config", { cookie })).json()).enabled,
    false,
  );
  const before = f.sql
    .prepare("SELECT * FROM streamlion_credit_orders_v1")
    .all();
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Paused checkout must not contact Stripe");
  });
  const paused = await f.request("checkout", {
    method: "POST",
    cookie,
    body: { packId: "small" },
  });
  assert.equal(paused.status, 403);
  assert.equal((await paused.json()).url, undefined);
  assert.deepEqual(
    f.sql.prepare("SELECT * FROM streamlion_credit_orders_v1").all(),
    before,
  );
  assert.equal((await creditAccount(f.db, "test", "a")).balance_micros, 0);
  assert.equal(f.creates(), 1);
});
test("credit owner QA cannot be impersonated and never overrides independent sales readiness", async (t) => {
  const f = fixture(t),
    owner = await f.login(),
    other = await f.login("b");
  f.license();
  f.license("b");
  f.env.STREAMLION_CHECKOUT_MODE = "owner_qa";
  f.env.STREAMLION_CHECKOUT_QA_SUBJECTS = '["a"]';
  assert.equal((await (await f.request("config")).json()).enabled, false);
  assert.equal(
    (await (await f.request("config", { cookie: owner })).json()).enabled,
    true,
  );
  for (const account of ["a", "b"])
    assert.equal(
      (
        await f.request("checkout", {
          method: "POST",
          cookie: other,
          subject: "b",
          account,
          body: { packId: "small", subject: "a" },
        })
      ).status,
      403,
    );
  f.env.STREAMLION_AI_CREDIT_SALES_ENABLED = "false";
  assert.equal(
    (await (await f.request("config", { cookie: owner })).json()).enabled,
    false,
  );
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie: owner,
        body: { packId: "small" },
      })
    ).status,
    503,
  );
  assert.equal(f.creates(), 0);
  f.env.STREAMLION_AI_CREDIT_SALES_ENABLED = "true";
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie: owner,
        body: { packId: "small" },
      })
    ).status,
    200,
  );
});
test("credit endpoints reject oversized and malformed UTF-8 bodies with client status codes", async (t) => {
  const f = fixture(t),
    cookie = await f.login();
  for (const path of ["checkout", "confirm", "webhook"]) {
    const maximum = path === "webhook" ? 256 * 1024 : 2048;
    const headers =
      path === "webhook" ? { "Stripe-Signature": "synthetic" } : {};
    for (const [body, status] of [
      ["x".repeat(maximum + 1), 413],
      [new Uint8Array([0xc3, 0x28]), 400],
    ]) {
      const response = await f.request(path, {
        method: "POST",
        cookie,
        headers,
        body,
      });
      assert.equal(response.status, status, path);
      assert.match(response.headers.get("Cache-Control"), /no-store/);
    }
  }
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_orders_v1").get().n,
    0,
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_events_v1").get().n,
    0,
  );
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
  f.env.STREAMLION_CHECKOUT_MODE = "paused";
  f.env.STREAMLION_CHECKOUT_QA_SUBJECTS = "malformed";
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
  intent.latest_charge.disputed = true;
  assert.equal(
    (
      await deliver({
        ...event,
        id: "evt_dispute",
        type: "charge.dispute.created",
        data: { object: { payment_intent: intent.id } },
      })
    ).status,
    200,
  );
  assert.equal((await creditAccount(f.db, "test", "a")).balance_micros, 0);
  f.setDispute("won");
  assert.equal(
    (
      await deliver({
        ...event,
        id: "evt_dispute_won",
        type: "charge.dispute.closed",
        data: { object: { payment_intent: intent.id } },
      })
    ).status,
    200,
  );
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

test("public credit config uses only the active coordination policy in the current mode", async (t) => {
  const f = fixture(t);
  assert.equal((await (await f.request("config")).json()).projectMicros, null);
  f.sql.exec(
    "CREATE TABLE streamlion_coordination_policy_v1(mode TEXT PRIMARY KEY, active INTEGER, project_micros INTEGER)",
  );
  f.sql.exec(
    "INSERT INTO streamlion_coordination_policy_v1 VALUES('test',1,2000000),('live',1,3000000)",
  );
  assert.equal(
    (await (await f.request("config")).json()).projectMicros,
    2000000,
  );
  f.sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET project_micros=3000000 WHERE mode='test'",
  );
  assert.equal(
    (await (await f.request("config")).json()).projectMicros,
    3000000,
  );
  f.sql.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=0 WHERE mode='test'",
  );
  assert.equal((await (await f.request("config")).json()).projectMicros, null);
});

test("public credit config prices the brief and AI options only while they are open", async (t) => {
  const f = fixture(t);
  const config = await (await f.request("config")).json();
  assert.equal(config.briefMicros, null);
  assert.equal(config.aiMicros, null);
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const name of ["0008_streamlion_ai_credits", "0016_brief_import"])
    sql.exec(
      readFileSync(
        new URL(`../../migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  const wrap = (q, args = []) => ({
    bind: (...a) => wrap(q, a),
    first: async () => sql.prepare(q).get(...args) || null,
  });
  const live = {
    GOOGLE_SESSIONS: { prepare: wrap },
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    STREAMLION_PAYMENTS_MODE: "live",
    STREAMLION_LIVE_PAYMENTS_APPROVED: "true",
    STREAMLION_AI_CREDITS_MODE: "live",
    STREAMLION_AI_COST_APPROVED: "true",
    ENABLE_AI_PILOT: "true",
    ENABLE_BRIEF_IMPORT: "true",
    STREAMLION_BRIEF_IMPORT_COST_APPROVED: "true",
    OPENAI_API_KEY: "synthetic",
    DEEPINFRA_API_KEY: "synthetic",
  };
  // Inactive policies advertise nothing, even with every flag approved.
  assert.deepEqual(await featurePrices(live, "live"), {
    briefMicros: null,
    aiMicros: null,
  });
  sql.exec(
    "UPDATE streamlion_brief_policy_v1 SET active=1,price_micros=100000,reserve_micros=100000 WHERE mode='live'; UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=9600 WHERE mode='live'",
  );
  assert.deepEqual(await featurePrices(live, "live"), {
    briefMicros: 100000,
    aiMicros: 12480,
  });
  // Closing either feature hides only its price.
  assert.deepEqual(
    await featurePrices({ ...live, ENABLE_BRIEF_IMPORT: "false" }, "live"),
    { briefMicros: null, aiMicros: 12480 },
  );
  assert.deepEqual(
    await featurePrices({ ...live, ENABLE_AI_PILOT: "false" }, "live"),
    { briefMicros: 100000, aiMicros: null },
  );
});

// Saved cards for one-tap top-ups.
async function savedCardFixture(t) {
  const f = fixture(t),
    cookie = await f.login();
  f.license();
  f.env.STREAMLION_SAVED_CARDS_ENABLED = "true";
  const post = async (path, body, options = {}) => {
    const response = await f.request(path, {
      method: "POST",
      cookie,
      body,
      ...options,
    });
    // The HTTP status replaces any "status" field in the reply.
    return { ...(await response.json()), status: response.status };
  };
  async function saveCard() {
    const started = await post("checkout", { packId: "small", saveCard: true });
    assert.match(started.url, /^https:\/\/checkout\.stripe\.com\//);
    const session = [...f.sessions.values()].at(-1);
    f.pay(session.id);
    assert.equal(
      (await post("confirm", { sessionId: session.id })).status,
      200,
    );
    return session;
  }
  const status = async () => (await f.request("status", { cookie })).json();
  return { ...f, cookie, post, saveCard, status };
}
test("saved cards stay closed until enabled, and a plain checkout never saves a card", async (t) => {
  const f = await savedCardFixture(t);
  f.env.STREAMLION_SAVED_CARDS_ENABLED = "false";
  assert.equal((await (await f.request("config")).json()).savedCards, false);
  // Asking to save while closed starts an ordinary checkout.
  await f.post("checkout", { packId: "small", saveCard: true });
  const params = f.created.at(-1);
  assert.equal(params.get("customer"), null);
  assert.equal(params.get("customer_email"), "a@example.com");
  assert.equal(params.get("payment_intent_data[setup_future_usage]"), null);
  assert.equal(f.customers.size, 0);
  assert.equal((await f.post("topup", { packId: "small" })).status, 400);
  assert.equal((await f.status()).card, null);
  f.env.STREAMLION_SAVED_CARDS_ENABLED = "true";
  assert.equal((await (await f.request("config")).json()).savedCards, true);
});

test("a saving checkout keeps the card, and one tap charges it once for the chosen pack", async (t) => {
  const f = await savedCardFixture(t);
  const session = await f.saveCard();
  const params = f.created.at(-1);
  assert.equal(params.get("customer"), "cus_1");
  assert.equal(params.get("customer_email"), null);
  assert.equal(
    params.get("payment_intent_data[setup_future_usage]"),
    "on_session",
  );
  assert.equal(params.get("metadata[save_card]"), "1");
  assert.match(
    params.get("custom_text[submit][message]"),
    /saved for top-ups you start yourself/,
  );
  assert.deepEqual((await f.status()).card, {
    brand: "visa",
    last4: "4242",
    expMonth: 12,
    expYear: 2030,
  });
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    10000000,
  );

  const charged = await f.post("topup", { packId: "medium" });
  assert.deepEqual(charged, { status: 200, credited: true });
  const [topup] = f.topups;
  assert.equal(topup.params.get("amount"), "2500");
  assert.equal(topup.params.get("customer"), "cus_1");
  assert.equal(
    topup.params.get("payment_method"),
    session.payment_intent.payment_method.id,
  );
  assert.equal(topup.params.get("confirm"), "true");
  assert.equal(topup.params.get("error_on_requires_action"), "true");
  assert.equal(topup.params.get("off_session"), null);
  assert.equal(topup.params.get("metadata[source]"), "saved_card");
  assert.match(topup.key, /^streamlion-topup:test:/);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    35000000,
  );

  // Signed replays and a partial refund of the top-up settle against the same order.
  const intent = f.intents.get(topup.intent.id);
  const succeeded = {
    id: "evt_topup_paid",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: { id: intent.id } },
  };
  assert.equal((await signedCreditEvent(f, succeeded)).status, 200);
  assert.equal(
    (await signedCreditEvent(f, { ...succeeded, id: "evt_topup_paid_2" }))
      .status,
    200,
  );
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    35000000,
  );
  intent.latest_charge.amount_refunded = 1250;
  const refund = {
    id: "evt_topup_refund",
    type: "charge.refunded",
    livemode: false,
    data: { object: { payment_intent: intent.id } },
  };
  assert.equal((await signedCreditEvent(f, refund)).status, 200);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    22500000,
  );
  // A second tap is a new, separate top-up.
  assert.equal((await f.post("topup", { packId: "small" })).credited, true);
  assert.equal(f.topups.length, 2);
  assert.notEqual(f.topups[1].key, f.topups[0].key);
});

test("a bank check or a decline charges nothing and leaves Checkout open", async (t) => {
  const f = await savedCardFixture(t);
  await f.saveCard();
  f.card.next = "authenticate";
  assert.deepEqual(await f.post("topup", { packId: "small" }), {
    status: 200,
    authenticationRequired: true,
  });
  f.card.next = "decline";
  assert.deepEqual(await f.post("topup", { packId: "small" }), {
    status: 200,
    declined: true,
  });
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    10000000,
  );
  const failed = f.sql
    .prepare(
      "SELECT o.status FROM streamlion_credit_orders_v1 o JOIN streamlion_credit_topups_v1 t USING(order_id)",
    )
    .all();
  assert.deepEqual(
    failed.map((row) => row.status),
    ["failed", "failed"],
  );
  // The same pack can still be bought through Checkout.
  const checkout = await f.post("checkout", { packId: "small" });
  assert.match(checkout.url, /^https:\/\/checkout\.stripe\.com\//);
  // A card Stripe can no longer use is forgotten without a charge.
  const fresh = await savedCardFixture(t);
  await fresh.saveCard();
  fresh.card.next = "missing";
  assert.deepEqual(await fresh.post("topup", { packId: "small" }), {
    status: 200,
    cardRequired: true,
  });
  assert.equal((await fresh.status()).card, null);
});

test("a lost top-up response blocks a second charge until Stripe settles the first", async (t) => {
  const f = await savedCardFixture(t);
  await f.saveCard();
  f.card.next = "lost";
  assert.equal((await f.post("topup", { packId: "medium" })).status, 503);
  assert.equal(f.topups.length, 1);
  // Neither another top-up nor Checkout can start while the outcome is unknown.
  assert.equal(
    (await f.post("topup", { packId: "small" })).pendingAmount,
    2500,
  );
  assert.equal(
    (await f.post("checkout", { packId: "small" })).pendingAmount,
    2500,
  );
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    10000000,
  );
  // Retrying the same pack reuses the same idempotency key and gets the result.
  f.card.next = "succeed";
  assert.equal((await f.post("topup", { packId: "medium" })).credited, true);
  assert.equal(f.topups.length, 1);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    35000000,
  );
});

test("a webhook settles a top-up whose response never arrived", async (t) => {
  const f = await savedCardFixture(t);
  await f.saveCard();
  f.card.next = "lost";
  assert.equal((await f.post("topup", { packId: "medium" })).status, 503);
  const [topup] = f.topups;
  assert.equal(
    (
      await signedCreditEvent(f, {
        id: "evt_lost_paid",
        type: "payment_intent.succeeded",
        livemode: false,
        data: { object: { id: topup.intent.id } },
      })
    ).status,
    200,
  );
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    35000000,
  );
  f.card.next = "succeed";
  assert.equal((await f.post("topup", { packId: "small" })).credited, true);
});

test("removing a card detaches it, works while sales are closed, and stays removed after replays", async (t) => {
  const f = await savedCardFixture(t);
  const session = await f.saveCard();
  const method = session.payment_intent.payment_method.id;
  f.env.STREAMLION_AI_CREDIT_SALES_ENABLED = "false";
  f.env.STREAMLION_SAVED_CARDS_ENABLED = "false";
  assert.deepEqual(await f.post("card", { action: "remove" }), {
    status: 200,
    removed: true,
  });
  assert.deepEqual(f.detached, [method]);
  assert.equal((await f.status()).card, null);
  assert.equal((await f.post("card", { action: "keep" })).status, 400);
  // The saving checkout's completion arriving late does not bring it back.
  assert.equal(
    (
      await signedCreditEvent(f, {
        id: "evt_late_completion",
        type: "checkout.session.completed",
        livemode: false,
        data: { object: session },
      })
    ).status,
    200,
  );
  assert.equal((await f.status()).card, null);
  f.env.STREAMLION_AI_CREDIT_SALES_ENABLED = "true";
  f.env.STREAMLION_SAVED_CARDS_ENABLED = "true";
  assert.deepEqual(await f.post("topup", { packId: "small" }), {
    status: 200,
    cardRequired: true,
  });
  assert.equal(f.topups.length, 0);
});

test("a saved card belongs to one account and mode, and checkout pauses stop top-ups", async (t) => {
  const f = await savedCardFixture(t);
  await f.saveCard();
  const other = await f.login("b");
  f.license("b");
  const asB = await f.request("topup", {
    method: "POST",
    cookie: other,
    subject: "b",
    body: { packId: "small" },
  });
  assert.equal((await asB.json()).cardRequired, true);
  await f.request("card", {
    method: "POST",
    cookie: other,
    subject: "b",
    body: { action: "remove" },
  });
  assert.equal(f.detached.length, 0);
  assert.equal((await f.status()).card.last4, "4242");
  assert.equal(
    (
      await f.request("topup", {
        method: "POST",
        cookie: f.cookie,
        account: "b",
        body: { packId: "small" },
      })
    ).status,
    403,
  );
  f.env.STREAMLION_CHECKOUT_MODE = "paused";
  assert.equal((await f.post("topup", { packId: "small" })).status, 403);
  assert.equal(f.topups.length, 0);
});

test("a top-up that claims an order first keeps a concurrent Checkout from being shown", async (t) => {
  const f = await savedCardFixture(t);
  await f.saveCard();
  // While Checkout is being created, a one-tap top-up claims the same order.
  f.card.onSession = (orderId) =>
    f.sql
      .prepare(
        "INSERT INTO streamlion_credit_topups_v1 VALUES(?, 'cus_1', 'pm_card_other', 1)",
      )
      .run(orderId);
  const raced = await f.post("checkout", { packId: "medium" });
  assert.equal(raced.pendingAmount, 2500);
  assert.equal(raced.url, undefined);
  const order = f.sql
    .prepare(
      "SELECT o.checkout_session FROM streamlion_credit_orders_v1 o JOIN streamlion_credit_topups_v1 t USING(order_id)",
    )
    .get();
  assert.equal(order.checkout_session, null);
});

test("an unresolved top-up never expires into a second charge; a consistent Stripe list decides after the hour", async (t) => {
  const f = await savedCardFixture(t);
  await f.saveCard();
  f.card.next = "lost";
  assert.equal((await f.post("topup", { packId: "medium" })).status, 503);
  const age = () =>
    f.sql
      .prepare(
        "UPDATE streamlion_credit_orders_v1 SET expires_at=1 WHERE order_id IN (SELECT order_id FROM streamlion_credit_topups_v1)",
      )
      .run();
  // An hour later, with no webhook, the charge is found and credited once.
  age();
  f.card.next = "succeed";
  assert.equal((await f.post("topup", { packId: "small" })).credited, true);
  assert.deepEqual(f.lists, ["cus_1"]);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    35000000,
  );
  // The next tap is a fresh, separate top-up.
  assert.equal((await f.post("topup", { packId: "small" })).credited, true);
  assert.equal(
    (await creditAccount(f.db, "test", "a")).balance_micros,
    45000000,
  );
  assert.equal(f.topups.length, 2);

  // A request that never reached Stripe is closed after the hour, then a new one may start.
  f.card.next = "lost";
  assert.equal((await f.post("topup", { packId: "small" })).status, 503);
  f.intents.delete(f.topups.at(-1).intent.id);
  assert.equal(
    (await f.post("checkout", { packId: "small" })).pendingAmount,
    1000,
  );
  age();
  f.card.next = "succeed";
  const checkout = await f.post("checkout", { packId: "small" });
  assert.match(checkout.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(
    f.sql
      .prepare(
        "SELECT COUNT(*) AS n FROM streamlion_credit_orders_v1 WHERE status='expired'",
      )
      .get().n,
    0,
  );
});

test("taxed packs grant only fixed credits, reconcile signed replays and proportionate gross refunds", async (t) => {
  const f = fixture(t, { tax: true });
  const cookie = await f.login();
  f.license();
  for (const pack of CREDIT_PACKS) {
    const response = await f.request("checkout", {
      method: "POST",
      cookie,
      body: { packId: pack.id },
    });
    assert.equal(response.status, 200, await response.clone().text());
    const p = f.created.at(-1);
    assert.equal(p.get("automatic_tax[enabled]"), "true");
    assert.equal(p.get("billing_address_collection"), "required");
    const order = f.sql
      .prepare(
        "SELECT * FROM streamlion_credit_orders_v1 ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.equal(order.checkout_tax_mode, "stripe");
    const intent = f.pay(order.checkout_session);
    const event = {
      id: "evt_tax_" + pack.id,
      type: "checkout.session.completed",
      livemode: false,
      data: { object: f.sessions.get(order.checkout_session) },
    };
    assert.equal((await signedCreditEvent(f, event)).status, 200);
    assert.equal((await signedCreditEvent(f, event)).status, 200);
    assert.equal(
      f.sql
        .prepare(
          "SELECT credited_micros FROM streamlion_credit_orders_v1 WHERE order_id=?",
        )
        .get(order.order_id).credited_micros,
      pack.creditsMicros,
    );
    intent.latest_charge.amount_refunded = (pack.amount + 200) / 2;
    assert.equal(
      (
        await signedCreditEvent(f, {
          ...event,
          id: event.id + "partial",
          type: "charge.refunded",
          data: { object: { payment_intent: intent.id } },
        })
      ).status,
      200,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT credited_micros FROM streamlion_credit_orders_v1 WHERE order_id=?",
        )
        .get(order.order_id).credited_micros,
      pack.creditsMicros / 2,
    );
    intent.latest_charge.amount_refunded = pack.amount + 200;
    assert.equal(
      (
        await signedCreditEvent(f, {
          ...event,
          id: event.id + "full",
          type: "charge.refunded",
          data: { object: { payment_intent: intent.id } },
        })
      ).status,
      200,
    );
    assert.equal(
      (await signedCreditEvent(f, { ...event, id: event.id + "late" })).status,
      200,
    );
    assert.equal(
      f.sql
        .prepare(
          "SELECT credited_micros FROM streamlion_credit_orders_v1 WHERE order_id=?",
        )
        .get(order.order_id).credited_micros,
      0,
    );
  }
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_orders_v1").get().n,
    3,
  );
});
test("unconfirmed credit tax treatment and direct saved-card top-ups fail closed", async (t) => {
  const f = fixture(t, { tax: true });
  const cookie = await f.login();
  f.license();
  delete f.env.STREAMLION_CREDIT_TAX_TREATMENT;
  assert.equal(
    (
      await f.request("checkout", {
        method: "POST",
        cookie,
        body: { packId: "small" },
      })
    ).status,
    503,
  );
  f.env.STREAMLION_CREDIT_TAX_TREATMENT = "tax_on_purchase";
  f.env.STREAMLION_SAVED_CARDS_ENABLED = "true";
  assert.equal(
    (
      await f.request("topup", {
        method: "POST",
        cookie,
        body: { packId: "small" },
      })
    ).status,
    503,
  );
  assert.equal(f.topups.length, 0);
  assert.equal(f.created.length, 0);
});

test("taxed Checkout ignores save-card requests and preserves retry parameters after configuration changes", async (t) => {
  const f = fixture(t, { tax: true });
  const cookie = await f.login();
  f.license();
  f.env.STREAMLION_SAVED_CARDS_ENABLED = "true";
  const buy = () =>
    f.request("checkout", {
      method: "POST",
      cookie,
      body: { packId: "small", saveCard: true },
    });
  assert.equal((await buy()).status, 200);
  assert.equal(f.created[0].get("customer"), null);
  assert.equal(
    f.created[0].get("payment_intent_data[setup_future_usage]"),
    null,
  );
  const order = f.sql
    .prepare("SELECT * FROM streamlion_credit_orders_v1")
    .get();
  f.sql
    .prepare(
      "UPDATE streamlion_credit_orders_v1 SET checkout_session=NULL,checkout_url=NULL WHERE order_id=?",
    )
    .run(order.order_id);
  f.env.STREAMLION_CHECKOUT_TAX_MODE = "off";
  assert.equal((await buy()).status, 200);
  assert.equal(f.created.at(-1).get("automatic_tax[enabled]"), "true");
  assert.equal(f.created.at(-1).get("customer"), null);
  assert.equal(f.creates(), 1);
});
test("tax configuration errors never stop signed reconciliation of an existing taxed payment", async (t) => {
  const f = fixture(t, { tax: true });
  const cookie = await f.login();
  f.license();
  await f.request("checkout", {
    method: "POST",
    cookie,
    body: { packId: "small" },
  });
  const s = [...f.sessions.values()][0];
  f.pay(s.id);
  f.env.STREAMLION_CHECKOUT_TAX_MODE = "invalid";
  delete f.env.STREAMLION_CREDIT_TAX_TREATMENT;
  assert.equal(
    (
      await signedCreditEvent(f, {
        id: "evt_tax_config_bad",
        type: "checkout.session.completed",
        livemode: false,
        data: { object: s },
      })
    ).status,
    200,
  );
  assert.equal(
    f.sql
      .prepare("SELECT credited_micros FROM streamlion_credit_orders_v1")
      .get().credited_micros,
    10000000,
  );
});

test("persisted taxed credit retries recheck classification and exclusive behavior with global tax off", async (t) => {
  for (const invalid of ["missing-code", "inclusive"])
    await t.test(invalid, async (t) => {
      const f = fixture(t, { tax: true }),
        cookie = await f.login();
      f.license();
      const buy = () =>
        f.request("checkout", {
          method: "POST",
          cookie,
          body: { packId: "small" },
        });
      assert.equal((await buy()).status, 200);
      const order = f.sql
        .prepare("SELECT * FROM streamlion_credit_orders_v1")
        .get();
      f.sql
        .prepare(
          "UPDATE streamlion_credit_orders_v1 SET checkout_session=NULL,checkout_url=NULL WHERE order_id=?",
        )
        .run(order.order_id);
      f.env.STREAMLION_CHECKOUT_TAX_MODE = "off";
      if (invalid === "missing-code")
        delete f.prices.price_small.product.tax_code;
      else f.prices.price_small.tax_behavior = "inclusive";
      assert.equal((await buy()).status, 503);
      assert.equal(
        f.created.length,
        1,
        "no fallback-classified tax Checkout may be created",
      );
      assert.equal(
        f.sql
          .prepare("SELECT COUNT(*) n FROM streamlion_credit_orders_v1")
          .get().n,
        1,
      );
      f.prices.price_small.product.tax_code = "txcd_10103101";
      f.prices.price_small.tax_behavior = "exclusive";
      assert.equal((await buy()).status, 200);
      assert.equal(f.created.at(-1).get("automatic_tax[enabled]"), "true");
      assert.equal(f.creates(), 1);
    });
});

test("new packs require business consent but old balances and receipts remain available", async (t) => {
  const f = fixture(t, { tax: true });
  const cookie = await f.login();
  f.license();
  const r = await f.request("checkout", {
    method: "POST",
    cookie,
    body: { packId: "small", businessUse: false },
  });
  assert.equal(r.status, 400);
  assert.equal(f.created.length, 0);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_credit_orders_v1").get().n,
    0,
  );
});

test("business pack hold issues no credits; reviewed data recovers once while checkout is paused", async (t) => {
  const f = fixture(t, { tax: true });
  const cookie = await f.login();
  f.license();
  await f.request("checkout", {
    method: "POST",
    cookie,
    body: { packId: "small" },
  });
  const order = f.sql
    .prepare("SELECT * FROM streamlion_credit_orders_v1")
    .get();
  assert.equal(order.checkout_business_policy, 1);
  const s = f.sessions.get(order.checkout_session);
  f.pay(s.id);
  s.custom_fields = [];
  f.env.STREAMLION_CHECKOUT_MODE = "paused";
  const confirm = () =>
    f.request("confirm", { method: "POST", cookie, body: { sessionId: s.id } });
  const held = await (await confirm()).json();
  assert.equal(held.status, "processing");
  assert.equal(held.businessReview, "manual");
  assert.equal(held.credited, false);
  assert.equal(
    f.sql
      .prepare("SELECT credited_micros FROM streamlion_credit_orders_v1")
      .get().credited_micros,
    0,
  );
  s.custom_fields = [
    { key: "business_name", text: { value: "QA Harbor Spatial" } },
  ];
  assert.equal((await (await confirm()).json()).credited, true);
  assert.equal((await (await confirm()).json()).credited, true);
  assert.equal(
    f.sql
      .prepare("SELECT credited_micros FROM streamlion_credit_orders_v1")
      .get().credited_micros,
    10000000,
  );
});
