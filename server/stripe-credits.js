import {
  requireBusinessSchema,
  requireBusinessConsent,
  businessCheckoutParams,
  businessReview,
} from "./checkout-business.js";
import Stripe from "stripe";
import {
  checkoutTaxMode,
  taxSchemaReady,
  validateTaxPrice,
  taxCheckoutParams,
} from "./checkout-tax.js";
import {
  configuration,
  client,
  preflight,
  limited,
  validateCheckout,
} from "./stripe-purchase.js";
import { getSession, hash } from "./google-auth.js";
import {
  checkoutAccess,
  checkoutQuoteAccess,
  CHECKOUT_PAUSED,
} from "./checkout-access.js";
import { hasPurchase, paymentMode } from "./purchase-access.js";
import { boundedText, RequestBodyError } from "./request-body.js";
import {
  paidCreditMode,
  creditAccount,
  creditCapacity,
  creditPrice,
} from "./ai-credit-ledger.js";
import { AI_LIMITS } from "./ai-providers.js";
import { paidAIOpen } from "./ai-pilot.js";
import { approved as briefImportOpen } from "./brief-import.js";
import { coordinationReady } from "./coordination-readiness.js";

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
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
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
// Saved cards are optional and closed by default. A saved card is charged only
// when its account holder taps a top-up; nothing here recharges a wallet.
const cardsTable = async (env) => {
  try {
    return Boolean(
      await first(
        env,
        "SELECT version FROM streamlion_credit_cards_schema_v1 WHERE version=1",
      ),
    );
  } catch {
    return false;
  }
};
const cardsReady = async (env) =>
  env.STREAMLION_SAVED_CARDS_ENABLED === "true" && (await cardsTable(env));
const savedCard = (env, mode, subject) =>
  first(
    env,
    "SELECT * FROM streamlion_credit_cards_v1 WHERE mode=? AND google_subject=?",
    mode,
    subject,
  );
const cardView = (card) =>
  card?.payment_method
    ? {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.exp_month,
        expYear: card.exp_year,
      }
    : null;
