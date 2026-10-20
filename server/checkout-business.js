// This contract is saved on each order. Legacy sessions keep their original
// parameters and remain reconcilable while checkout or current policy is paused.
export async function requireBusinessSchema(env) {
  const stamp = await env.GOOGLE_SESSIONS.prepare(
    "SELECT version FROM streamlion_checkout_business_schema_v1 WHERE version=1",
  ).first();
  if (!stamp) throw new Error("purchase_configuration");
}

export function requireBusinessConsent(body) {
  if (body?.businessUse !== true) throw new Error("business_consent");
}

export function businessCheckoutParams(order) {
  if (order.checkout_business_policy !== 1) return {};
  return {
    custom_fields: [
      {
        key: "business_name",
        label: { type: "custom", custom: "Business or sole trader legal name" },
        type: "text",
        text: { minimum_length: 2, maximum_length: 150 },
        optional: false,
      },
    ],
    ...(order.checkout_tax_mode === "stripe"
      ? { customer_creation: "always", tax_id_collection: { enabled: true } }
      : {}),
  };
}

const normalize = (value) =>
  String(value || "")
    .replace(/\s/g, "")
    .toUpperCase();
const reliefTypes = new Set(["eu_vat", "gb_vat", "ca_gst_hst"]);

// A private Stripe-operator review can resolve a government service outage or
// an unsupported automatic check. Bind it to this exact order and tax ID;
// unrelated/stale customer metadata is never an exemption credential.
export async function businessApprovalToken(order, id) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      order.mode,
      order.order_id,
      order.google_subject,
      id.type,
      normalize(id.value),
    ]),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function operatorApproved(stripe, customer, order, id) {
  const record = await stripe.customers.retrieve(customer);
  if (record.deleted) return false;
  let review;
  try {
    review = JSON.parse(
      record.metadata?.streamlion_business_tax_review || "null",
    );
  } catch {
    return false;
  }
  const now = Date.now();
  return (
    review?.status === "approved" &&
    ["government_register", "documentary_evidence"].includes(review.basis) &&
    Number.isSafeInteger(review.reviewedAt) &&
    review.reviewedAt <= now &&
    Number.isSafeInteger(review.expiresAt) &&
    review.expiresAt > now &&
    review.expiresAt <= review.reviewedAt + 30 * 86400000 &&
    review.token === (await businessApprovalToken(order, id))
  );
}

// Stripe Checkout checks tax-ID format before payment, not government validity.
// Do not issue a new entitlement on the strength of a format-only VAT claim.
// Refunds/disputes are reconciled before this check; already-paid access is not
// revoked just because a customer's later tax profile changes.
export async function businessReview(stripe, session, order) {
  if (order.checkout_business_policy !== 1 || order.status === "paid")
    return null;
  const name = session.custom_fields?.find((f) => f.key === "business_name")
    ?.text?.value;
  if (
    session.consent?.terms_of_service !== "accepted" ||
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.length > 150 ||
    /[\x00-\x1f\x7f]/.test(name)
  )
    return "manual";
  const ids = session.customer_details?.tax_ids;
  if (ids !== undefined && !Array.isArray(ids)) return "manual";
  const claimed = (ids || []).filter((id) => reliefTypes.has(id.type));
  if (!claimed.length) return null;
  const customer =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  if (!customer || session.customer?.deleted) return "manual";
  const saved = await stripe.customers.listTaxIds(customer, { limit: 100 });
  if (saved.has_more || !Array.isArray(saved.data)) return "manual";
  for (const id of claimed) {
    const proof = saved.data.find(
      (p) => p.type === id.type && normalize(p.value) === normalize(id.value),
    );
    if (!proof || !normalize(id.value)) return "manual";
    const state = proof.verification?.status;
    if (state === "verified") continue;
    if (
      ["pending", "unavailable"].includes(state) &&
      (await operatorApproved(stripe, customer, order, id))
    )
      continue;
    if (state === "pending") return "pending";
    return "manual";
  }
  return null;
}
