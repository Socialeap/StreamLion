// Shared deterministic estimate math. Rates use 1/10,000 currency units;
// quantities use hundredths. Round each line once, to the nearest cent.
export const PRICING_METHODS = {
  quote: "Provider prepares a quote",
  area: "One rate per square foot",
  whole: "Tier rate for the whole area",
  progressive: "Progressive area bands",
  flat: "Flat fee by area range",
};
export const blankPricing = () => ({
  schemaVersion: 1,
  currency: "USD",
  method: "quote",
  rate: "0.15",
  tiers: [
    { upTo: "5000", price: "0.15" },
    { upTo: "", price: "0.12" },
  ],
  extras: [],
  allowBudget: false,
});
export const tmPricingSample = () => ({
  ...blankPricing(),
  method: "whole",
  tiers: [
    { upTo: "5000", price: "0.15" },
    { upTo: "19999", price: "0.12" },
    { upTo: "", price: "0.10" },
  ],
  extras: [
    {
      id: "creative-direction",
      name: "Creative Direction",
      unit: "hour",
      price: "150",
      required: false,
      maxQuantity: "100",
      defaultQuantity: "6",
    },
  ],
});
const fail = (message) => {
  throw new Error(message);
};
const text = (v, n, label) => {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > n ||
    /[\x00-\x1f\x7f]/.test(v)
  )
    fail(`Enter a valid ${label}.`);
  return v.trim();
};
export function decimalUnits(value, places = 4, max = 1000000) {
  const s = String(value ?? "");
  if (!new RegExp(`^\\d{1,9}(?:\\.\\d{1,${places}})?$`).test(s))
    fail(`Use a non-negative number with up to ${places} decimal places.`);
  const [whole, fraction = ""] = s.split("."),
    scale = 10n ** BigInt(places),
    units = BigInt(whole) * scale + BigInt(fraction.padEnd(places, "0"));
  if (units > BigInt(max) * scale) fail("The amount or quantity is too large.");
  return units;
}
export function validatePricing(input) {
  if (
    !input ||
    input.schemaVersion !== 1 ||
    !Object.hasOwn(PRICING_METHODS, input.method)
  )
    fail("Choose a supported pricing method.");
  const currency = text(input.currency, 3, "currency code").toUpperCase();
  let options;
  try {
    options = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions();
  } catch {
    fail("Enter a valid currency code.");
  }
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    options.maximumFractionDigits !== 2 ||
    (typeof Intl.supportedValuesOf === "function" &&
      !Intl.supportedValuesOf("currency").includes(currency))
  )
    fail("Choose a currency that uses two decimal places.");
  if (typeof input.allowBudget !== "boolean")
    fail("Choose whether clients may propose a budget.");
  const rate = String(input.rate ?? "0");
  decimalUnits(rate);
  const tiered = ["whole", "progressive", "flat"].includes(input.method);
  const tiers = tiered ? input.tiers : [];
  if (tiered && (!Array.isArray(tiers) || ![2, 3].includes(tiers.length)))
    fail("Use two or three area tiers.");
  let previous = 0;
  const cleanTiers = tiers.map((tier, i) => {
    const upTo = String(tier.upTo ?? ""),
      last = i === tiers.length - 1;
    if (
      last ? upTo !== "" : !/^\d{1,9}$/.test(upTo) || Number(upTo) <= previous
    )
      fail(
        "Tier limits must increase with no gaps. Leave the last upper limit open.",
      );
    if (!last) previous = Number(upTo);
    const price = String(tier.price ?? "");
    decimalUnits(price, input.method === "flat" ? 2 : 4);
    return { upTo, price };
  });
  if (!Array.isArray(input.extras) || input.extras.length > 10)
    fail("Use at most 10 named extras.");
  const ids = new Set();
  const extras = input.extras.map((e) => {
    const id = text(e.id, 80, "extra identity");
    if (!/^[\w-]+$/.test(id) || ids.has(id))
      fail("Each extra needs its own identity.");
    ids.add(id);
    if (typeof e.required !== "boolean")
      fail("Choose whether the extra is required.");
    const maxQuantity = String(e.maxQuantity ?? "100"),
      defaultQuantity = String(e.defaultQuantity ?? "1");
    const max = decimalUnits(maxQuantity, 2, 10000),
      def = decimalUnits(defaultQuantity, 2, 10000);
    if (max === 0n || def === 0n || def > max)
      fail("Extra quantities must be positive and within the maximum.");
    const price = String(e.price ?? "");
    decimalUnits(price);
    return {
      id,
      name: text(e.name, 80, "extra name"),
      unit: text(e.unit, 30, "unit (for example hour)"),
      price,
      required: e.required,
      maxQuantity,
      defaultQuantity,
    };
  });
  return {
    schemaVersion: 1,
    currency,
    method: input.method,
    rate,
    tiers: cleanTiers,
    extras,
    allowBudget: input.allowBudget,
  };
}
const cents = (units, divisor = 100n) => {
  const amount = (units + divisor / 2n) / divisor;
  if (amount > 10000000000n) fail("The estimate exceeds the supported amount.");
  return Number(amount);
};
export function calculatePricing(config, area, quantities = {}) {
  const c = validatePricing(config);
  if (
    !quantities ||
    typeof quantities !== "object" ||
    Array.isArray(quantities) ||
    Object.keys(quantities).some((id) => !c.extras.some((e) => e.id === id))
  )
    fail("Choose only the provider’s listed extras.");
  const lines = [];
  let baseKnown = c.method !== "quote",
    sqft = null;
  if (baseKnown) {
    if (area == null || area === "") baseKnown = false;
    else if (!/^\d{1,9}$/.test(String(area)) || Number(area) < 1)
      fail("Enter a positive whole-number square footage.");
    else sqft = Number(area);
  }
  if (baseKnown) {
    if (c.method === "area")
      lines.push({
        name: "Capture",
        quantity: String(sqft),
        unit: "sq ft",
        rate: c.rate,
        amountCents: cents(BigInt(sqft) * decimalUnits(c.rate)),
      });
    else if (c.method === "progressive") {
      let lower = 0;
      for (const tier of c.tiers) {
        const upper = tier.upTo ? Number(tier.upTo) : sqft,
          quantity = Math.max(0, Math.min(sqft, upper) - lower);
        if (quantity)
          lines.push({
            name: `Area band ${lower + 1}–${tier.upTo || "and above"}`,
            quantity: String(quantity),
            unit: "sq ft",
            rate: tier.price,
            amountCents: cents(BigInt(quantity) * decimalUnits(tier.price)),
          });
        lower = upper;
        if (lower >= sqft) break;
      }
    } else {
      const tier = c.tiers.find((t) => !t.upTo || sqft <= Number(t.upTo));
      lines.push({
        name: c.method === "flat" ? "Project fee" : "Capture · whole-area tier",
        quantity: c.method === "flat" ? "1" : String(sqft),
        unit: c.method === "flat" ? "project" : "sq ft",
        rate: tier.price,
        amountCents: cents(
          (c.method === "flat" ? 1n : BigInt(sqft)) * decimalUnits(tier.price),
        ),
      });
    }
  }
  for (const extra of c.extras) {
    const raw = Object.hasOwn(quantities, extra.id)
        ? quantities[extra.id]
        : extra.required
          ? extra.defaultQuantity
          : "0",
      qty = decimalUnits(raw, 2, 10000),
      max = decimalUnits(extra.maxQuantity, 2, 10000);
    if (qty > max || (extra.required && qty === 0n))
      fail(
        `Enter a valid quantity for ${extra.name} (maximum ${extra.maxQuantity}).`,
      );
    if (qty)
      lines.push({
        id: extra.id,
        name: extra.name,
        quantity: String(raw),
        unit: extra.unit,
        rate: extra.price,
        amountCents: cents(decimalUnits(extra.price) * qty, 10000n),
      });
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (subtotalCents > 10000000000)
    fail("The estimate exceeds the supported amount.");
  return {
    currency: c.currency,
    method: c.method,
    sqft,
    lines,
    subtotalCents,
    totalCents: baseKnown ? subtotalCents : null,
  };
}
export const pricingKey = (descriptor) =>
  Object.hasOwn(descriptor, "pricing")
    ? descriptor.pricing?.key || "quote"
    : "legacy";
export function pricingRequest(descriptor, body) {
  if (!Object.hasOwn(descriptor, "pricing")) return undefined;
  if (
    (body.pricingKey ?? (descriptor.pricing ? "" : "quote")) !==
    pricingKey(descriptor)
  )
    fail("Pricing changed. Review the current pricing before submitting.");
  const config = descriptor.pricing?.config;
  if (!config) {
    if (body.budget || Object.keys(body.quantities || {}).length)
      fail("This form does not offer a price or budget entry.");
    return { pricing: null, budgetCents: null, estimate: null };
  }
  const estimate = calculatePricing(
    config,
    body.fields?.propertySizeSqFt,
    body.quantities || {},
  );
  let budgetCents = null;
  if (body.budget != null && body.budget !== "") {
    if (!config.allowBudget)
      fail("This provider is not accepting proposed budgets.");
    budgetCents = Number(decimalUnits(body.budget, 2, 100000000));
  }
  return { pricing: descriptor.pricing, budgetCents, estimate };
}
