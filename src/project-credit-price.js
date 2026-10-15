import { CREDIT_UNIT, PROJECT_CREDITS } from "./client-workflow.js";

// Derive the USD equivalent from the public pack catalog, not AI markup or a
// hard-coded exchange rate. Hide the estimate if the catalog cannot verify it.
export function projectCreditPrice(packs) {
  if (!Array.isArray(packs) || !packs.length) return null;
  const projectMicros = PROJECT_CREDITS * CREDIT_UNIT;
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
