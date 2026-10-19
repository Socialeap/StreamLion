// Tax collection is a separate release decision. Neither a code deployment nor
// a payment-mode change opts the merchant into Stripe Tax.
export function checkoutTaxMode(env, credits = false) {
  const mode = env.STREAMLION_CHECKOUT_TAX_MODE ?? "off";
  if (!["off", "stripe"].includes(mode))
    throw new Error("purchase_configuration");
  if (
    mode === "stripe" &&
    credits &&
    env.STREAMLION_CREDIT_TAX_TREATMENT !== "tax_on_purchase"
  )
    throw new Error("credit_configuration");
  return mode;
}

export async function taxSchemaReady(env, mode) {
  if (mode !== "stripe") return;
  const stamp = await env.GOOGLE_SESSIONS.prepare(
    "SELECT version FROM streamlion_checkout_tax_schema_v1 WHERE version=1",
  )
    .bind()
    .first();
  if (!stamp) throw new Error("purchase_configuration");
}

export function validateTaxPrice(price, mode) {
  if (mode !== "stripe") return;
  const code = price.product?.tax_code;
  if (
    price.tax_behavior !== "exclusive" ||
    !/^txcd_\d+$/.test(typeof code === "string" ? code : code?.id || "")
  )
    throw new Error("purchase_configuration");
}

// Use the order's persisted choice on retries, even after configuration changes.
export function taxCheckoutParams(order) {
  if (order.checkout_tax_mode !== "stripe") return {};
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
  };
}

export function validateTaxCheckout(session, order) {
  if (order.checkout_tax_mode !== "stripe") return;
  if (session.automatic_tax?.enabled !== true)
    throw new Error("purchase_mismatch");
  // An open/expired session may not have an address or calculated totals yet.
  // It cannot grant access; enforce completed calculation before any paid grant.
  if (session.payment_status !== "paid") return;
  const tax = session.total_details?.amount_tax;
  if (
    !Number.isSafeInteger(tax) ||
    tax < 0 ||
    !Number.isSafeInteger(session.amount_total) ||
    session.amount_total !== order.amount + tax ||
    session.automatic_tax.status !== "complete"
  )
    throw new Error("purchase_mismatch");
}
