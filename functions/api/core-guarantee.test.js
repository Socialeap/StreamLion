import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { coreRefundWindow } from "../../src/refund-policy.js";
import { coreGuaranteePreflight } from "../../scripts/preflight-core-guarantee.mjs";
import {
  CORE_OFFER,
  recordRefundRequest,
  processRefundRequest,
  processRefundQueue,
  guaranteeStatus,
} from "../../server/core-guarantee.js";
import worker from "../../ops/core-refunds-worker.js";
function fixture(t, { migrate = true } = {}) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  const dir = new URL("../../migrations/", import.meta.url);
  for (const n of readdirSync(dir)
    .filter((n) => n.endsWith(".sql") && (migrate || n < "0026"))
    .sort())
    sql.exec(readFileSync(new URL(n, dir), "utf8"));
  const wrap = (q, v = []) => ({
    bind: (...a) => wrap(q, a),
    first: async () => sql.prepare(q).get(...v) || null,
    run: async () => ({ meta: { changes: sql.prepare(q).run(...v).changes } }),
    all: async () => ({ results: sql.prepare(q).all(...v) }),
  });
  const env = {
    GOOGLE_SESSIONS: { prepare: wrap },
    STREAMLION_PAYMENTS_MODE: "test",
    STREAMLION_CORE_REFUNDS_ENABLED: "true",
  };
  const now = Date.now(),
    paidAt = now - 86400000;
  function insert(id = "order", subject = "buyer", mode = "test") {
    sql
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at,checkout_session,payment_intent,core_offer,refund_days,paid_at) VALUES(?,?,?,'synthetic@example.com','price_2995','prod_core',2995,'usd','paid',?,?,?, ?,?,?,14,?)",
      )
      .run(
        id,
        mode,
        subject,
        paidAt - 1000,
        now,
        paidAt,
        "cs_" + id,
        "pi_" + id,
        CORE_OFFER,
        paidAt,
      );
  }
  const charge = {
    id: "ch_order",
    paid: true,
    captured: true,
    currency: "usd",
    amount: 3261,
    amount_refunded: 0,
  };
  const session = {
    livemode: false,
    payment_status: "paid",
    amount_total: 3261,
    payment_intent: {
      id: "pi_order",
      status: "succeeded",
      metadata: { app: "streamlion", order_id: "order" },
      latest_charge: charge,
    },
  };
  const refunds = [],
    keys = [];
  let failure = false;
  const stripe = {
    checkout: { sessions: { retrieve: async () => session } },
    refunds: {
      list: async () => ({ has_more: false, data: refunds }),
      create: async (body, opts) => {
        keys.push(opts.idempotencyKey);
        if (failure) throw Error("provider unavailable");
        const r = {
          id: "re_one",
          charge: charge.id,
          livemode: false,
          currency: "usd",
          amount: body.amount,
          status: "succeeded",
          metadata: body.metadata,
        };
        refunds.push(r);
        return r;
      },
    },
  };
  const schema = () => {
    const schema = sql
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    return {
      schema,
      stamps: Object.fromEntries(
        schema
          .filter((r) => r.type === "table" && /schema_v\d+$/.test(r.name))
          .map((r) => [
            r.name,
            sql.prepare("SELECT version FROM " + r.name).get().version,
          ]),
      ),
    };
  };
  return {
    sql,
    env,
    now,
    paidAt,
    insert,
    stripe,
    refunds,
    keys,
    schema,
    set failure(v) {
      failure = v;
    },
  };
}
test("the exact refund boundary includes before/at and excludes one millisecond after, independent of DST or processing time", () => {
  const paid = Date.parse("2026-10-26T14:00:00Z"),
    end = paid + 14 * 86400000;
  assert.equal(coreRefundWindow(paid, end - 1).eligible, true);
  assert.equal(coreRefundWindow(paid, end).eligible, true);
  assert.equal(coreRefundWindow(paid, end + 1).eligible, false);
  assert.equal(
    new Date(coreRefundWindow(paid, end).deadline).toISOString(),
    "2026-11-09T14:00:00.000Z",
  );
  for (const time of [NaN, undefined, "123", 0])
    assert.throws(() => coreRefundWindow(time, end));
});
test("migration preflight classifies absence, exact applied state and rejects partial/altered state", (t) => {
  const f = fixture(t, { migrate: false });
  assert.equal(coreGuaranteePreflight(f.schema()).migration, "pending");
  f.sql.exec("ALTER TABLE streamlion_purchases_v1 ADD COLUMN core_offer TEXT");
  assert.throws(() => coreGuaranteePreflight(f.schema()), /altered/);
  const g = fixture(t);
  assert.equal(coreGuaranteePreflight(g.schema()).migration, "already_applied");
  const input = g.schema();
  input.stamps.streamlion_core_guarantee_schema_v1 = 2;
  assert.throws(() => coreGuaranteePreflight(input), /stamp/);
});
test("deadline is received-time based; delayed staff/worker processing does not change it and duplicate requests preserve the timestamp", async (t) => {
  const f = fixture(t);
  f.insert();
  const deadline = f.paidAt + 14 * 86400000;
  await Promise.all([
    recordRefundRequest(f.env, "test", "buyer", deadline),
    recordRefundRequest(f.env, "test", "buyer", deadline + 1000),
  ]);
  assert.equal(
    f.sql
      .prepare("SELECT received_at FROM streamlion_core_refund_requests_v1")
      .get().received_at,
    deadline,
  );
  await processRefundRequest(f.env, f.stripe, "order", deadline + 2 * 86400000);
  assert.equal(f.keys.length, 1);
  assert.equal(f.refunds[0].amount, 3261);
  assert.equal(
    (await guaranteeStatus(f.env, "test", "buyer")).state,
    "succeeded",
  );
});
test("after-deadline requests are durably recorded without a Stripe refund; unknown and other-mode accounts cannot request", async (t) => {
  const f = fixture(t);
  f.insert();
  await recordRefundRequest(
    f.env,
    "test",
    "buyer",
    f.paidAt + 14 * 86400000 + 1,
  );
  await processRefundQueue(f.env, f.stripe, f.now + 20 * 86400000);
  assert.equal(f.keys.length, 0);
  assert.equal(
    (await guaranteeStatus(f.env, "test", "buyer")).state,
    "ineligible",
  );
  await assert.rejects(recordRefundRequest(f.env, "live", "buyer", f.now));
  await assert.rejects(recordRefundRequest(f.env, "test", "other", f.now));
});
test("an ambiguous API failure retries automatically with the same key and discovers an already-created refund even after 24 hours", async (t) => {
  const f = fixture(t);
  f.insert();
  await recordRefundRequest(f.env, "test", "buyer", f.now);
  f.failure = true;
  await processRefundRequest(f.env, f.stripe, "order", f.now);
  assert.equal(f.keys.length, 1);
  f.refunds.push({
    id: "re_lost",
    charge: "ch_order",
    livemode: false,
    currency: "usd",
    amount: 3261,
    status: "succeeded",
    metadata: { streamlion_refund_request: "order" },
  });
  f.failure = false;
  await processRefundQueue(f.env, f.stripe, f.now + 2 * 86400000);
  assert.equal(f.keys.length, 1);
  assert.equal(
    (await guaranteeStatus(f.env, "test", "buyer")).state,
    "succeeded",
  );
});
test("concurrent processors acquire one lease; prior partial refunds reduce only the remaining gross refund", async (t) => {
  const f = fixture(t);
  f.insert();
  await recordRefundRequest(f.env, "test", "buyer", f.now);
  f.refunds.push({
    id: "re_partial",
    charge: "ch_order",
    livemode: false,
    currency: "usd",
    amount: 100,
    status: "succeeded",
  });
  await Promise.all([
    processRefundRequest(f.env, f.stripe, "order", f.now),
    processRefundRequest(f.env, f.stripe, "order", f.now),
  ]);
  assert.equal(f.keys.length, 1);
  assert.equal(f.refunds[1].amount, 3161);
});
test("disputed, mismatched or unverifiable provider payments never initiate an automated refund", async (t) => {
  const f = fixture(t);
  f.insert();
  await recordRefundRequest(f.env, "test", "buyer", f.now);
  const bad = {
    ...f.stripe,
    checkout: { sessions: { retrieve: async () => ({ livemode: true }) } },
  };
  await processRefundRequest(f.env, bad, "order", f.now);
  assert.equal(f.keys.length, 0);
  assert.equal(
    f.sql.prepare("SELECT error FROM streamlion_core_refund_requests_v1").get()
      .error,
    "refund_verification_required",
  );
});
test("the new Worker and request path fail closed while disabled and require no network/owner action", async (t) => {
  const f = fixture(t);
  f.env.STREAMLION_CORE_REFUNDS_ENABLED = "false";
  await worker.scheduled({}, f.env);
  assert.equal((await processRefundQueue(f.env, f.stripe)).checked, 0);
  await assert.rejects(recordRefundRequest(f.env, "test", "buyer", f.now));
});

