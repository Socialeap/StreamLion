/** Shared buyer-facing guarantee. Requests are recorded in the support inbox;
 * Stripe alone establishes whether an actual refund has succeeded. */
export function coreRefundRequestText(days) {
  return `Request a full refund, including applicable tax, within ${days} days of successful payment. No usage or delivery condition. Requests received at the exact deadline qualify.`;
}

// Manual support review uses verified successful-payment time, never checkout
// creation, mutable ledger updated_at, staff processing time or local calendar days.
export function coreRefundWindow(paidAt, receivedAt, days = 14) {
  if (
    ![paidAt, receivedAt].every(Number.isSafeInteger) ||
    paidAt <= 0 ||
    receivedAt < paidAt ||
    ![7, 14, 30].includes(days)
  )
    throw new Error(
      "Verified payment and request-receipt timestamps are required.",
    );
  const deadline = paidAt + days * 86400000;
  if (!Number.isSafeInteger(deadline))
    throw new Error("Invalid refund deadline.");
  return { deadline, eligible: receivedAt <= deadline };
}
