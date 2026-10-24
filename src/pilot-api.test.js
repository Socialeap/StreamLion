import test from "node:test";
import assert from "node:assert/strict";
import { pilotReceipt, pilotDate } from "./pilot-api.js";
test("only a live server pilot receipt can open local Core and never outlive its server expiry", () => {
  const now = 1000;
  assert.equal(
    pilotReceipt(
      { enabled: false, active: true, startsAt: 1, endsAt: 2000 },
      now,
    ),
    null,
  );
  assert.equal(
    pilotReceipt(
      { enabled: true, active: true, startsAt: 1, endsAt: now },
      now,
    ),
    null,
  );
  assert.equal(
    pilotReceipt(
      { enabled: true, active: true, startsAt: 1001, endsAt: 2000 },
      now,
    ),
    null,
  );
  assert.deepEqual(
    pilotReceipt(
      { enabled: true, active: true, startsAt: 1, endsAt: 2000 },
      now,
    ),
    { expires: 2000, pilot: true },
  );
});
test("expiry display identifies timezone explicitly", () =>
  assert.match(pilotDate(Date.UTC(2026, 9, 24, 20)), /UTC/));