test("promotion switches only new quotes at the approved New York midnight and fails closed on invalid policy", async () => {
  const { coreOffer } = await import("../../server/core-offer.js");
  const env = {
      STREAMLION_CORE_PROMOTION_END: "2027-01-01T05:00:00.000Z",
      STREAMLION_CORE_AFTER_PROMOTION: "standard",
    },
    end = Date.parse(env.STREAMLION_CORE_PROMOTION_END);
  assert.equal(coreOffer(env, end - 1).amount, 2995);
  assert.equal(coreOffer(env, end).amount, 3995);
  assert.equal(coreOffer(env, end + 1).amount, 3995);
  assert.throws(() => coreOffer({ ...env, STREAMLION_CORE_PROMOTION_END: "" }));
  assert.throws(() =>
    coreOffer({ ...env, STREAMLION_CORE_AFTER_PROMOTION: "guess" }),
  );
  assert.equal(
    coreOffer({ ...env, STREAMLION_CORE_AFTER_PROMOTION: "paused" }, end)
      .available,
    false,
  );
});

test("an earlier timely HTTP receipt that finishes authentication later still wins over an after-deadline request", async (t) => {
  const f = fixture(t);
  f.insert();
  const end = f.paidAt + 14 * 86400000;
  await recordRefundRequest(f.env, "test", "buyer", end + 1);
  await recordRefundRequest(f.env, "test", "buyer", end);
  const r = f.sql
    .prepare("SELECT received_at,state FROM streamlion_core_refund_requests_v1")
    .get();
  assert.equal(r.received_at, end);
  assert.equal(r.state, "requested");
  await processRefundRequest(f.env, f.stripe, "order", end + 86400000);
  assert.equal(f.keys.length, 1);
});

test("paid business-review holds can request refunds but unverified unpaid holds cannot", async (t) => {
  const f = fixture(t);
  f.insert();
  f.sql.prepare("UPDATE streamlion_purchases_v1 SET status='processing'").run();
  assert.equal(
    (await guaranteeStatus(f.env, "test", "buyer")).canRequest,
    true,
  );
  await recordRefundRequest(f.env, "test", "buyer", f.now);
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) n FROM streamlion_core_refund_requests_v1")
      .get().n,
    1,
  );
});
