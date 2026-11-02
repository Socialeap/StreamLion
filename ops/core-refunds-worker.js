import {
  refundsEnabled,
  refundWorkerClient,
  processRefundQueue,
} from "../server/core-guarantee.js";
import { reconcile } from "../server/stripe-purchase.js";
export default {
  async scheduled(event, env) {
    if (!refundsEnabled(env)) return;
    const stripe = refundWorkerClient(env);
    if ((await stripe.accounts.retrieve()).id !== env.STRIPE_ACCOUNT_ID)
      throw Error("purchase_configuration");
    await processRefundQueue(env, stripe);
    // Reconcile succeeded/pending outcomes without relying solely on webhook
    // delivery. Keep retrying until the ledger agrees; never touch other orders.
    const { results } = await env.GOOGLE_SESSIONS.prepare(
      "SELECT r.order_id,p.checkout_session FROM streamlion_core_refund_requests_v1 r JOIN streamlion_purchases_v1 p ON p.order_id=r.order_id WHERE r.mode=? AND r.state IN('succeeded','pending','failed') AND p.status IN('paid','processing') ORDER BY r.updated_at LIMIT 10",
    )
      .bind(env.STREAMLION_PAYMENTS_MODE)
      .all();
    for (const r of results)
      await reconcile(env, stripe, r.order_id, r.checkout_session, true);
    console.log(
      JSON.stringify({
        service: "streamlion-core-refunds",
        checked: results.length,
      }),
    );
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
