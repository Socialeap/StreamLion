// Synthetic snapshot envelopes, signed by the real SDK in the handler suites.
// Incoming snapshot versions are independent of the outgoing request pin.
export const STRIPE_REQUEST_VERSION = "2026-08-26.dahlia";
export const STRIPE_SNAPSHOT_VERSIONS = [
  "2026-08-26.dahlia",
  "2026-09-30.endive",
];
export const CURRENT_STRIPE_SNAPSHOT_VERSION = "2026-09-30.endive";
export const STRIPE_CHECKOUT_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
];

export function stripeSnapshot(event) {
  return {
    object: "event",
    api_version: CURRENT_STRIPE_SNAPSHOT_VERSION,
    created: Math.floor(Date.now() / 1000),
    pending_webhooks: 1,
    request: null,
    ...event,
  };
}
