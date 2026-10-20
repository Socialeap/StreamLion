import test from "node:test";
import assert from "node:assert/strict";
import {
  checkoutTaxMode,
  taxCheckoutParams,
  validateTaxCheckout,
  validateTaxPrice,
} from "../server/checkout-tax.js";

test("tax is opt-in and credit purchase timing must be explicitly approved", () => {
  assert.equal(checkoutTaxMode({}), "off");
  assert.throws(() =>
    checkoutTaxMode({ STREAMLION_CHECKOUT_TAX_MODE: "typo" }),
  );
  const env = { STREAMLION_CHECKOUT_TAX_MODE: "stripe" };
  assert.throws(() => checkoutTaxMode(env, true));
  assert.equal(
    checkoutTaxMode(
      { ...env, STREAMLION_CREDIT_TAX_TREATMENT: "tax_on_purchase" },
      true,
    ),
    "stripe",
  );
});
test("a saved tax contract controls retries; legacy orders keep identical parameters", () => {
  assert.deepEqual(taxCheckoutParams({}), {});
  assert.deepEqual(taxCheckoutParams({ checkout_tax_mode: "off" }), {});
  assert.deepEqual(taxCheckoutParams({ checkout_tax_mode: "stripe" }), {
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
  });
});
test("zero tax is accepted only with a complete calculation; malformed paid totals fail closed", () => {
  const order = { checkout_tax_mode: "stripe", amount: 1000 };
  const session = {
    automatic_tax: { enabled: true, status: "complete" },
    payment_status: "paid",
    amount_total: 1000,
    total_details: { amount_tax: 0 },
  };
  validateTaxCheckout(session, order);
  for (const patch of [
    { amount_total: 1001 },
    { total_details: { amount_tax: -1 } },
    { total_details: { amount_tax: 0.1 } },
    { automatic_tax: { enabled: true, status: "failed" } },
    { automatic_tax: { enabled: false, status: "complete" } },
  ])
    assert.throws(() => validateTaxCheckout({ ...session, ...patch }, order));
  validateTaxCheckout(
    {
      automatic_tax: { enabled: true, status: "requires_location_inputs" },
      payment_status: "unpaid",
    },
    order,
  );
});
test("tax catalog cannot silently inherit an unspecified tax behavior or product code", () => {
  validateTaxPrice(
    { tax_behavior: "exclusive", product: { tax_code: "txcd_10103101" } },
    "stripe",
  );
  for (const price of [
    { tax_behavior: "unspecified", product: { tax_code: "txcd_10103101" } },
    { tax_behavior: "exclusive", product: {} },
  ])
    assert.throws(() => validateTaxPrice(price, "stripe"));
});

test("the additive tax migration preserves historical orders, grants and defaults", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync, readdirSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))
      .filter((n) => n.endsWith(".sql") && n.slice(0, 4) < "0019")
      .sort())
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    db.exec(
      "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES('old','test','qa','qa@example.com','price_qa','prod_qa',3995,'usd','paid',1,2,1)",
    );
    const { coordinationPreflight } =
      await import("../scripts/preflight-coordination.mjs");
    const schemaState = () => {
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
            db.prepare(`SELECT version FROM ${r.name}`).get().version,
          ]),
      );
      return { schema, stamps };
    };
    assert.equal(
      coordinationPreflight(schemaState(), "0019_checkout_tax.sql").migration,
      "pending",
    );
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name);
    const before = Object.fromEntries(
      tables.map((name) => [name, db.prepare(`SELECT * FROM ${name}`).all()]),
    );
    db.exec(
      readFileSync(
        new URL("../migrations/0019_checkout_tax.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const name of tables) {
      const rows = db.prepare(`SELECT * FROM ${name}`).all();
      if (
        ["streamlion_purchases_v1", "streamlion_credit_orders_v1"].includes(
          name,
        )
      )
        for (const row of rows) {
          assert.equal(row.checkout_tax_mode, "off");
          delete row.checkout_tax_mode;
        }
      assert.deepEqual(rows, before[name]);
    }
    assert.equal(
      coordinationPreflight(schemaState(), "0019_checkout_tax.sql").migration,
      "already_applied",
    );
    const partial = schemaState();
    partial.schema = partial.schema.filter(
      (r) => r.name !== "streamlion_checkout_tax_schema_v1",
    );
    assert.throws(
      () => coordinationPreflight(partial, "0019_checkout_tax.sql"),
      /Schema mismatch/,
    );
    assert.equal(
      db.prepare("SELECT version FROM streamlion_checkout_tax_schema_v1").get()
        .version,
      1,
    );
  } finally {
    db.close();
  }
});

test("tax preflight accepts entirely absent optional saved-card schema and rejects partial state", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync, readdirSync } = await import("node:fs");
  const { coordinationPreflight } =
    await import("../scripts/preflight-coordination.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of readdirSync(new URL("../migrations/", import.meta.url))
      .filter(
        (n) =>
          n.endsWith(".sql") && !n.startsWith("0017") && n.slice(0, 4) < "0019",
      )
      .sort())
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
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
    assert.equal(
      coordinationPreflight(state(), "0019_checkout_tax.sql").migration,
      "pending",
    );
    db.exec(
      readFileSync(
        new URL("../migrations/0019_checkout_tax.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(
      coordinationPreflight(state(), "0019_checkout_tax.sql").migration,
      "already_applied",
    );
    db.exec(
      "CREATE TABLE streamlion_credit_cards_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1)); INSERT INTO streamlion_credit_cards_schema_v1 VALUES(1);",
    );
    assert.throws(
      () => coordinationPreflight(state(), "0019_checkout_tax.sql"),
      /Partial optional saved-card/,
    );
  } finally {
    db.close();
  }
});
