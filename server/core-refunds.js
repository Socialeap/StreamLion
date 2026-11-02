const id = (value) => (typeof value === "string" ? value : value?.id);
// Charge summaries can include refunds still pending. Only current, verified
// succeeded Refund objects count toward revocation; never trust an event snapshot.
export async function verifiedCoreRefunds(
  stripe,
  charge,
  livemode,
  inspect = false,
) {
  const reported = charge.amount_refunded || 0;
  if (
    !Number.isSafeInteger(reported) ||
    reported < 0 ||
    reported > charge.amount
  )
    throw new Error("purchase_mismatch");
  if (!reported && !inspect) return { amount: 0, state: "none" };
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  if (refunds.has_more || !Array.isArray(refunds.data))
    throw new Error("purchase_mismatch");
  let amount = 0,
    pending = false,
    failed = false;
  const seen = new Set();
  for (const refund of refunds.data) {
    if (
      !refund.id ||
      seen.has(refund.id) ||
      id(refund.charge) !== charge.id ||
      refund.livemode !== livemode ||
      refund.currency !== charge.currency ||
      !Number.isSafeInteger(refund.amount) ||
      refund.amount <= 0 ||
      ![
        "succeeded",
        "pending",
        "requires_action",
        "failed",
        "canceled",
      ].includes(refund.status)
    )
      throw new Error("purchase_mismatch");
    seen.add(refund.id);
    if (refund.status === "succeeded") amount += refund.amount;
    if (["pending", "requires_action"].includes(refund.status)) pending = true;
    if (["failed", "canceled"].includes(refund.status)) failed = true;
  }
  if (
    !Number.isSafeInteger(amount) ||
    amount > charge.amount ||
    (reported && !refunds.data.length)
  )
    throw new Error("purchase_mismatch");
  return {
    amount,
    state:
      amount === charge.amount
        ? "succeeded"
        : pending
          ? "pending"
          : failed
            ? "failed"
            : amount
              ? "partial"
              : "none",
  };
}
