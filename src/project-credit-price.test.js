import test from "node:test";
import assert from "node:assert/strict";
import {
  priceLabels,
  projectCreditPrice,
  usd,
} from "./project-credit-price.js";
import { CREDIT_PACKS } from "../server/stripe-credits.js";
test("240 project credits equal USD 3.00 across the committed credit catalog", () => {
  for (const pack of CREDIT_PACKS)
    assert.equal(projectCreditPrice([pack], 3000000), 300);
  assert.equal(projectCreditPrice(CREDIT_PACKS, 3000000), 300);
  assert.equal(
    projectCreditPrice([{ amount: 2000, creditsMicros: 10000000 }], 3000000),
    600,
  );
});
test("unverified, malformed or inconsistent rates never produce a dollar promise", () => {
  for (const packs of [
    null,
    [null],
    [],
    [{ amount: 0, creditsMicros: 1 }],
    [{ amount: 1000, creditsMicros: 0 }],
    [{ amount: NaN, creditsMicros: 100 }],
    [...CREDIT_PACKS, { amount: 1000, creditsMicros: 20000000 }],
  ])
    assert.equal(projectCreditPrice(packs, 3000000), null);
});

test("active project policy determines price; missing policy never uses a default", () => {
  assert.equal(projectCreditPrice(CREDIT_PACKS, 2000000), 200);
  for (const charge of [undefined, null, 0, -1, NaN, "3000000"])
    assert.equal(projectCreditPrice(CREDIT_PACKS, charge), null);
});

test("feature price labels are exact when they can be and marked approximate otherwise", () => {
  assert.deepEqual(priceLabels(CREDIT_PACKS, 3000000), {
    credits: "240 credits",
    usd: usd(300),
  });
  assert.deepEqual(priceLabels(CREDIT_PACKS, 100000), {
    credits: "8 credits",
    usd: usd(10),
  });
  assert.deepEqual(priceLabels(CREDIT_PACKS, 12480), {
    credits: "≈1 credit",
    usd: "≈" + usd(1),
  });
  assert.deepEqual(priceLabels(CREDIT_PACKS, 12500), {
    credits: "1 credit",
    usd: "≈" + usd(1),
  });
  // No verified pack rate: show credits only, never a guessed dollar amount.
  assert.deepEqual(priceLabels(null, 12480), {
    credits: "≈1 credit",
    usd: null,
  });
  for (const micros of [null, 0, -5, 1.5])
    assert.equal(priceLabels(CREDIT_PACKS, micros), null);
});
