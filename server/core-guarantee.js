import Stripe from "stripe";
import { coreRefundWindow } from "../src/refund-policy.js";
export const CORE_OFFER = "payment-14-days-unconditional-v1";
const one = (env, sql, ...values) =>
  env.GOOGLE_SESSIONS.prepare(sql)
    .bind(...values)
    .first();
const run = (env, sql, ...values) =>
  env.GOOGLE_SESSIONS.prepare(sql)
    .bind(...values)
    .run();
export const refundsEnabled = (env) =>
  env.STREAMLION_CORE_REFUNDS_ENABLED === "true";
export async function guaranteeSchema(env) {
  if (
    !(await one(
      env,
      "SELECT version FROM streamlion_core_guarantee_schema_v1 WHERE version=1",
    ))
  )
    throw Error("purchase_configuration");
}
export async function guaranteeStatus(env, mode, subject) {
  if (!refundsEnabled(env)) return null;
  await guaranteeSchema(env);
  const order = await one(
    env,
    "SELECT * FROM streamlion_purchases_v1 WHERE mode=? AND google_subject=? AND core_offer=? ORDER BY created_at DESC LIMIT 1",
    mode,
    subject,
    CORE_OFFER,
  );
  if (!order) return null;
  const request = await one(
    env,
    "SELECT * FROM streamlion_core_refund_requests_v1 WHERE order_id=?",
    order.order_id,
  );
  return {
    orderId: order.order_id,
    paidAt: order.paid_at,
    deadline: order.paid_at
      ? order.paid_at + order.refund_days * 86400000
      : null,
    canRequest:
      (order.status === "paid" ||
        (order.status === "processing" && !!order.paid_at)) &&
      !request,
    state: request?.state || null,
    receivedAt: request?.received_at || null,
  };
}
// A duplicate preserves the original receipt time, including when processing is late.
export async function recordRefundRequest(env, mode, subject, receivedAt) {
  if (!refundsEnabled(env)) throw Error("purchase_configuration");
  await guaranteeSchema(env);
  const order = await one(
    env,
    "SELECT * FROM streamlion_purchases_v1 WHERE mode=? AND google_subject=? AND core_offer=? ORDER BY created_at DESC LIMIT 1",
    mode,
    subject,
    CORE_OFFER,
  );
  if (!order) throw Error("purchase_mismatch");
  const existing = await one(
    env,
    "SELECT * FROM streamlion_core_refund_requests_v1 WHERE order_id=?",
    order.order_id,
  );
  if (existing && receivedAt >= existing.received_at) return order.order_id;
  if (
    order.status !== "paid" &&
    !(order.status === "processing" && order.paid_at)
  )
    throw Error("purchase_mismatch");
  const state =
    order.paid_at &&
    !coreRefundWindow(order.paid_at, receivedAt, order.refund_days).eligible
      ? "ineligible"
      : "requested";
  await run(
    env,
    "INSERT INTO streamlion_core_refund_requests_v1(order_id,mode,received_at,state,next_attempt_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET received_at=MIN(received_at,excluded.received_at),state=CASE WHEN excluded.received_at<received_at AND state='ineligible' THEN excluded.state ELSE state END,next_attempt_at=MIN(next_attempt_at,excluded.next_attempt_at)",
    order.order_id,
    mode,
    receivedAt,
    state,
    receivedAt,
    receivedAt,
  );
  return order.order_id;
}
export async function recordSuccessfulPayment(env, orderId, paidAt) {
  if (
    !Number.isSafeInteger(paidAt) ||
    paidAt <= 0 ||
    paidAt > Date.now() + 300000
  )
    throw Error("purchase_mismatch");
  // Only new offer rows use the new deadline. Historical policy stays untouched.
  await run(
    env,
    "UPDATE streamlion_purchases_v1 SET paid_at=COALESCE(paid_at,?) WHERE order_id=? AND core_offer=?",
    paidAt,
    orderId,
    CORE_OFFER,
  );
}
// No customer/browser-supplied amount, policy, identity or timestamp reaches Stripe.
// The queue is retried by a dedicated scheduled Worker; no owner must initiate it.
export async function processRefundRequest(
  env,
  stripe,
  orderId,
  now = Date.now(),
) {
  const r = await one(
    env,
    "SELECT r.*,p.google_subject,p.core_offer,p.refund_days,p.paid_at,p.checkout_session,p.payment_intent FROM streamlion_core_refund_requests_v1 r JOIN streamlion_purchases_v1 p ON p.order_id=r.order_id WHERE r.order_id=?",
    orderId,
  );
  if (
    !r ||
    !refundsEnabled(env) ||
    r.state === "succeeded" ||
    r.state === "ineligible" ||
    r.next_attempt_at > now
  )
    return;
  // A five-minute conditional lease prevents concurrent handlers/cron runs from
  // changing one request. Stripe deduplicates the external side effect separately.
  const lease = await run(
    env,
    "UPDATE streamlion_core_refund_requests_v1 SET next_attempt_at=?,attempts=attempts+1,updated_at=? WHERE order_id=? AND next_attempt_at=? AND state IN('requested','pending','failed')",
    now + 300000,
    now,
    orderId,
    r.next_attempt_at,
  );
  if (!lease.meta.changes) return;
  let state = r.state,
    refundId = r.refund_id,
    error = "";
  try {
    if (!r.paid_at) throw Error("payment_time_unverified");
    if (!coreRefundWindow(r.paid_at, r.received_at, r.refund_days).eligible)
      state = "ineligible";
    else {
      const session = await stripe.checkout.sessions.retrieve(
        r.checkout_session,
        { expand: ["payment_intent.latest_charge"] },
      );
      const intent = session.payment_intent,
        charge = intent?.latest_charge;
      if (
        session.livemode !== (r.mode === "live") ||
        session.payment_status !== "paid" ||
        intent?.status !== "succeeded" ||
        intent.id !== r.payment_intent ||
        intent.metadata?.app !== "streamlion" ||
        intent.metadata?.order_id !== orderId ||
        charge?.livemode !== session.livemode ||
        !charge?.paid ||
        !charge.captured ||
        charge.currency !== "usd" ||
        !Number.isSafeInteger(charge.amount) ||
        charge.amount !== session.amount_total ||
        charge.disputed
      )
        throw Error("refund_verification_required");
      const list = await stripe.refunds.list({ charge: charge.id, limit: 100 });
      if (list.has_more) throw Error("refund_verification_required");
      let succeeded = 0,
        pending = 0,
        own;
      for (const refund of list.data) {
        if (
          (typeof refund.charge === "string"
            ? refund.charge
            : refund.charge?.id) !== charge.id ||
          refund.currency !== charge.currency ||
          !Number.isSafeInteger(refund.amount) ||
          refund.amount <= 0
        )
          throw Error("refund_verification_required");
        if (refund.status === "succeeded") succeeded += refund.amount;
        if (["pending", "requires_action"].includes(refund.status))
          pending += refund.amount;
        if (refund.metadata?.streamlion_refund_request === orderId)
          own = refund;
      }
      if (own) refundId = own.id;
      if (succeeded >= charge.amount) state = "succeeded";
      else if (own) {
        state =
          own.status === "succeeded"
            ? succeeded >= charge.amount
              ? "succeeded"
              : "failed"
            : ["pending", "requires_action"].includes(own.status)
              ? "pending"
              : "failed";
        error =
          state === "failed"
            ? "stripe_refund_failed"
            : own.status === "requires_action"
              ? "stripe_action_required"
              : own.pending_reason === "insufficient_funds"
                ? "insufficient_funds"
                : "";
      } else if (pending) {
        state = "pending";
        error = "existing_refund_pending";
      } else {
        const refund = await stripe.refunds.create(
          {
            payment_intent: intent.id,
            amount: charge.amount - succeeded,
            metadata: { app: "streamlion", streamlion_refund_request: orderId },
          },
          {
            idempotencyKey: "streamlion:core-refund:" + r.mode + ":" + orderId,
          },
        );
        if (
          !refund.id ||
          (typeof refund.charge === "string"
            ? refund.charge
            : refund.charge?.id) !== charge.id ||
          refund.currency !== charge.currency ||
          refund.amount !== charge.amount - succeeded ||
          ![
            "succeeded",
            "pending",
            "requires_action",
            "failed",
            "canceled",
          ].includes(refund.status)
        )
          throw Error("refund_verification_required");
        refundId = refund.id;
        state =
          refund.status === "succeeded"
            ? "succeeded"
            : ["pending", "requires_action"].includes(refund.status)
              ? "pending"
              : "failed";
        error =
          state === "failed"
            ? "stripe_refund_failed"
            : refund.status === "requires_action"
              ? "stripe_action_required"
              : refund.pending_reason === "insufficient_funds"
                ? "insufficient_funds"
                : "";
      }
    }
  } catch (e) {
    state = "failed";
    error = [
      "payment_time_unverified",
      "refund_verification_required",
    ].includes(e.message)
      ? e.message
      : "stripe_request_failed";
  }
  await run(
    env,
    "UPDATE streamlion_core_refund_requests_v1 SET state=?,refund_id=?,error=?,updated_at=?,next_attempt_at=? WHERE order_id=? AND updated_at=?",
    state,
    refundId || null,
    error,
    now,
    now + 300000,
    orderId,
    now,
  );
  return { state, error };
}
export async function processRefundQueue(env, stripe, now = Date.now()) {
  if (!refundsEnabled(env)) return { checked: 0 };
  await guaranteeSchema(env);
  const mode = env.STREAMLION_PAYMENTS_MODE;
  if (!["test", "live"].includes(mode)) throw Error("purchase_configuration");
  const { results } = await env.GOOGLE_SESSIONS.prepare(
    "SELECT order_id FROM streamlion_core_refund_requests_v1 WHERE mode=? AND state IN('requested','pending','failed') AND next_attempt_at<=? ORDER BY next_attempt_at,received_at LIMIT 10",
  )
    .bind(mode, now)
    .all();
  for (const r of results)
    await processRefundRequest(env, stripe, r.order_id, now);
  return { checked: results.length };
}
export function refundWorkerClient(env) {
  if (
    !["test", "live"].includes(env.STREAMLION_PAYMENTS_MODE) ||
    !new RegExp("^(sk|rk)_" + env.STREAMLION_PAYMENTS_MODE + "_").test(
      env.STRIPE_SECRET_KEY || "",
    ) ||
    !/^acct_\w+$/.test(env.STRIPE_ACCOUNT_ID || "")
  )
    throw Error("purchase_configuration");
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-08-26.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
    timeout: 12000,
  });
}
