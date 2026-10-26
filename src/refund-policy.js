/** Shared buyer-facing request condition for the Core purchase page and Stripe Checkout.
 * Eligibility is reviewed manually; this text does not approve or deny a refund. */
export function coreRefundRequestText(days) {
  return `Request a full refund within ${days} days of purchase and before your first project delivery through StreamLion.`;
}
