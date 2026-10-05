import Stripe from "stripe";
import { getSession, hash, googleConfigurationReady } from "./google-auth.js";
import {
  paymentMode,
  licenseRequired,
  hasPurchase,
} from "./purchase-access.js";
const API_VERSION = "2026-09-30.endive";
const LAUNCH_PLACES = 200;
const purchaseMethods = new Map([
  ["config", "GET"],
  ["status", "GET"],
  ["checkout", "POST"],
  ["confirm", "POST"],
  ["webhook", "POST"],
]);
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
const db = (env) => env.GOOGLE_SESSIONS;
const first = (env, sql, ...args) =>
  db(env)
    .prepare(sql)
    .bind(...args)
    .first();
const run = (env, sql, ...args) =>
  db(env)
    .prepare(sql)
    .bind(...args)
    .run();
const idOf = (value) => (typeof value === "string" ? value : value?.id);
function configuration(env) {
  const mode = paymentMode(env),
    origin = new URL(env.GOOGLE_AUTH_ORIGIN || "");
  if (
    !["test", "live"].includes(mode) ||
    !googleConfigurationReady(env) ||
    !db(env) ||
    origin.protocol !== "https:" ||
    origin.origin !== env.GOOGLE_AUTH_ORIGIN ||
    !new RegExp(`^(sk|rk)_${mode}_`).test(env.STRIPE_SECRET_KEY || "") ||
    !/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET || "") ||
    !/^acct_\w+$/.test(env.STRIPE_ACCOUNT_ID || "") ||
    !/^prod_\w+$/.test(env.STRIPE_PRODUCT_ID || "") ||
    !/^price_\w+$/.test(env.STRIPE_PRICE_ID || "") ||
    (env.STRIPE_LAUNCH_PRICE_ID &&
      !/^price_\w+$/.test(env.STRIPE_LAUNCH_PRICE_ID)) ||
    !["7", "14", "30"].includes(env.STREAMLION_REFUND_DAYS) ||
    (mode === "live" && env.STREAMLION_LIVE_PAYMENTS_APPROVED !== "true")
  )
    throw new Error("purchase_configuration");
  return {
    mode,
    origin: origin.origin,
    refundDays: Number(env.STREAMLION_REFUND_DAYS),
  };
}
function client(env) {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 12000,
  });
}
const accountChecks = new Map();
async function preflight(env, stripe) {
  const stamp = await first(
    env,
    "SELECT version FROM streamlion_purchase_schema_v2 WHERE version = 2",
  );
  if (!stamp) throw new Error("purchase_configuration");
  const cacheKey = env.STRIPE_SECRET_KEY + ":" + env.STRIPE_ACCOUNT_ID;
  const cached = accountChecks.get(cacheKey);
  if (cached && cached > Date.now()) return;
  const account = await stripe.accounts.retrieve();
  if (account.id !== env.STRIPE_ACCOUNT_ID)
    throw new Error("purchase_configuration");
  if (accountChecks.size >= 8) accountChecks.clear();
  accountChecks.set(cacheKey, Date.now() + 60000);
}
async function prices(env, stripe, mode) {
  const load = async (id) => {
    const p = await stripe.prices.retrieve(id, { expand: ["product"] });
    if (
      !p.active ||
      p.livemode !== (mode === "live") ||
      p.type !== "one_time" ||
      p.currency !== "usd" ||
      !Number.isSafeInteger(p.unit_amount) ||
      p.unit_amount <= 0 ||
      p.product?.id !== env.STRIPE_PRODUCT_ID ||
      !p.product.active ||
      p.product.metadata?.app !== "streamlion"
    )
      throw new Error("purchase_configuration");
    return p;
  };
  const standard = await load(env.STRIPE_PRICE_ID);
  const launch = env.STRIPE_LAUNCH_PRICE_ID
    ? await load(env.STRIPE_LAUNCH_PRICE_ID)
    : null;
  if (launch && launch.unit_amount >= standard.unit_amount)
    throw new Error("purchase_configuration");
  return { standard, launch };
}
// Quotes may share a short validated catalog; checkout always validates fresh
// prices. Do not cache purchase counts, entitlements or failed provider checks.
const quoteCatalogs = new Map();
async function quotePrices(env, stripe, mode) {
  const key = JSON.stringify([
    env.STRIPE_SECRET_KEY,
    env.STRIPE_ACCOUNT_ID,
    env.STRIPE_PRODUCT_ID,
    env.STRIPE_PRICE_ID,
    env.STRIPE_LAUNCH_PRICE_ID,
    mode,
  ]);
  const cached = quoteCatalogs.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  if (quoteCatalogs.size >= 8) quoteCatalogs.clear();
  const entry = { expires: Date.now() + 30000 };
  entry.promise = prices(env, stripe, mode).catch((error) => {
    if (quoteCatalogs.get(key) === entry) quoteCatalogs.delete(key);
    throw error;
  });
  quoteCatalogs.set(key, entry);
  return entry.promise;
}
async function boundedJSON(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("bad_request");
  let size = 0,
    chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2048) {
      await reader.cancel();
      throw new Error("bad_request");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const c of chunks) {
    bytes.set(c, pos);
    pos += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("bad_request");
  }
}
async function limited(env, subject, maximum = 10) {
  const now = Date.now(),
    window = Math.floor(now / 60000);
  const identity = await hash(`purchase:${paymentMode(env)}:${subject}`);
  const result = await first(
    env,
    `INSERT INTO streamlion_purchase_limits_v1(identity, window, count) VALUES (?, ?, 1)
    ON CONFLICT(identity) DO UPDATE SET window=excluded.window,
    count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END RETURNING count`,
    identity,
    window,
  );
  await run(
    env,
    "DELETE FROM streamlion_purchase_limits_v1 WHERE window < ?",
    window - 1440,
  );
  if (result.count > maximum) throw new Error("purchase_limit");
}
export function validateCheckout(session, order) {
  const lines = session.line_items?.data;
  if (
    session.mode !== "payment" ||
    session.livemode !== (order.mode === "live") ||
    session.metadata?.app !== "streamlion" ||
    session.metadata?.order_id !== order.order_id ||
    session.client_reference_id !== order.order_id ||
    (order.checkout_session && order.checkout_session !== session.id) ||
    session.currency !== order.currency ||
    session.amount_subtotal !== order.amount ||
    session.total_details?.amount_discount !== 0 ||
    session.line_items?.has_more ||
    lines?.length !== 1 ||
    lines[0].quantity !== 1 ||
    lines[0].price?.id !== order.price_id ||
    idOf(lines[0].price?.product) !== order.product_id
  )
    throw new Error("purchase_mismatch");
}
// Read current Stripe state, rather than trusting the age/order of event payloads.
// CAS prevents a delayed completion read from overwriting a concurrent refund write.
export async function reconcile(env, stripe, orderId, sessionId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const order = await first(
      env,
      "SELECT * FROM streamlion_purchases_v1 WHERE order_id = ?",
      orderId,
    );
    if (!order) throw new Error("purchase_mismatch");
    const session = await stripe.checkout.sessions.retrieve(
      sessionId || order.checkout_session,
      { expand: ["line_items", "payment_intent.latest_charge"] },
    );
    validateCheckout(session, order);
    const intent = session.payment_intent;
    let status =
      session.status === "expired"
        ? "expired"
        : session.status === "complete"
          ? ["canceled", "requires_payment_method"].includes(intent?.status)
            ? "failed"
            : "processing"
          : "pending";
    let refunded = 0;
    if (session.payment_status === "paid") {
      const charge = intent?.latest_charge;
      if (
        intent?.status !== "succeeded" ||
        intent.livemode !== session.livemode ||
        intent.metadata?.app !== "streamlion" ||
        intent.metadata?.order_id !== orderId ||
        !charge ||
        !charge.paid ||
        !charge.captured ||
        charge.currency !== order.currency ||
        charge.amount < order.amount
      )
        throw new Error("purchase_mismatch");
      refunded = charge.amount_refunded || 0;
      status = refunded >= charge.amount ? "refunded" : "paid";
      if (charge.disputed) {
        const disputes = await stripe.disputes.list({
          payment_intent: intent.id,
          limit: 100,
        });
        if (
          disputes.has_more ||
          !disputes.data.length ||
          disputes.data.some((d) => d.status !== "won")
        )
          status = "disputed";
      }
    }
    const saved = await run(
      env,
      `UPDATE streamlion_purchases_v1 SET checkout_session=?, payment_intent=?,
      status=?, amount_refunded=?, updated_at=?, revision=revision+1,
      promo_slot=CASE WHEN ? IN ('expired','failed') THEN NULL ELSE promo_slot END
      WHERE order_id=? AND revision=?`,
      session.id,
      idOf(intent) || null,
      status,
      refunded,
      Date.now(),
      status,
      orderId,
      order.revision,
    );
    if (saved.meta.changes)
      return { ...order, status, amount_refunded: refunded };
  }
  throw new Error("purchase_busy");
}
async function createCheckout(env, stripe, identity, config) {
  if (await hasPurchase(env, identity.google_subject))
    return { purchased: true };
  await limited(env, identity.google_subject);
  const catalog = await prices(env, stripe, config.mode);
  await run(
    env,
    "UPDATE streamlion_purchases_v1 SET status='expired',promo_slot=NULL,revision=revision+1 WHERE mode=? AND checkout_session IS NULL AND status='pending' AND expires_at <= ?",
    config.mode,
    Date.now(),
  );
  let order = await first(
    env,
    `SELECT * FROM streamlion_purchases_v1 WHERE mode=? AND google_subject=?
    AND status IN ('pending','processing')`,
    config.mode,
    identity.google_subject,
  );
  if (order?.checkout_session) {
    order = await reconcile(
      env,
      stripe,
      order.order_id,
      order.checkout_session,
    );
    if (order.status === "paid") return { purchased: true };
    if (order.status === "processing") return { processing: true };
    if (order.status === "pending") {
      const saved = await first(
        env,
        "SELECT checkout_url FROM streamlion_purchases_v1 WHERE order_id=?",
        order.order_id,
      );
      if (saved.checkout_url) return { url: saved.checkout_url };
    } else order = null;
  }
  if (!order) {
    const now = Date.now(),
      orderId = crypto.randomUUID();
    // Reserve at most 200 launch slots in the same atomic INSERT. Pending and
    // delayed payments hold their slots; only confirmed expiry/failure frees one.
    await run(
      env,
      `WITH RECURSIVE slots(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM slots WHERE n<${LAUNCH_PLACES}),
      candidate AS (SELECT MIN(n) AS slot FROM slots WHERE NOT EXISTS
        (SELECT 1 FROM streamlion_purchases_v1 WHERE mode=? AND promo_slot=n))
      INSERT OR IGNORE INTO streamlion_purchases_v1
        (order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,promo_slot,status,created_at,expires_at,updated_at)
      SELECT ?,?,?,?,CASE WHEN ? AND slot IS NOT NULL THEN ? ELSE ? END,?,
        CASE WHEN ? AND slot IS NOT NULL THEN ? ELSE ? END,'usd',
        CASE WHEN ? THEN slot ELSE NULL END,'pending',?,?,? FROM candidate WHERE NOT EXISTS (SELECT 1 FROM streamlion_purchases_v1 WHERE mode=? AND google_subject=? AND status='paid')`,
      config.mode,
      orderId,
      config.mode,
      identity.google_subject,
      identity.email,
      catalog.launch ? 1 : 0,
      catalog.launch?.id || "",
      catalog.standard.id,
      env.STRIPE_PRODUCT_ID,
      catalog.launch ? 1 : 0,
      catalog.launch?.unit_amount || 0,
      catalog.standard.unit_amount,
      catalog.launch ? 1 : 0,
      now,
      now + 3600000,
      now,
      config.mode,
      identity.google_subject,
    );
    order = await first(
      env,
      `SELECT * FROM streamlion_purchases_v1 WHERE mode=? AND google_subject=?
      AND status IN ('pending','processing')`,
      config.mode,
      identity.google_subject,
    );
    if (!order) {
      if (await hasPurchase(env, identity.google_subject))
        return { purchased: true };
      throw new Error("purchase_busy");
    }
  }
  const params = {
    mode: "payment",
    client_reference_id: order.order_id,
    customer_email: order.checkout_email,
    line_items: [{ price: order.price_id, quantity: 1 }],
    metadata: { app: "streamlion", order_id: order.order_id },
    payment_intent_data: {
      statement_descriptor_suffix: "STREAMLION",
      metadata: { app: "streamlion", order_id: order.order_id },
    },
    expires_at: Math.floor(order.expires_at / 1000),
    success_url:
      config.origin + "/api/purchase?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: config.origin + "/api/purchase?cancelled=1",
    consent_collection: { terms_of_service: "required" },
    branding_settings: {
      display_name: "StreamLion by Frontiers|3D",
      button_color: "#194f39",
    },
    custom_text: {
      terms_of_service_acceptance: {
        message: `I agree to the [StreamLion purchase terms](${config.origin}/api/terms).`,
      },
      submit: {
        message: `One-time StreamLion purchase. No subscription. Request a full refund within ${config.refundDays} days of purchase: info@transcendencemedia.com. Use the same Google account to restore access.`,
      },
    },
  };
  const session = await stripe.checkout.sessions.create(params, {
    idempotencyKey: `streamlion:${config.mode}:${order.order_id}`,
  });
  if (
    session.livemode !== (config.mode === "live") ||
    !session.url ||
    new URL(session.url).origin !== "https://checkout.stripe.com"
  )
    throw new Error("purchase_mismatch");
  await run(
    env,
    `UPDATE streamlion_purchases_v1 SET checkout_session=?,checkout_url=?,revision=revision+1
    WHERE order_id=? AND (checkout_session IS NULL OR checkout_session=?)`,
    session.id,
    session.url,
    order.order_id,
    session.id,
  );
  if (session.status === "expired") {
    await reconcile(env, stripe, order.order_id, session.id);
    throw new Error("purchase_busy");
  }
  return { url: session.url };
}
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
async function webhook(request, env, stripe, config) {
  // Authenticate locally before any database or provider preflight. Unsigned
  // requests must not consume upstream capacity, even on a cold edge isolate.
  if (!request.headers.get("Stripe-Signature"))
    return json({ error: "Invalid event signature." }, 400);
  // Check body length while reading: chunked requests may omit Content-Length.
  const reader = request.body?.getReader();
  let size = 0,
    chunks = [];
  if (!reader) return json({ error: "Invalid event." }, 400);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 256 * 1024) {
      await reader.cancel();
      return json({ error: "Event too large." }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      new TextDecoder().decode(bytes),
      request.headers.get("Stripe-Signature"),
      env.STRIPE_WEBHOOK_SECRET,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json({ error: "Invalid event signature." }, 400);
  }
  if (event.livemode !== (config.mode === "live"))
    return json({ error: "Wrong payment environment." }, 400);
  if (!EVENTS.has(event.type)) return json({ received: true });
  await preflight(env, stripe);
  if (
    await first(
      env,
      "SELECT event_id FROM streamlion_stripe_events_v1 WHERE event_id=?",
      event.id,
    )
  )
    return json({ received: true });
  const object = event.data.object;
  let order;
  if (event.type.startsWith("checkout.session.")) {
    if (object.metadata?.app !== "streamlion") return json({ received: true });
    order = await first(
      env,
      "SELECT * FROM streamlion_purchases_v1 WHERE order_id=?",
      object.metadata.order_id,
    );
  } else {
    const intent = idOf(object.payment_intent);
    if (!intent) return json({ received: true });
    order = await first(
      env,
      "SELECT * FROM streamlion_purchases_v1 WHERE payment_intent=?",
      intent,
    );
    if (!order) {
      const payment = await stripe.paymentIntents.retrieve(intent);
      if (payment.metadata?.app !== "streamlion")
        return json({ received: true });
      order = await first(
        env,
        "SELECT * FROM streamlion_purchases_v1 WHERE order_id=?",
        payment.metadata.order_id,
      );
    }
  }
  // A recognized but not yet linked StreamLion order is retried, not swallowed.
  if (!order || order.mode !== config.mode)
    throw new Error("purchase_mismatch");
  await reconcile(
    env,
    stripe,
    order.order_id,
    event.type.startsWith("checkout.session.")
      ? object.id
      : order.checkout_session,
  );
  await run(
    env,
    "INSERT OR IGNORE INTO streamlion_stripe_events_v1 VALUES (?,?,?,?)",
    event.id,
    config.mode,
    event.type,
    Date.now(),
  );
  return json({ received: true });
}
export async function handlePurchase({ request, env, params }) {
  const path = (params.path || []).join("/"),
    mode = paymentMode(env),
    required = licenseRequired(env);
  if (mode === "disabled")
    return json(
      { enabled: false, required, purchased: false },
      path === "webhook" || required ? 503 : 200,
    );
  const method = purchaseMethods.get(path);
  if (!method) return json({ error: "Not found." }, 404);
  if (request.method !== method) {
    const response = json({ error: "Method not allowed." }, 405);
    response.headers.set("Allow", method);
    return response;
  }
  // Turning on test setup must not enforce purchases for current testers.
  // Price/key setup failures affect checkout; the explicit license flag controls access.
  if (path === "status" && request.method === "GET" && !required) {
    let identity = null,
      purchased = false;
    try {
      identity = await getSession(request, env);
      purchased = identity
        ? await hasPurchase(env, identity.google_subject)
        : false;
    } catch {
      /* purchase setup is optional until enforcement is enabled */
    }
    return json({
      enabled: ["test", "live"].includes(mode),
      required: false,
      mode,
      connected: Boolean(identity),
      ...(identity
        ? { account: identity.email, subject: identity.google_subject }
        : {}),
      purchased,
    });
  }
  try {
    const config = configuration(env),
      url = new URL(request.url);
    if (url.origin !== config.origin)
      return json({ error: "Use the StreamLion address." }, 403);
    const stripe = client(env);
    if (path === "config" && request.method === "GET") {
      // Reject an exhausted network before it can consume other clients' budget.
      await limited(
        env,
        "quote:" + (request.headers.get("CF-Connecting-IP") || "unknown"),
        60,
      );
      await limited(env, "quote:global", 200);
    }
    if (path === "status" && request.method === "GET") {
      const identity = await getSession(request, env);
      return json({
        enabled: true,
        required,
        mode,
        connected: Boolean(identity),
        ...(identity
          ? { account: identity.email, subject: identity.google_subject }
          : {}),
        purchased: identity
          ? await hasPurchase(env, identity.google_subject)
          : false,
      });
    }
    if (path === "webhook" && request.method === "POST")
      return await webhook(request, env, stripe, config);
    if (path === "config" && request.method === "GET") {
      await preflight(env, stripe);
      const catalog = await quotePrices(env, stripe, mode);
      const used = await first(
        env,
        "SELECT COUNT(*) AS count FROM streamlion_purchases_v1 WHERE mode=? AND promo_slot IS NOT NULL",
        mode,
      );
      const launch = catalog.launch && used.count < LAUNCH_PLACES;
      return json({
        enabled: true,
        required,
        mode,
        currency: "usd",
        amount: launch
          ? catalog.launch.unit_amount
          : catalog.standard.unit_amount,
        standardAmount: catalog.standard.unit_amount,
        launchRemaining: catalog.launch
          ? Math.max(0, LAUNCH_PLACES - used.count)
          : 0,
        launchCapacity: LAUNCH_PLACES,
        refundDays: config.refundDays,
      });
    }
    const identity = await getSession(request, env);
    if (!identity)
      return json(
        { enabled: true, required, mode, connected: false, purchased: false },
        request.method === "GET" ? 200 : 401,
      );
    if (
      request.method !== "GET" &&
      (request.headers.get("Origin") !== config.origin ||
        request.headers.get("X-StreamLion-Account") !== identity.google_subject)
    )
      return json({ error: "Your account changed. Reopen this page." }, 403);
    await preflight(env, stripe);
    if (path === "checkout" && request.method === "POST")
      return json(await createCheckout(env, stripe, identity, config));
    if (path === "confirm" && request.method === "POST") {
      const body = await boundedJSON(request);
      if (!/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(body.sessionId || ""))
        throw new Error("bad_request");
      const order = await first(
        env,
        "SELECT * FROM streamlion_purchases_v1 WHERE checkout_session=? AND mode=? AND google_subject=?",
        body.sessionId,
        mode,
        identity.google_subject,
      );
      if (!order)
        return json(
          {
            error:
              "This purchase belongs to another account. Sign in with the Google account used at checkout.",
          },
          403,
        );
      await limited(env, identity.google_subject);
      const receipt = await reconcile(
        env,
        stripe,
        order.order_id,
        order.checkout_session,
      );
      return json({
        purchased: await hasPurchase(env, identity.google_subject),
        status: receipt.status,
      });
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    // Never send Stripe errors, request details, or secrets to clients/logs.
    if (error.message === "bad_request")
      return json({ error: "Invalid request." }, 400);
    if (error.message === "purchase_limit")
      return json({ error: "Please wait a minute before trying again." }, 429);
    return json(
      {
        enabled: true,
        required,
        error:
          "Purchases could not be verified. Please try again. Your project records are safe.",
      },
      503,
    );
  }
}
