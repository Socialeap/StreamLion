import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  confirmedPurchaseQuote,
  estimateTimeValue,
  estimateTaskValue,
} from "./landing-value.js";

const liveQuote = {
  enabled: true,
  mode: "live",
  amount: 2996,
  standardAmount: 3995,
  currency: "usd",
  refundDays: 7,
  launchRemaining: 1,
};
test("launch pricing requires a valid live quote and an available slot", () => {
  assert.equal(confirmedPurchaseQuote(liveQuote), liveQuote);
  for (const config of [
    null,
    undefined,
    {},
    { ...liveQuote, enabled: false },
    { ...liveQuote, mode: "test" },
    { ...liveQuote, amount: "2996" },
    { ...liveQuote, currency: "eur" },
    { ...liveQuote, refundDays: 0 },
    { ...liveQuote, launchRemaining: 0 },
    { ...liveQuote, launchRemaining: undefined },
  ])
    assert.equal(confirmedPurchaseQuote(config), null);
});
test("exhausted live quotes may show standard pricing", () => {
  const standard = { ...liveQuote, amount: 3995, launchRemaining: 0 };
  assert.equal(confirmedPurchaseQuote(standard), standard);
});
test("HTML without JavaScript or a successful quote only advertises standard pricing", () => {
  const document = new JSDOM(
    readFileSync(new URL("../api/welcome.html", import.meta.url), "utf8"),
  ).window.document;
  assert.equal(
    document.querySelector(".launch-price .price").textContent,
    "$39.95",
  );
  assert.equal(
    document.querySelector(".launch-price h3").textContent,
    "One-time purchase",
  );
  for (const selector of [
    ".original-price",
    ".launch-saving",
    "[data-launch-comparison]",
  ])
    assert.equal(document.querySelector(selector).hidden, true);
  assert.equal(
    document.querySelector(".launch-price .button").getAttribute("href"),
    "#demo",
  );
  assert.equal(
    document.querySelector("[data-purchase-cta]").textContent,
    "Try one job",
  );
  assert.equal(document.querySelector(".purchase-guarantee").hidden, true);
  assert.match(
    document.querySelector("[data-checkout-note]").textContent,
    /Sales are not open yet/,
  );
});

test("illustrative defaults compare both prices", () => {
  const result = estimateTimeValue("10", "60");
  assert.equal(result.perJob, 10);
  assert.equal(result.standardJobs, 4);
  assert.equal(result.launchJobs, 3);
  assert.equal(result.standardProgress, 10 / 39.95);
});
test("exact price boundaries cover the purchase in one job", () => {
  assert.equal(estimateTimeValue(60, 39.95).standardJobs, 1);
  assert.equal(estimateTimeValue(20, 119.85).standardJobs, 1);
  assert.equal(estimateTimeValue(60, 29.96).launchJobs, 1);
  assert.equal(estimateTimeValue(480, 10000).standardProgress, 1);
});
test("uses unrounded value rather than displayed currency", () => {
  const result = estimateTimeValue(60, 9.986);
  assert.equal(result.standardJobs, 5);
  assert.equal(result.launchJobs, 4);
});
test("invalid or unsupported estimates produce no result", () => {
  for (const value of ["", " ", "abc", null, true, {}, -1, 0, NaN, Infinity]) {
    assert.equal(estimateTimeValue(value, 60), null);
    assert.equal(estimateTimeValue(10, value), null);
  }
  assert.equal(estimateTimeValue(481, 60), null);
  assert.equal(estimateTimeValue(10, 10001), null);
  assert.equal(estimateTimeValue(Number.MIN_VALUE, 60), null);
  assert.equal(estimateTimeValue(0.000000000000001, 1), null);
});

test("the estimate follows the actual configured checkout price", () => {
  const result = estimateTimeValue(10, 60, { standard: 29.95, launch: 29.95 });
  assert.equal(result.standardJobs, 3);
  assert.equal(result.launchJobs, 3);
  assert.equal(result.standardProgress, 10 / 29.95);
  assert.equal(estimateTimeValue(10, 60, { standard: -1, launch: 20 }), null);
});

test("the task model derives the time difference from explicit timings", () => {
  const result = estimateTaskValue(
    [
      { before: 6, after: 2 },
      { before: 8, after: 3 },
      { before: 6, after: 2 },
    ],
    60,
  );
  assert.equal(result.before, 20);
  assert.equal(result.after, 7);
  assert.equal(result.minutes, 13);
  assert.equal(result.value.perJob, 13);
  assert.equal(result.value.standardJobs, 4);
  assert.equal(result.value.launchJobs, 3);
});
test("the task model counts extra work against savings and does not invent a positive return", () => {
  const extra = estimateTaskValue(
    [
      { before: 2, after: 5 },
      { before: 0, after: 0 },
      { before: 0, after: 0 },
    ],
    60,
  );
  assert.equal(extra.minutes, -3);
  assert.equal(extra.value, null);
  const zero = estimateTaskValue(
    Array.from({ length: 3 }, () => ({ before: 0, after: 0 })),
    60,
  );
  assert.equal(zero.minutes, 0);
  assert.equal(zero.value, null);
});
test("incomplete or invalid task timings do not silently become zero", () => {
  const tasks = [
    { before: 6, after: 2 },
    { before: 8, after: 3 },
    { before: 6, after: 2 },
  ];
  for (const value of ["", " ", null, true, NaN, Infinity, -1, 481])
    assert.equal(
      estimateTaskValue([{ before: value, after: 2 }, ...tasks.slice(1)], 60),
      null,
    );
  assert.equal(
    estimateTaskValue([{ before: 480, after: 2 }, ...tasks.slice(1)], 60),
    null,
  );
  assert.equal(estimateTaskValue(tasks.slice(1), 60), null);
  assert.equal(estimateTaskValue(tasks, ""), null);
});
