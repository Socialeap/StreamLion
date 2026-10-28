import test from "node:test";
import assert from "node:assert/strict";
import { stableJSON } from "./coordination-contract.js";

// The original encoder is the compatibility oracle for persisted HMAC bodies.
const original = (v) =>
  JSON.stringify(v, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        )
      : value,
  );

test("canonical JSON retains existing signed bytes across JSON and JavaScript edge cases", () => {
  const cases = [
    null,
    false,
    0,
    -0,
    NaN,
    Infinity,
    undefined,
    "café façade ±2 mm 🦁",
    { z: undefined, a: null, b: [undefined, NaN, { z: 2, a: 1 }] },
    JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":1,"10":"ten","2":"two","01":"one"}',
    ),
    {
      at: new Date("2026-10-28T00:00:00Z"),
      n: new Number(3),
      s: new String("ab"),
    },
    { value: { toJSON: () => ({ z: 2, a: 1 }) } },
    { escape: '\\ " \n \u0000', loneSurrogate: "\ud800" },
  ];
  // Deterministic nested records exercise sorted insertion, arrays and omissions.
  let seed = 17;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  const record = (depth) =>
    depth
      ? Object.fromEntries(
          Array.from({ length: 6 }, (_, i) => [
            String(next() % 100) + "-" + i,
            next() % 2 ? record(depth - 1) : [next(), null, "±"],
          ]),
        )
      : next();
  for (let i = 0; i < 100; i++) cases.push(record(3));
  for (const value of cases) assert.equal(stableJSON(value), original(value));
  const cycle = {};
  cycle.self = cycle;
  for (const value of [cycle, { big: 1n }]) {
    let expected;
    try {
      original(value);
    } catch (error) {
      expected = error.constructor;
    }
    assert.ok(expected);
    assert.throws(() => stableJSON(value), expected);
  }
  assert.equal({}.polluted, undefined);
});
