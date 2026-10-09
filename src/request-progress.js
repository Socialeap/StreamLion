export function requestProgress(job, link, activity = [], client = false) {
  const submitted = Boolean(
    job.accepted ||
    job.submittedAt ||
    activity.some((e) => e.label === "Request submitted") ||
    [
      "submitted",
      "awaiting_agreement",
      "activation_pending",
      "confirmed",
      "in_progress",
      "work_completed",
      "delivered",
      "closed",
    ].includes(job.state),
  );
  const opened = Boolean(
    job.openedAt ||
    link?.openedAt ||
    link?.claimedAt ||
    client ||
    activity.some((e) => e.actor === "client"),
  );
  const fields = job.fields;
  const totalText =
    fields.invoiceAmount ||
    fields.agreedFee ||
    (job.accepted ? fields.offeredFee : "");
  const total = totalText === "" ? null : Number(totalText),
    paid = Number(fields.paidAmount || 0);
  const paidInFull =
    total !== null &&
    Number.isFinite(total) &&
    total >= 0 &&
    (total === 0
      ? Boolean(job.accepted)
      : paid >= total && Boolean(fields.paidDate));
  return [
    {
      key: "open",
      label: "Link opened",
      done: opened,
      detail: opened
        ? job.source === "public-form"
          ? job.emailVerified
            ? "Form opened · email confirmed"
            : "Form opened · email confirmation not required"
          : link?.claimedAt || client
            ? "Verified client access"
            : "Form opened · visitor unverified"
        : link
          ? "Waiting for first form open"
          : "No recorded client open yet",
    },
    {
      key: "submit",
      label: "Request submitted",
      done: submitted,
      detail: submitted
        ? "Request received for review"
        : "Waiting for the client's request",
    },
    {
      key: "agree",
      label: "Agreement",
      done: Boolean(job.accepted),
      detail: job.accepted
        ? "Both parties approved"
        : "Scope and schedule need approval",
    },
    {
      key: "work",
      label: "Work completed",
      done: Boolean(
        job.accepted &&
        ["work_completed", "delivered", "closed"].includes(job.state),
      ),
      detail:
        job.state === "in_progress"
          ? "Work is in progress"
          : job.accepted &&
              ["work_completed", "delivered", "closed"].includes(job.state)
            ? "Provider reported completion"
            : "Awaiting provider completion",
    },
    {
      key: "payment",
      label: "Payment",
      done: paidInFull,
      detail: paidInFull
        ? total === 0
          ? "No payment due · agreed terms"
          : "Paid in full · provider-reported"
        : paid > 0
          ? "Partial / unfinalized · provider-reported"
          : "No confirmed payment record",
    },
    {
      key: "delivery",
      label: "Delivery",
      done: Boolean(
        job.accepted && ["delivered", "closed"].includes(job.state),
      ),
      detail: job.deliveryAccepted
        ? "Client acknowledged receipt"
        : job.state === "closed"
          ? "Delivery recorded · provider closure"
          : job.state === "delivered"
            ? "Sent · client acknowledgment pending"
            : "Delivery not recorded",
    },
    {
      key: "final",
      label: "Finalized",
      done: job.state === "closed",
      detail:
        job.state === "closed"
          ? "Closed · record retained"
          : "Closure and follow-up pending",
    },
  ];
}
