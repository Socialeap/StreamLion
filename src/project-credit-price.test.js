import test from "node:test";
import assert from "node:assert/strict";
import { projectCreditPrice } from "./project-credit-price.js";
import { CREDIT_PACKS } from "../server/stripe-credits.js";
test("240 project credits equal USD 3.00 across the committed credit catalog", () => {
  for (const pack of CREDIT_PACKS)
    assert.equal(projectCreditPrice([pack]), 300);
  assert.equal(projectCreditPrice(CREDIT_PACKS), 300);
  assert.equal(
    projectCreditPrice([{ amount: 2000, creditsMicros: 10000000 }]),
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
    assert.equal(projectCreditPrice(packs), null);
});
