import test from "node:test";
import assert from "node:assert/strict";
import {
  businessCheckoutParams,
  businessReview,
  businessApprovalToken,
  requireBusinessConsent,
} from "../server/checkout-business.js";

const order = {
  mode: "test",
  order_id: "order-qa",
  google_subject: "owner-qa",
  status: "pending",
  checkout_tax_mode: "stripe",
  checkout_business_policy: 1,
};
const session = () => ({
  customer: "cus_qa",
  consent: { terms_of_service: "accepted" },
  custom_fields: [
    { key: "business_name", text: { value: "QA Harbor Spatial" } },
  ],
});
const taxId = { type: "eu_vat", value: "DE123456789" };
function fixture(state, metadata = {}) {
  return {
    customers: {
      listTaxIds: async () => ({
        data: [{ ...taxId, verification: { status: state } }],
        has_more: false,
      }),
      retrieve: async () => ({ id: "cus_qa", metadata }),
    },
  };
}

test("business use requires explicit boolean consent and legacy Checkout stays identical", () => {
  for (const businessUse of [undefined, false, "true", 1])
    assert.throws(
      () => requireBusinessConsent({ businessUse }),
      /business_consent/,
    );
  requireBusinessConsent({ businessUse: true });
  assert.deepEqual(businessCheckoutParams({}), {});
  const params = businessCheckoutParams(order);
  assert.equal(params.customer_creation, "always");
  assert.equal(params.tax_id_collection.enabled, true);
  assert.equal(params.custom_fields[0].optional, false);
});

test("a new business order requires actual Checkout consent and legal name", async () => {
  const valid = session();
  assert.equal(await businessReview({}, valid, order), null);
  for (const patch of [
    { custom_fields: [] },
    { consent: {} },
    { custom_fields: [{ key: "business_name", text: { value: "\n" } }] },
  ])
    assert.equal(
      await businessReview({}, { ...valid, ...patch }, order),
      "manual",
    );
  assert.equal(
    await businessReview({}, {}, { ...order, checkout_business_policy: 0 }),
    null,
  );
  assert.equal(
    await businessReview({}, {}, { ...order, status: "paid" }),
    null,
  );
});

for (const state of ["pending", "unverified", "unavailable", "verified"]) {
  test(`government tax-ID state ${state} controls new fulfillment`, async () => {
    const value = { ...session(), customer_details: { tax_ids: [taxId] } };
    assert.equal(
      await businessReview(fixture(state), value, order),
      state === "verified" ? null : state === "pending" ? "pending" : "manual",
    );
  });
}

test("operator evidence is bounded to the order, account, tax ID and expiry; invalid IDs cannot override", async () => {
  const value = { ...session(), customer_details: { tax_ids: [taxId] } };
  const now = Date.now();
  const review = {
    status: "approved",
    basis: "government_register",
    token: await businessApprovalToken(order, taxId),
    reviewedAt: now,
    expiresAt: now + 86400000,
  };
  const stripe = (r, state = "unavailable") =>
    fixture(state, { streamlion_business_tax_review: JSON.stringify(r) });
  assert.equal(await businessReview(stripe(review), value, order), null);
  for (const patch of [
    { token: "wrong" },
    { expiresAt: now - 1 },
    { reviewedAt: now + 86400000 },
    { expiresAt: now + 31 * 86400000 },
    { basis: "self_declared" },
  ])
    assert.equal(
      await businessReview(stripe({ ...review, ...patch }), value, order),
      "manual",
    );
  assert.equal(
    await businessReview(stripe(review), value, {
      ...order,
      google_subject: "other",
    }),
    "manual",
  );
  assert.equal(
    await businessReview(stripe(review, "unverified"), value, order),
    "manual",
  );
  const mismatch = fixture("verified");
  mismatch.customers.listTaxIds = async () => ({
    data: [{ ...taxId, value: "OTHER", verification: { status: "verified" } }],
    has_more: false,
  });
  assert.equal(await businessReview(mismatch, value, order), "manual");
});

test("migration 0020 preserves every historical row and detects absent/applied/partial schema", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync, readdirSync } = await import("node:fs");
  const { coordinationPreflight } =
    await import("../scripts/preflight-coordination.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))
      .filter((n) => n.endsWith(".sql") && n.slice(0, 4) < "0020")
      .sort())
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    db.exec(
      "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES('legacy','test','qa','qa@example.com','price_qa','prod_qa',3995,'usd','paid',1,2,1)",
    );
    const state = () => {
      const schema = db
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL",
        )
        .all();
      const stamps = Object.fromEntries(
        schema
          .filter((r) => r.name.includes("_schema_"))
          .map((r) => [
            r.name,
            db.prepare("SELECT version FROM " + r.name).get().version,
          ]),
      );
      return { schema, stamps };
    };
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name);
    const before = Object.fromEntries(
      names.map((name) => [name, db.prepare("SELECT * FROM " + name).all()]),
    );
    assert.equal(
      coordinationPreflight(state(), "0020_checkout_business.sql").migration,
      "pending",
    );
    db.exec(
      readFileSync(
        new URL("../migrations/0020_checkout_business.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const name of names) {
      const rows = db.prepare("SELECT * FROM " + name).all();
      if (
        ["streamlion_purchases_v1", "streamlion_credit_orders_v1"].includes(
          name,
        )
      )
        for (const row of rows) {
          assert.equal(row.checkout_business_policy, 0);
          delete row.checkout_business_policy;
        }
      assert.deepEqual(rows, before[name]);
    }
    assert.equal(
      coordinationPreflight(state(), "0020_checkout_business.sql").migration,
      "already_applied",
    );
    const partial = state();
    partial.schema = partial.schema.filter(
      (r) => r.name !== "streamlion_checkout_business_schema_v1",
    );
    assert.throws(
      () => coordinationPreflight(partial, "0020_checkout_business.sql"),
      /Schema mismatch/,
    );
  } finally {
    db.close();
  }
});
