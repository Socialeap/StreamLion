import Stripe from "stripe";
import {
  configuration,
  client,
  preflight,
  limited,
  validateCheckout,
} from "./stripe-purchase.js";
import { getSession } from "./google-auth.js";
import { hasPurchase, paymentMode } from "./purchase-access.js";
import { boundedText } from "./request-body.js";
import {
  paidCreditMode,
  creditAccount,
  creditCapacity,
} from "./ai-credit-ledger.js";
import { AI_LIMITS } from "./ai-providers.js";

export const CREDIT_PACKS = [
  {
    id: "small",
    amount: 1000,
    creditsMicros: 10000000,
    priceSetting: "STRIPE_AI_PRICE_10",
  },
  {
    id: "medium",
    amount: 2500,
    creditsMicros: 25000000,
    priceSetting: "STRIPE_AI_PRICE_25",
  },
  {
    id: "large",
    amount: 5000,
    creditsMicros: 50000000,
    priceSetting: "STRIPE_AI_PRICE_50",
  },
];
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const first = (env, sql, ...args) =>
  env.GOOGLE_SESSIONS.prepare(sql)
    .bind(...args)
    .first();
const run = (env, sql, ...args) =>
  env.GOOGLE_SESSIONS.prepare(sql)
    .bind(...args)
    .run();
