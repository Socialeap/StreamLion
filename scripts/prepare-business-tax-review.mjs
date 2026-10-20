// Offline preparation only. Never contacts Stripe or changes an approval.
// Input contains private business tax details: pipe from a private local record,
// never pass tax IDs/subjects in command arguments or paste them in chat.
import { businessApprovalToken } from "../server/checkout-business.js";
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 4096) throw new Error("Review input too large");
}
const data = JSON.parse(input);
if (
  data.verifiedByOperator !== true ||
  !["test", "live"].includes(data.mode) ||
  !["government_register", "documentary_evidence"].includes(data.basis) ||
  !["eu_vat", "gb_vat", "ca_gst_hst"].includes(data.taxType) ||
  ![data.orderId, data.subject, data.taxValue].every(
    (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200,
  )
)
  throw new Error(
    "A completed operator review and exact order/tax details are required",
  );
const reviewedAt = Date.now();
console.log(
  JSON.stringify(
    {
      key: "streamlion_business_tax_review",
      value: JSON.stringify({
        status: "approved",
        basis: data.basis,
        token: await businessApprovalToken(
          {
            mode: data.mode,
            order_id: data.orderId,
            google_subject: data.subject,
          },
          { type: data.taxType, value: data.taxValue },
        ),
        reviewedAt,
        expiresAt: reviewedAt + 7 * 86400000,
      }),
    },
    null,
    2,
  ),
);
