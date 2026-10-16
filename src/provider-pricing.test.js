import test from "node:test";
import assert from "node:assert/strict";
import {
  blankPricing,
  validatePricing,
  calculatePricing,
  pricingRequest,
} from "./provider-pricing.js";
const tiers = [
  { upTo: "5000", price: "0.15" },
  { upTo: "10000", price: "0.12" },
  { upTo: "", price: "0.10" },
];
test("all three tier methods apply their distinct boundary rules and retain exact cent totals", () => {
  const expected = {
    whole: [75000, 60012, 120000, 100010],
    progressive: [75000, 75012, 135000, 135010],
    flat: [1500, 1200, 1200, 1000],
  };
  for (const method of ["whole", "progressive", "flat"]) {
    const c = {
      ...blankPricing(),
      method,
      tiers:
        method === "flat"
          ? tiers.map((t, i) => ({ ...t, price: ["15", "12", "10"][i] }))
          : tiers,
    };
    [5000, 5001, 10000, 10001].forEach((area, i) =>
      assert.equal(
        calculatePricing(c, area).totalCents,
        expected[method][i],
        method + " " + area,
      ),
    );
  }
  assert.equal(
    calculatePricing({ ...blankPricing(), method: "area", rate: "0.125" }, "3")
      .totalCents,
    38,
  );
  assert.equal(
    calculatePricing({ ...blankPricing(), method: "area", rate: "0.125" }, "2")
      .totalCents,
    25,
  );
  assert.equal(
    calculatePricing({ ...blankPricing(), method: "area" }, "").totalCents,
    null,
  );
});
test("fractional named extras round once; required quantities and per-extra bounds are enforced", () => {
  const c = {
    ...blankPricing(),
    method: "area",
    rate: "0.15",
    extras: [
      {
        id: "editing",
        name: "Editing",
        unit: "hour",
        price: "50",
        required: false,
        maxQuantity: "10",
        defaultQuantity: "1",
      },
    ],
  };
  assert.equal(calculatePricing(c, "5000", { editing: "3" }).totalCents, 90000);
  assert.equal(
    calculatePricing(c, "5000", { editing: "1.5" }).totalCents,
    82500,
  );
  const tiny = {
    ...c,
    rate: "0",
    extras: [{ ...c.extras[0], price: "0.0049" }],
  };
  assert.equal(calculatePricing(tiny, "1", { editing: "1.02" }).totalCents, 0);
  assert.throws(
    () => calculatePricing(c, "1", { editing: "10.01" }),
    /valid quantity/,
  );
  assert.throws(
    () => calculatePricing(c, "1", { forged: "2" }),
    /listed extras/,
  );
  assert.throws(
    () =>
      calculatePricing(
        { ...c, extras: [{ ...c.extras[0], required: true }] },
        "1",
        { editing: "0" },
      ),
    /valid quantity/,
  );
  const quote = calculatePricing({ ...c, method: "quote" }, "", {
    editing: "3",
  });
  assert.equal(quote.totalCents, null);
  assert.equal(quote.subtotalCents, 15000);
});
test("invalid ranges, precision, unsafe amounts and unsupported currency cannot publish", () => {
  for (const bad of [
    [],
    [
      { upTo: "", price: "1" },
      { upTo: "", price: "2" },
    ],
    [
      { upTo: "5000", price: "1" },
      { upTo: "4000", price: "1" },
      { upTo: "", price: "1" },
    ],
  ])
    assert.throws(() =>
      validatePricing({ ...blankPricing(), method: "whole", tiers: bad }),
    );
  for (const rate of ["-1", "Infinity", "1e5", "0.00001"])
    assert.throws(() => validatePricing({ ...blankPricing(), rate }));
  assert.throws(
    () =>
      calculatePricing(
        { ...blankPricing(), method: "area", rate: "1000000" },
        "999999999",
      ),
    /supported amount/,
  );
  assert.throws(
    () => validatePricing({ ...blankPricing(), currency: "JPY" }),
    /two decimal/,
  );
});
test("a proposed budget never replaces the computed fee, and stale pricing keys fail before submission", () => {
  const descriptor = {
    pricing: {
      key: "default:1",
      version: 1,
      config: { ...blankPricing(), method: "area", allowBudget: true },
    },
  };
  const result = pricingRequest(descriptor, {
    pricingKey: "default:1",
    fields: { propertySizeSqFt: "5000" },
    budget: "600",
    quantities: {},
  });
  assert.equal(result.budgetCents, 60000);
  assert.equal(result.estimate.totalCents, 75000);
  assert.throws(
    () => pricingRequest(descriptor, { pricingKey: "default:2" }),
    /Pricing changed/,
  );
  assert.throws(
    () =>
      pricingRequest(
        { pricing: { ...descriptor.pricing, config: blankPricing() } },
        { pricingKey: "default:1", budget: "1" },
      ),
    /not accepting/,
  );
  assert.equal(pricingRequest({ intake: {} }, {}), undefined);
});
test("per-client budgets are optional, keep old configurations unchanged and follow each link's choice", async () => {
  const { budgetAllowed, withClientBudget } =
    await import("./provider-pricing.js");
  const base = validatePricing({ ...blankPricing(), allowBudget: true });
  assert.equal(Object.hasOwn(base, "budgetPerClient"), false);
  assert.throws(
    () => validatePricing({ ...blankPricing(), budgetPerClient: "yes" }),
    /per client/,
  );
  const perClient = validatePricing({
    ...blankPricing(),
    allowBudget: false,
    budgetPerClient: true,
  });
  assert.equal(perClient.budgetPerClient, true);
  const link = { pricing: { key: "default:1", config: perClient } };
  assert.equal(budgetAllowed(link), false, "the default applies until chosen");
  assert.equal(budgetAllowed(withClientBudget(link, true)), true);
  assert.equal(budgetAllowed(withClientBudget(link, false)), false);
  // A profile that is not per-client ignores a link's choice.
  const fixed = { pricing: { key: "default:1", config: base } };
  assert.equal(withClientBudget(fixed, false), fixed);
  assert.equal(budgetAllowed(fixed), true);
  assert.equal(budgetAllowed({ pricing: null }), false);
});
