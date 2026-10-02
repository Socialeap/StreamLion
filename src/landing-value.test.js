import test from "node:test";
import assert from "node:assert/strict";
import { estimateTimeValue } from "./landing-value.js";

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
