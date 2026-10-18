// Derive the USD equivalent from the public pack catalog, not AI markup or a
// hard-coded exchange rate. Hide the estimate if the catalog cannot verify it.
export function projectCreditPrice(packs, projectMicros) {
  if (!Array.isArray(packs) || !packs.length) return null;
  if (!Number.isSafeInteger(projectMicros) || projectMicros <= 0) return null;
  const amounts = packs.map((pack) => {
    if (!pack || typeof pack !== "object" || Array.isArray(pack)) return NaN;
    if (
      !Number.isSafeInteger(pack.amount) ||
      pack.amount <= 0 ||
      !Number.isSafeInteger(pack.creditsMicros) ||
      pack.creditsMicros <= 0 ||
      !Number.isSafeInteger(projectMicros * pack.amount)
    )
      return NaN;
    return (projectMicros * pack.amount) / pack.creditsMicros;
  });
  if (
    amounts.some((amount) => !Number.isSafeInteger(amount) || amount <= 0) ||
    amounts.some((amount) => amount !== amounts[0])
  )
    return null;
  return amounts[0];
}

export const usd = (cents) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    currencyDisplay: "code",
  }).format(cents / 100);

// A short "credits | USD" label for an optional feature price. Prices below a
// cent or a fraction of a credit are rounded and marked as approximate.
export function priceLabels(packs, micros, creditMicros = 12500) {
  if (!Number.isSafeInteger(micros) || micros <= 0) return null;
  const credits = micros / creditMicros;
  const rounded = Math.round(credits * 10) / 10;
  const count = Number.isInteger(credits) ? credits : rounded;
  const creditText = `${Number.isInteger(credits) ? "" : "≈"}${count.toLocaleString("en-US")} ${count === 1 ? "credit" : "credits"}`;
  const exact = projectCreditPrice(packs, micros);
  if (exact !== null) return { credits: creditText, usd: usd(exact) };
  // Sub-cent prices: every pack must still agree on the same rate.
  const rates = Array.isArray(packs)
    ? packs.map((pack) =>
        Number.isSafeInteger(pack?.amount) &&
        pack.amount > 0 &&
        Number.isSafeInteger(pack?.creditsMicros) &&
        pack.creditsMicros > 0
          ? pack.amount / pack.creditsMicros
          : NaN,
      )
    : [];
  const consistent =
    rates.length > 0 &&
    rates.every((rate) => Number.isFinite(rate) && rate === rates[0]);
  return {
    credits: creditText,
    usd: consistent
      ? `≈${usd(Math.max(1, Math.round(micros * rates[0])))}`
      : null,
  };
}
