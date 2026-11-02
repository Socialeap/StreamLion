// Explicit commercial configuration, independent of pilot limits and tax dates.
// Missing/invalid dates never open sales. Existing orders keep their saved price.
export function coreOffer(env, now = Date.now()) {
  const text = env.STREAMLION_CORE_PROMOTION_END;
  const endsAt =
    typeof text === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)
      ? Date.parse(text)
      : NaN;
  if (
    !Number.isSafeInteger(endsAt) ||
    new Date(endsAt).toISOString() !== text ||
    !["standard", "paused"].includes(env.STREAMLION_CORE_AFTER_PROMOTION)
  )
    throw Error("purchase_configuration");
  const phase =
    now < endsAt ? "promotion" : env.STREAMLION_CORE_AFTER_PROMOTION;
  return {
    endsAt,
    phase,
    amount: phase === "promotion" ? 2995 : 3995,
    available: phase !== "paused",
  };
}