const idOf = (value) => (typeof value === "string" ? value : value?.id);
const EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
]);
function creditConfiguration(env) {
  const mode = paidCreditMode(env);
  if (
    mode !== paymentMode(env) ||
    !["test", "live"].includes(mode) ||
    !/^prod_\w+$/.test(env.STRIPE_AI_PRODUCT_ID || "") ||
    CREDIT_PACKS.some((p) => !/^price_\w+$/.test(env[p.priceSetting] || ""))
  )
    throw new Error("credit_configuration");
  return configuration({
    ...env,
    STRIPE_WEBHOOK_SECRET: env.STRIPE_AI_WEBHOOK_SECRET,
    STRIPE_PRODUCT_ID: env.STRIPE_AI_PRODUCT_ID,
    STRIPE_PRICE_ID: env.STRIPE_AI_PRICE_10,
    STRIPE_LAUNCH_PRICE_ID: undefined,
  });
}
async function creditPreflight(env, stripe) {
  const stamp = await first(
    env,
    "SELECT version FROM streamlion_credit_schema_v1 WHERE version=1",
  );
  if (!stamp) throw new Error("credit_configuration");
  await preflight(env, stripe);
}
async function catalog(env, stripe, mode) {
  return Promise.all(
    CREDIT_PACKS.map(async (pack) => {
      const price = await stripe.prices.retrieve(env[pack.priceSetting], {
        expand: ["product"],
      });
      if (
        !price.active ||
        price.livemode !== (mode === "live") ||
        price.type !== "one_time" ||
        price.currency !== "usd" ||
        price.unit_amount !== pack.amount ||
        price.product?.id !== env.STRIPE_AI_PRODUCT_ID ||
        !price.product.active ||
        price.product.metadata?.app !== "streamlion" ||
        price.product.metadata?.kind !== "ai_credits"
      )
        throw new Error("credit_configuration");
      return { ...pack, priceId: price.id };
    }),
  );
}
async function salesReady(env, mode) {
  if (env.STREAMLION_AI_CREDIT_SALES_ENABLED !== "true") return false;
  if (mode === "test") return true; // Fake test funds never authorize provider spending.
  if (
    env.STREAMLION_AI_COST_APPROVED !== "true" ||
    env.ENABLE_AI_PILOT !== "true" ||
    !env.OPENAI_API_KEY ||
    !env.DEEPINFRA_API_KEY
  )
    return false;
  const policy = await creditAccount(env.GOOGLE_SESSIONS, mode, ""),
    capacity = await creditCapacity(env.GOOGLE_SESSIONS, mode);
  return (
    policy.active === 1 &&
    policy.price_micros > 0 &&
    capacity.reserved + AI_LIMITS.reserveMicros <= policy.total_budget_micros &&
    capacity.dailyReserved + AI_LIMITS.reserveMicros <=
      policy.daily_budget_micros &&
    capacity.dailyAttempts < policy.daily_requests
  );
}
export async function reconcileCredits(env, stripe, orderId, sessionId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const order = await first(
      env,
      "SELECT * FROM streamlion_credit_orders_v1 WHERE order_id=?",
      orderId,
    );
    if (!order) throw new Error("credit_mismatch");
    const session = await stripe.checkout.sessions.retrieve(
      sessionId || order.checkout_session,
      { expand: ["line_items", "payment_intent.latest_charge"] },
    );
    validateCheckout(session, order);
    if (session.metadata?.kind !== "ai_credits")
      throw new Error("credit_mismatch");
    const intent = session.payment_intent;
    let status =
        session.status === "expired"
          ? "expired"
          : session.status === "complete"
            ? ["canceled", "requires_payment_method"].includes(intent?.status)
              ? "failed"
              : "processing"
            : "pending",
      refunded = 0,
      target = 0;
    if (session.payment_status === "paid") {
      const charge = intent?.latest_charge;
      if (
        intent?.status !== "succeeded" ||
        intent.livemode !== session.livemode ||
        intent.metadata?.app !== "streamlion" ||
        intent.metadata?.kind !== "ai_credits" ||
        intent.metadata?.order_id !== orderId ||
        !charge?.paid ||
        !charge.captured ||
        charge.currency !== order.currency ||
        !Number.isSafeInteger(charge.amount) ||
        charge.amount !== session.amount_total ||
        charge.amount < order.amount
      )
        throw new Error("credit_mismatch");
      refunded = charge.amount_refunded || 0;
      if (
        !Number.isSafeInteger(refunded) ||
        refunded < 0 ||
        refunded > charge.amount
      )
        throw new Error("credit_mismatch");
      status = refunded >= charge.amount ? "refunded" : "paid";
      // Revoke proportionally, rounding toward safety. Tax-inclusive full refunds revoke all.
      target =
        order.credits_micros -
        Math.ceil((order.credits_micros * refunded) / charge.amount);
      if (charge.disputed) {
        const disputes = await stripe.disputes.list({
          payment_intent: intent.id,
          limit: 100,
        });
        if (
          disputes.has_more ||
          !disputes.data.length ||
          disputes.data.some((d) => d.status !== "won")
        ) {
          status = "disputed";
          target = 0;
        }
      }
    }
    const saved = await run(
      env,
      `UPDATE streamlion_credit_orders_v1 SET checkout_session=?,payment_intent=?,status=?,amount_refunded=?,credited_micros=?,updated_at=?,revision=revision+1 WHERE order_id=? AND revision=?`,
      session.id,
      idOf(intent) || null,
      status,
      refunded,
      target,
      Date.now(),
      orderId,
      order.revision,
    );
    // The grant trigger runs in the same transaction as this revision check.
    if (saved.meta.changes)
      return { ...order, status, credited_micros: target };
  }
  throw new Error("credit_busy");
}
async function checkout(env, stripe, identity, config, packId) {
  if (!(await salesReady(env, config.mode))) throw new Error("credit_closed");
  if (!(await hasPurchase(env, identity.google_subject)))
    return { licenseRequired: true };
  await limited(env, "credits:" + identity.google_subject);
  const packs = await catalog(env, stripe, config.mode),
    pack = packs.find((p) => p.id === packId);
  if (!pack) throw new Error("bad_request");
  await run(
    env,
    "UPDATE streamlion_credit_orders_v1 SET status='expired',revision=revision+1 WHERE mode=? AND checkout_session IS NULL AND status='pending' AND expires_at<=?",
    config.mode,
    Date.now(),
  );
  let order = await first(
    env,
    "SELECT * FROM streamlion_credit_orders_v1 WHERE mode=? AND google_subject=? AND status IN ('pending','processing')",
    config.mode,
    identity.google_subject,
  );
  if (order?.checkout_session) {
    order = await reconcileCredits(
      env,
      stripe,
      order.order_id,
      order.checkout_session,
    );
    if (order.status === "pending")
      return order.price_id === pack.priceId
        ? { url: order.checkout_url }
        : { pendingAmount: order.amount };
    if (order.status === "processing") return { processing: true };
    if (order.status === "paid") return { credited: true };
    order = null;
  }
  if (!order) {
    const now = Date.now();
    await run(
      env,
      `INSERT OR IGNORE INTO streamlion_credit_orders_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,credits_micros,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,'usd',?,?,?,?)`,
      crypto.randomUUID(),
      config.mode,
      identity.google_subject,
      identity.email,
      pack.priceId,
      env.STRIPE_AI_PRODUCT_ID,
      pack.amount,
      pack.creditsMicros,
      now,
      now + 3600000,
      now,
    );
    order = await first(
      env,
      "SELECT * FROM streamlion_credit_orders_v1 WHERE mode=? AND google_subject=? AND status IN ('pending','processing')",
      config.mode,
      identity.google_subject,
    );
  }
  if (!order || order.price_id !== pack.priceId)
    throw new Error("credit_pending");
  const metadata = {
    app: "streamlion",
    kind: "ai_credits",
    order_id: order.order_id,
  };
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      client_reference_id: order.order_id,
      customer_email: order.checkout_email,
      line_items: [{ price: order.price_id, quantity: 1 }],
      metadata,
      payment_intent_data: {
        statement_descriptor_suffix: "STREAMLION",
        metadata,
      },
      expires_at: Math.floor(order.expires_at / 1000),
      success_url:
        config.origin + "/api/credits?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: config.origin + "/api/credits?cancelled=1",
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message: `I agree to the [StreamLion credit terms](${config.origin}/api/terms#ai-credits).`,
        },
        submit: {
          message:
            "Optional AI Project Assistant credits. One payment, no subscription or automatic recharge. Credits stay with the Google account selected before checkout.",
        },
      },
    },
    { idempotencyKey: `streamlion-credits:${config.mode}:${order.order_id}` },
  );
  if (
    session.livemode !== (config.mode === "live") ||
    !session.url ||
    new URL(session.url).origin !== "https://checkout.stripe.com"
  )
    throw new Error("credit_mismatch");
  await run(
    env,
    "UPDATE streamlion_credit_orders_v1 SET checkout_session=?,checkout_url=?,revision=revision+1 WHERE order_id=? AND (checkout_session IS NULL OR checkout_session=?)",
    session.id,
    session.url,
    order.order_id,
    session.id,
  );
  if (session.status === "expired") {
    await reconcileCredits(env, stripe, order.order_id, session.id);
    throw new Error("credit_busy");
  }
  return { url: session.url };
}
async function webhook(request, env, stripe, config) {
  if (!request.headers.get("Stripe-Signature"))
    return json({ error: "Invalid event signature." }, 400);
  let event;
  const body = await boundedText(request, 256 * 1024);
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      request.headers.get("Stripe-Signature"),
      env.STRIPE_AI_WEBHOOK_SECRET,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json({ error: "Invalid event signature." }, 400);
  }
  if (event.livemode !== (config.mode === "live"))
    return json({ error: "Wrong payment environment." }, 400);
  if (!EVENTS.has(event.type)) return json({ received: true });
  const object = event.data.object;
  let orderId, order;
  if (event.type.startsWith("checkout.session.")) {
    if (
      object.metadata?.app !== "streamlion" ||
      object.metadata?.kind !== "ai_credits"
    )
      return json({ received: true });
    orderId = object.metadata.order_id;
  } else {
    const intent = idOf(object.payment_intent);
    if (!intent) return json({ received: true });
    // Retrieve current metadata even when chargeback/refund precedes completion.
    const payment = await stripe.paymentIntents.retrieve(intent);
    if (
      payment.metadata?.app !== "streamlion" ||
      payment.metadata?.kind !== "ai_credits"
    )
      return json({ received: true });
    orderId = payment.metadata.order_id;
  }
  await creditPreflight(env, stripe);
  if (
    await first(
      env,
      "SELECT event_id FROM streamlion_credit_events_v1 WHERE event_id=?",
      event.id,
    )
  )
    return json({ received: true });
  order = await first(
    env,
    "SELECT * FROM streamlion_credit_orders_v1 WHERE order_id=?",
    orderId,
  );
  if (!order || order.mode !== config.mode) throw new Error("credit_mismatch");
  await reconcileCredits(
    env,
    stripe,
    orderId,
    event.type.startsWith("checkout.session.")
      ? object.id
      : order.checkout_session,
  );
  await run(
    env,
    "INSERT OR IGNORE INTO streamlion_credit_events_v1 VALUES(?,?,?,?)",
    event.id,
    config.mode,
    event.type,
    Date.now(),
  );
  return json({ received: true });
}
export async function handleCredits({ request, env, params }) {
  const path = (params.path || []).join("/"),
    mode = paidCreditMode(env);
  const method = {
    config: "GET",
    status: "GET",
    checkout: "POST",
    confirm: "POST",
    webhook: "POST",
  }[path];
  if (!method) return json({ error: "Not found." }, 404);
  if (request.method !== method)
    return json({ error: "Method not allowed." }, 405);
  if (mode === "disabled")
    return json(
      { enabled: false, connected: false },
      path === "webhook" || request.method === "POST" ? 503 : 200,
    );
  try {
    const config = creditConfiguration(env),
      stripe = client(env);
    if (
      new URL(request.url).origin !== config.origin ||
      request.headers.get("Sec-Fetch-Site") === "cross-site"
    )
      return json({ error: "Open StreamLion to continue." }, 403);
    if (path === "webhook") return await webhook(request, env, stripe, config);
    if (path === "config") {
      await limited(
        env,
        "credit-quote:" +
          (request.headers.get("CF-Connecting-IP") || "unknown"),
        60,
      );
      await limited(env, "credit-quote:global", 200);
      await creditPreflight(env, stripe);
      const packs = await catalog(env, stripe, mode);
      return json({
        enabled: await salesReady(env, mode),
        mode,
        markupPercent: 30,
        packs: packs.map(({ id, amount, creditsMicros }) => ({
          id,
          amount,
          creditsMicros,
        })),
      });
    }
    const identity = await getSession(request, env);
    if (!identity)
      return json(
        { enabled: true, mode, connected: false },
        method === "POST" ? 401 : 200,
      );
    if (
      method === "POST" &&
      (request.headers.get("Origin") !== config.origin ||
        request.headers.get("X-StreamLion-Account") !== identity.google_subject)
    )
      return json({ error: "Your account changed. Reopen this page." }, 403);
    await creditPreflight(env, stripe);
    if (path === "status") {
      const wallet = await creditAccount(
        env.GOOGLE_SESSIONS,
        mode,
        identity.google_subject,
      );
      return json({
        enabled: true,
        mode,
        connected: true,
        account: identity.email,
        subject: identity.google_subject,
        purchased: await hasPurchase(env, identity.google_subject),
        balanceMicros: Math.max(0, wallet.balance_micros),
        creditHold: wallet.balance_micros < 0,
        priceMicros: wallet.price_micros,
      });
    }
    if (
      !(request.headers.get("Content-Type") || "").startsWith(
        "application/json",
      )
    )
      return json({ error: "Use JSON." }, 415);
    const body = JSON.parse(await boundedText(request, 2048));
    if (path === "checkout")
      return json(await checkout(env, stripe, identity, config, body.packId));
    if (path === "confirm") {
      if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(body.sessionId || ""))
        throw new Error("bad_request");
      await limited(env, "credits:" + identity.google_subject);
      const order = await first(
        env,
        "SELECT * FROM streamlion_credit_orders_v1 WHERE checkout_session=? AND mode=? AND google_subject=?",
        body.sessionId,
        mode,
        identity.google_subject,
      );
      if (!order)
        return json(
          {
            error: "Sign in with the Google account used to buy these credits.",
          },
          403,
        );
      const receipt = await reconcileCredits(
        env,
        stripe,
        order.order_id,
        order.checkout_session,
      );
      return json({
        status: receipt.status,
        credited: receipt.credited_micros > 0,
      });
    }
  } catch (error) {
    if (error.message === "bad_request" || error instanceof SyntaxError)
      return json({ error: "Invalid credit request." }, 400);
    if (error.message === "purchase_limit")
      return json({ error: "Please wait a minute before trying again." }, 429);
    return json(
      {
        enabled: false,
        error:
          "AI credit payments are unavailable. Check again shortly; your saved project records remain available.",
      },
      503,
    );
  }
}