// One Stripe customer per Google account and mode holds the saved card.
async function walletCustomer(env, stripe, mode, identity) {
  const known = await savedCard(env, mode, identity.google_subject);
  if (known) return known.customer_id;
  const customer = await stripe.customers.create(
    {
      email: identity.email,
      metadata: { app: "streamlion", kind: "credit_wallet" },
    },
    {
      idempotencyKey: `streamlion-customer:${mode}:${await hash(identity.google_subject)}`,
    },
  );
  if (
    !/^cus_\w+$/.test(customer.id || "") ||
    customer.livemode !== (mode === "live")
  )
    throw new Error("credit_mismatch");
  await run(
    env,
    "INSERT OR IGNORE INTO streamlion_credit_cards_v1(mode,google_subject,customer_id,updated_at) VALUES(?,?,?,?)",
    mode,
    identity.google_subject,
    customer.id,
    Date.now(),
  );
  return (await savedCard(env, mode, identity.google_subject)).customer_id;
}
// Remember the card a paid "save my card" checkout used, while it is still
// attached to this account's customer. An older order never replaces a newer
// card, and a card removed since then stays removed.
async function rememberCard(env, order, intent) {
  const method = intent?.payment_method;
  if (
    intent?.metadata?.save_card !== "1" ||
    !method ||
    typeof method !== "object" ||
    method.type !== "card" ||
    !method.card
  )
    return;
  try {
    await run(
      env,
      "UPDATE streamlion_credit_cards_v1 SET payment_method=?,brand=?,last4=?,exp_month=?,exp_year=?,saved_order_at=?,updated_at=? WHERE mode=? AND google_subject=? AND customer_id=? AND (saved_order_at IS NULL OR saved_order_at<=?)",
      method.id,
      String(method.card.brand || "card").slice(0, 20),
      method.card.last4,
      method.card.exp_month,
      method.card.exp_year,
      order.created_at,
      Date.now(),
      order.mode,
      order.google_subject,
      idOf(method.customer),
      order.created_at,
    );
  } catch {
    /* Credits never depend on remembering the card. */
  }
}
async function catalog(env, stripe, mode) {
  const taxMode = checkoutTaxMode(env, true);
  await taxSchemaReady(env, taxMode);
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
      validateTaxPrice(price, taxMode);
      // Retain the fresh server-side price for the pending order's own tax check.
      return { ...pack, priceId: price.id, stripePrice: price };
    }),
  );
}
// Prices for the optional brief and AI features, or null while either is
// closed, so the credits guide never advertises a price nobody can use.
export async function featurePrices(env, mode) {
  const price = async (open, sql, toMicros) => {
    if (!open) return null;
    try {
      const row = await env.GOOGLE_SESSIONS.prepare(sql).bind(mode).first();
      const micros = row ? toMicros(row) : null;
      return Number.isSafeInteger(micros) && micros > 0 ? micros : null;
    } catch {
      return null;
    }
  };
  return {
    briefMicros: await price(
      briefImportOpen(env),
      "SELECT price_micros FROM streamlion_brief_policy_v1 WHERE mode=? AND active=1",
      (row) => row.price_micros,
    ),
    aiMicros: await price(
      paidAIOpen(env),
      "SELECT cost_micros FROM streamlion_credit_policy_v1 WHERE mode=? AND active=1",
      (row) =>
        row.cost_micros >= AI_LIMITS.reserveMicros
          ? creditPrice(row.cost_micros)
          : null,
    ),
  };
}
async function projectCharge(env, mode) {
  try {
    const policy = await env.GOOGLE_SESSIONS.prepare(
      "SELECT project_micros FROM streamlion_coordination_policy_v1 WHERE mode=? AND active=1",
    )
      .bind(mode)
      .first();
    return Number.isSafeInteger(policy?.project_micros) &&
      policy.project_micros > 0
      ? policy.project_micros
      : null;
  } catch {
    // Older/missing coordination schemas must not invent an advertised charge.
    return null;
  }
}
async function salesReady(env, mode) {
  // A project top-up never approves AI spend. Keep the existing AI-only sales
  // path below, and require explicit approval plus real coordination readiness.
  if (
    env.STREAMLION_COORDINATION_CREDIT_SALES_ENABLED === "true" &&
    (await coordinationReady(env)) &&
    (await projectCharge(env, mode)) !== null
  ) {
    // Status/confirmation still use this ledger row. Its inactive, zero-budget
    // policy is valid for coordination; a missing/unreadable ledger is not.
    await creditAccount(env.GOOGLE_SESSIONS, mode, "");
    return true;
  }
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
// The credited amount for a succeeded payment, after refunds and any
// dispute that is not won.
async function paidState(stripe, order, intent, total) {
  const charge = intent?.latest_charge;
  if (
    intent?.status !== "succeeded" ||
    intent.livemode !== (order.mode === "live") ||
    intent.metadata?.app !== "streamlion" ||
    intent.metadata?.kind !== "ai_credits" ||
    intent.metadata?.order_id !== order.order_id ||
    !charge?.paid ||
    !charge.captured ||
    charge.currency !== order.currency ||
    !Number.isSafeInteger(charge.amount) ||
    charge.amount !== total ||
    charge.amount < order.amount
  )
    throw new Error("credit_mismatch");
  const refunded = charge.amount_refunded || 0;
  if (
    !Number.isSafeInteger(refunded) ||
    refunded < 0 ||
    refunded > charge.amount
  )
    throw new Error("credit_mismatch");
  let status = refunded >= charge.amount ? "refunded" : "paid";
  // Revoke proportionally, rounding toward safety. Tax-inclusive full refunds revoke all.
  let target =
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
  return { status, refunded, target };
}
const topupOf = async (env, orderId) => {
  try {
    return await first(
      env,
      "SELECT * FROM streamlion_credit_topups_v1 WHERE order_id=?",
      orderId,
    );
  } catch {
    return null;
  }
};
// A saved-card top-up has no Checkout Session; its PaymentIntent is the record.
async function reconcileTopup(env, stripe, order, topup, intentId) {
  let id = order.payment_intent || intentId;
  if (!id) {
    // Within the hour the same idempotency key can still be retried. After
    // it, list this customer's PaymentIntents since the order (a strongly
    // consistent read, unlike search); only when none carries this order is
    // the order closed, so a new top-up cannot charge twice.
    if (order.expires_at > Date.now()) return { order, saved: true };
    const matches = [];
    let page = { has_more: true, data: [] };
    for (let n = 0; page.has_more; n++) {
      if (n === 10) throw new Error("credit_busy");
      page = await stripe.paymentIntents.list({
        customer: topup.customer_id,
        created: { gte: Math.floor(order.created_at / 1000) - 300 },
        limit: 100,
        ...(page.data.length ? { starting_after: page.data.at(-1).id } : {}),
      });
      matches.push(
        ...page.data.filter(
          (intent) => intent.metadata?.order_id === order.order_id,
        ),
      );
    }
    if (matches.length > 1) throw new Error("credit_mismatch");
    if (matches.length) id = matches[0].id;
    else {
      const closed = await run(
        env,
        "UPDATE streamlion_credit_orders_v1 SET status='failed',updated_at=?,revision=revision+1 WHERE order_id=? AND revision=? AND payment_intent IS NULL AND status='pending'",
        Date.now(),
        order.order_id,
        order.revision,
      );
      return {
        order: { ...order, status: "failed" },
        saved: closed.meta.changes > 0,
      };
    }
  }
  const intent = await stripe.paymentIntents.retrieve(id, {
    expand: ["latest_charge"],
  });
  if (
    intent.id !== id ||
    intent.livemode !== (order.mode === "live") ||
    intent.metadata?.app !== "streamlion" ||
    intent.metadata?.kind !== "ai_credits" ||
    intent.metadata?.source !== "saved_card" ||
    intent.metadata?.order_id !== order.order_id ||
    intent.amount !== order.amount ||
    intent.currency !== order.currency ||
    idOf(intent.customer) !== topup.customer_id ||
    idOf(intent.payment_method) !== topup.payment_method
  )
    throw new Error("credit_mismatch");
  let state = { status: "failed", refunded: 0, target: 0 };
  if (intent.status === "succeeded")
    state = await paidState(stripe, order, intent, intent.amount);
  else if (intent.status === "processing")
    state = { status: "processing", refunded: 0, target: 0 };
  const saved = await run(
    env,
    `UPDATE streamlion_credit_orders_v1 SET payment_intent=?,status=?,amount_refunded=?,credited_micros=?,updated_at=?,revision=revision+1 WHERE order_id=? AND revision=? AND checkout_session IS NULL`,
    intent.id,
    state.status,
    state.refunded,
    state.target,
    Date.now(),
    order.order_id,
    order.revision,
  );
  return {
    order: { ...order, status: state.status, credited_micros: state.target },
    saved: saved.meta.changes > 0,
    intent,
  };
}
export async function reconcileCredits(
  env,
  stripe,
  orderId,
  sessionId,
  intentId,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const order = await first(
      env,
      "SELECT * FROM streamlion_credit_orders_v1 WHERE order_id=?",
      orderId,
    );
    if (!order) throw new Error("credit_mismatch");
    if (!sessionId && !order.checkout_session) {
      const topup = await topupOf(env, orderId);
      // An order still waiting for its Checkout Session has nothing to settle.
      if (!topup) return order;
      const result = await reconcileTopup(env, stripe, order, topup, intentId);
      // The grant trigger runs in the same transaction as this revision check.
      if (result.saved) return result.order;
      continue;
    }
    const session = await stripe.checkout.sessions.retrieve(
      sessionId || order.checkout_session,
      {
        expand: [
          "line_items",
          "payment_intent.latest_charge",
          "payment_intent.payment_method",
        ],
      },
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
    if (session.payment_status === "paid")
      ({ status, refunded, target } = await paidState(
        stripe,
        order,
        intent,
        session.amount_total,
      ));
    const review =
      status === "paid" ? await businessReview(stripe, session, order) : null;
    if (review) {
      status = "processing";
      target = 0;
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
    if (saved.meta.changes) {
      if (status === "paid") await rememberCard(env, order, intent);
      return {
        ...order,
        status,
        credited_micros: target,
        businessReview: review,
      };
    }
  }
  throw new Error("credit_busy");
}
const pendingOrder = (env, mode, subject) =>
  first(
    env,
    "SELECT * FROM streamlion_credit_orders_v1 WHERE mode=? AND google_subject=? AND status IN ('pending','processing')",
    mode,
    subject,
  );
// Saved-card top-ups never expire on a timer: a charge whose response was
// lost is settled from Stripe instead (see reconcileTopup).
async function expireOrders(env, mode) {
  await run(
    env,
    "UPDATE streamlion_credit_orders_v1 SET status='expired',revision=revision+1 WHERE mode=? AND checkout_session IS NULL AND status='pending' AND expires_at<=?" +
      ((await cardsTable(env))
        ? " AND NOT EXISTS(SELECT 1 FROM streamlion_credit_topups_v1 t WHERE t.order_id=streamlion_credit_orders_v1.order_id)"
        : ""),
    mode,
    Date.now(),
  );
}
async function createOrder(
  env,
  config,
  identity,
  pack,
  businessUse,
  legacyTopup = false,
) {
  if (!legacyTopup) {
    requireBusinessConsent({ businessUse });
    await requireBusinessSchema(env);
  }
  const taxMode = checkoutTaxMode(env, true);
  await taxSchemaReady(env, taxMode);
  const now = Date.now();
  await run(
    env,
    `INSERT OR IGNORE INTO streamlion_credit_orders_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,credits_micros,created_at,expires_at,updated_at${legacyTopup ? "" : ",checkout_business_policy"}${taxMode === "stripe" ? ",checkout_tax_mode" : ""}) VALUES(?,?,?,?,?,?,?,'usd',?,?,?,?${legacyTopup ? "" : ",1"}${taxMode === "stripe" ? ",'stripe'" : ""})`,
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
  return pendingOrder(env, config.mode, identity.google_subject);
}
async function checkout(
  env,
  stripe,
  identity,
  config,
  packId,
  saveCard,
  businessUse,
) {
  if (!(await salesReady(env, config.mode))) throw new Error("credit_closed");
  if (!(await hasPurchase(env, identity.google_subject)))
    return { licenseRequired: true };
  await limited(env, "credits:" + identity.google_subject);
  const packs = await catalog(env, stripe, config.mode),
    pack = packs.find((p) => p.id === packId);
  if (!pack) throw new Error("bad_request");
  await expireOrders(env, config.mode);
  let order = await pendingOrder(env, config.mode, identity.google_subject);
  if (
    order &&
    !order.checkout_session &&
    (await topupOf(env, order.order_id))
  ) {
    // A saved-card top-up in progress is settled first; it never gets a
    // Checkout Session of its own.
    order = await reconcileCredits(env, stripe, order.order_id);
    if (order.status === "pending") return { pendingAmount: order.amount };
    if (order.status === "processing")
      return {
        processing: true,
        businessReview: order.businessReview,
        ...(order.businessReview ? { sessionId: order.checkout_session } : {}),
      };
    if (order.status === "paid") return { credited: true };
    order = null;
  }
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
    if (order.status === "processing")
      return {
        processing: true,
        businessReview: order.businessReview,
        ...(order.businessReview ? { sessionId: order.checkout_session } : {}),
      };
    if (order.status === "paid") return { credited: true };
    order = null;
  }
  if (!order)
    order = await createOrder(env, config, identity, pack, businessUse);
  if (!order || order.price_id !== pack.priceId)
    throw new Error("credit_pending");
  if (!order.checkout_session && (await topupOf(env, order.order_id)))
    return { pendingAmount: order.amount };
  validateTaxPrice(pack.stripePrice, order.checkout_tax_mode);
  const save =
    order.checkout_tax_mode !== "stripe" &&
    saveCard === true &&
    (await cardsReady(env));
  const customer = save
    ? await walletCustomer(env, stripe, config.mode, identity)
    : null;
  const metadata = {
    app: "streamlion",
    kind: "ai_credits",
    order_id: order.order_id,
    ...(save ? { save_card: "1" } : {}),
  };
  const session = await stripe.checkout.sessions.create(
    {
      ...taxCheckoutParams(order),
      ...businessCheckoutParams(order),
      mode: "payment",
      client_reference_id: order.order_id,
      ...(save ? { customer } : { customer_email: order.checkout_email }),
      line_items: [{ price: order.price_id, quantity: 1 }],
      metadata,
      payment_intent_data: {
        statement_descriptor_suffix: "STREAMLION",
        metadata,
        // Saved for top-ups the account holder starts in StreamLion.
        ...(save ? { setup_future_usage: "on_session" } : {}),
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
            "Prepaid credits for confirmed client jobs and optional AI Project Assistant answers. One payment, no subscription or automatic recharge. Credits stay with the Google account selected before checkout." +
            (save
              ? " Your card is saved for top-ups you start yourself in StreamLion. Remove it any time on the Credits page."
              : ""),
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
  // A saved-card top-up may claim the same order concurrently; only one of
  // them is recorded, and a Checkout that lost is never shown.
  const cards = await cardsTable(env);
  const recorded = await run(
    env,
    "UPDATE streamlion_credit_orders_v1 SET checkout_session=?,checkout_url=?,revision=revision+1 WHERE order_id=? AND (checkout_session IS NULL OR checkout_session=?)" +
      (cards
        ? " AND NOT EXISTS(SELECT 1 FROM streamlion_credit_topups_v1 t WHERE t.order_id=streamlion_credit_orders_v1.order_id)"
        : ""),
    session.id,
    session.url,
    order.order_id,
    session.id,
  );
  if (!recorded.meta.changes && cards && (await topupOf(env, order.order_id)))
    return { pendingAmount: order.amount };
  if (session.status === "expired") {
    await reconcileCredits(env, stripe, order.order_id, session.id);
    throw new Error("credit_busy");
  }
  return { url: session.url };
}
// One tap: charge the saved card for one pack while its holder is in the app.
// A bank that asks for confirmation fails the attempt at once; the Credits
// page then offers Stripe Checkout for the same pack.
async function topup(env, stripe, identity, config, packId) {
  // This direct PaymentIntent path has no tax calculation/address step.
  if (checkoutTaxMode(env, true) === "stripe") throw new Error("credit_closed");
  if (!(await cardsReady(env))) throw new Error("bad_request");
  if (!(await salesReady(env, config.mode))) throw new Error("credit_closed");
  if (!(await hasPurchase(env, identity.google_subject)))
    return { licenseRequired: true };
  await limited(env, "credits:" + identity.google_subject);
  const packs = await catalog(env, stripe, config.mode),
    pack = packs.find((p) => p.id === packId);
  if (!pack) throw new Error("bad_request");
  const card = await savedCard(env, config.mode, identity.google_subject);
  if (!card?.payment_method) return { cardRequired: true };
  await expireOrders(env, config.mode);
  let order = await pendingOrder(env, config.mode, identity.google_subject),
    marked = order && (await topupOf(env, order.order_id));
  if (order) {
    // An open Checkout, or an order still waiting for one, finishes first.
    if (order.checkout_session || !marked)
      return { pendingAmount: order.amount };
    order = await reconcileCredits(env, stripe, order.order_id);
    if (order.status === "processing") return { processing: true };
    if (order.status === "paid") return { credited: true };
    if (order.status !== "pending") order = null;
    // A charge request that may not have finished is retried with its key.
    else if (order.price_id !== pack.priceId)
      return { pendingAmount: order.amount };
  }
  if (!order) {
    order = await createOrder(env, config, identity, pack, undefined, true);
    if (!order || order.price_id !== pack.priceId || order.checkout_session)
      throw new Error("credit_pending");
    // Claim the order only while no Checkout Session is recorded for it.
    const claimed = await run(
      env,
      "INSERT OR IGNORE INTO streamlion_credit_topups_v1(order_id,customer_id,payment_method,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM streamlion_credit_orders_v1 WHERE order_id=? AND checkout_session IS NULL AND status='pending')",
      order.order_id,
      card.customer_id,
      card.payment_method,
      Date.now(),
      order.order_id,
    );
    marked = await topupOf(env, order.order_id);
    if (
      !claimed.meta.changes &&
      (marked?.customer_id !== card.customer_id ||
        marked?.payment_method !== card.payment_method)
    )
      return { pendingAmount: order.amount };
  }
  let intent, failure;
  try {
    intent = await stripe.paymentIntents.create(
      {
        amount: order.amount,
        currency: order.currency,
        customer: marked.customer_id,
        payment_method: marked.payment_method,
        payment_method_types: ["card"],
        confirm: true,
        error_on_requires_action: true,
        description: "StreamLion prepaid credits",
        statement_descriptor_suffix: "STREAMLION",
        metadata: {
          app: "streamlion",
          kind: "ai_credits",
          order_id: order.order_id,
          source: "saved_card",
        },
      },
      { idempotencyKey: `streamlion-topup:${config.mode}:${order.order_id}` },
    );
  } catch (error) {
    failure = error;
    intent = error?.payment_intent || error?.raw?.payment_intent;
    if (!intent?.id) {
      // A card Stripe can no longer use is forgotten, and nothing was charged.
      if (
        error?.type === "StripeInvalidRequestError" &&
        /payment_method/.test(error.param || "")
      ) {
        await run(
          env,
          "UPDATE streamlion_credit_orders_v1 SET status='failed',revision=revision+1 WHERE order_id=? AND status='pending' AND payment_intent IS NULL",
          order.order_id,
        );
        await forgetCard(
          env,
          config.mode,
          identity.google_subject,
          marked.payment_method,
        );
        return { cardRequired: true };
      }
      throw error;
    }
  }
  await run(
    env,
    "UPDATE streamlion_credit_orders_v1 SET payment_intent=?,revision=revision+1 WHERE order_id=? AND (payment_intent IS NULL OR payment_intent=?)",
    intent.id,
    order.order_id,
    intent.id,
  );
  const settled = await reconcileCredits(env, stripe, order.order_id);
  if (settled.status === "paid") return { credited: true };
  if (settled.status === "processing") return { processing: true };
  const code = intent.last_payment_error?.code || failure?.code;
  return code === "authentication_required"
    ? { authenticationRequired: true }
    : { declined: true };
}
async function forgetCard(env, mode, subject, paymentMethod) {
  await run(
    env,
    "UPDATE streamlion_credit_cards_v1 SET payment_method=NULL,brand=NULL,last4=NULL,exp_month=NULL,exp_year=NULL,updated_at=? WHERE mode=? AND google_subject=? AND payment_method=?",
    Date.now(),
    mode,
    subject,
    paymentMethod,
  );
}
// Removing a card always works, even while sales or saved cards are closed.
async function removeCard(env, stripe, identity, mode) {
  if (!(await cardsTable(env))) throw new Error("bad_request");
  await limited(env, "credits:" + identity.google_subject);
  const card = await savedCard(env, mode, identity.google_subject);
  if (card?.payment_method) {
    try {
      await stripe.paymentMethods.detach(card.payment_method);
    } catch (error) {
      if (
        !["resource_missing", "payment_method_unexpected_state"].includes(
          error?.code,
        )
      )
        throw error;
    }
    await forgetCard(env, mode, identity.google_subject, card.payment_method);
  }
  return { removed: true };
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
  let orderId, order, intentId;
  if (event.type.startsWith("checkout.session.")) {
    if (
      object.metadata?.app !== "streamlion" ||
      object.metadata?.kind !== "ai_credits"
    )
      return json({ received: true });
    orderId = object.metadata.order_id;
  } else {
    const intent = event.type.startsWith("payment_intent.")
      ? object.id
      : idOf(object.payment_intent);
    if (!intent) return json({ received: true });
    // Retrieve current metadata even when chargeback/refund precedes completion.
    const payment = await stripe.paymentIntents.retrieve(intent);
    if (
      payment.metadata?.app !== "streamlion" ||
      payment.metadata?.kind !== "ai_credits"
    )
      return json({ received: true });
    orderId = payment.metadata.order_id;
    intentId = payment.id;
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
    intentId,
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
    topup: "POST",
    card: "POST",
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
      const access = await checkoutQuoteAccess(request, env);
      const enabled = access.allowed && (await salesReady(env, mode));
      return json({
        enabled,
        savedCards:
          enabled &&
          checkoutTaxMode(env, true) === "off" &&
          (await cardsReady(env)),
        taxMode: checkoutTaxMode(env, true),
        businessUseRequired: true,
        checkoutMode: access.mode,
        mode,
        markupPercent: 30,
        projectMicros: await projectCharge(env, mode),
        ...(await featurePrices(env, mode)),
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
    if (
      ["checkout", "topup"].includes(path) &&
      !checkoutAccess(env, identity).allowed
    )
      return json(CHECKOUT_PAUSED, 403);
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
        card: (await cardsTable(env))
          ? cardView(await savedCard(env, mode, identity.google_subject))
          : null,
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
      return json(
        await checkout(
          env,
          stripe,
          identity,
          config,
          body.packId,
          body.saveCard,
          body.businessUse,
        ),
      );
    if (path === "topup")
      return json(await topup(env, stripe, identity, config, body.packId));
    if (path === "card") {
      if (body.action !== "remove") throw new Error("bad_request");
      return json(await removeCard(env, stripe, identity, mode));
    }
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
        businessReview: receipt.businessReview,
        credited: receipt.credited_micros > 0,
      });
    }
  } catch (error) {
    if (error instanceof RequestBodyError)
      return json({ error: error.message }, error.status);
    if (error.message === "business_consent")
      return json(
        {
          error:
            "Confirm that this purchase is for business or professional use.",
        },
        400,
      );
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
