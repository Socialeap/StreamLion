import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function verify(
  { days = 14, checkoutMode = "paused", enabled = false } = {},
  args = [],
) {
  const responses = {
    "/api/purchase/config": {
      enabled,
      checkoutMode,
      mode: "live",
      amount: 3995,
      currency: "usd",
      refundDays: days,
      launchCapacity: 200,
    },
    "/api/purchase/status": {
      mode: "live",
      connected: false,
      purchased: false,
    },
    "/release.json": { revision: "synthetic" },
  };
  const mock = `globalThis.fetch=async url => new Response(JSON.stringify(${JSON.stringify(responses)}[new URL(url).pathname]),{headers:{"Cache-Control":"no-store"}});`;
  return spawnSync(
    process.execPath,
    [
      "--import",
      `data:text/javascript,${encodeURIComponent(mock)}`,
      fileURLToPath(
        new URL("../scripts/verify-purchases.mjs", import.meta.url),
      ),
      "https://app.example",
      "live",
      ...args,
    ],
    { encoding: "utf8" },
  );
}

test("refund readiness verifies fourteen days while checkout remains paused", () => {
  const result = verify();
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.refundDays, 14);
  assert.equal(receipt.checkoutMode, "paused");
});

test("refund readiness refuses the old period and an unexpected checkout opening", () => {
  assert.notEqual(verify({ days: 7 }).status, 0);
  assert.notEqual(verify({ checkoutMode: "open", enabled: true }).status, 0);
});

test("an explicit older offer remains verifiable without changing its promise", () => {
  const result = verify({ days: 7, checkoutMode: "open", enabled: true }, [
    "7",
    "open",
  ]);
  assert.equal(result.status, 0, result.stderr);
});
