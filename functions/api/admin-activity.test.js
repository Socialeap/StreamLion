import test from "node:test";
import assert from "node:assert/strict";
import { adminFixture, ADMIN_NOW } from "../../test/admin-fixture.js";
test("foreground activity is account-bound, deduplicates active days and rejects stale/future reports", async (t) => {
  const f = await adminFixture(t);
  let m;
  try {
    m = await import("../../server/account-activity.js");
  } catch {}
  assert.ok(m, "Account activity endpoint must exist");
  f.env.STREAMLION_PAYMENTS_MODE = "live";
  const call = (subject = "account-a", at = ADMIN_NOW) =>
    m.handleActivity(
      {
        env: f.env,
        request: new Request("https://app.example/api/account-activity", {
          method: "POST",
          headers: {
            Origin: "https://app.example",
            Cookie: "__Host-streamlion-session=" + f.cookie,
            "Content-Type": "application/json",
            "X-StreamLion-Account": subject,
          },
          body: JSON.stringify({ subject, occurredAt: at }),
        }),
      },
      { now: () => ADMIN_NOW },
    );
  assert.equal((await call("other")).status, 403);
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM streamlion_account_days_v1").get().n,
    1,
  );
  assert.equal((await call("account-a", ADMIN_NOW + 60000)).status, 400);
  assert.equal((await call("account-a", ADMIN_NOW - 8 * 86400000)).status, 400);
});
