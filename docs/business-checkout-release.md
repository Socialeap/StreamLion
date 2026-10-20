# Business-provider Checkout: review and held release gates

The owner approved required provider purchases and business-only international sales on October 19, 2026 (New York). This PR prepares that scope; it does not open sales or establish foreign tax/privacy compliance. No F|3D Studio, directory purchase or professional-credential review is required. No country allowlist, geoblock, new environment variable, subscription or paid invoice service is added.

## What changes

- Provider sign-up uses the existing authenticated Google userinfo result. `email_verified` must be the boolean `true`, with an account subject and email, before a session is created. Missing, false, string and numeric claims fail. This confirms the sign-in email, not a professional credential or separate contact address. Clients retain the existing invitation verification; optional public-form verification is unchanged.
- New Core/hosted pack requests require an explicit `businessUse: true` declaration. Checkout asks for a legal business/sole-trader name. The provider confirmation is shown on both purchase pages. No business name is copied from a mutable profile into an idempotent Session request.
- New orders atomically persist `checkout_business_policy=1`. Migration0020 gives old orders `0`; their original Session parameters and paid/recovery/refund/dispute contracts remain unchanged. An existing pending order can recover without a new declaration. No old purchase is converted or revoked by this migration.
- Taxed business Checkout creates a Stripe Customer and optionally collects a business tax ID. No card is saved for reuse. Customer creation/tax-ID retrieval must be permitted by the restricted Stripe key before activation.
- For newly paid orders claiming EU/UK VAT or Canadian GST/HST treatment, government verification must be `verified` before a new access/credit grant. Pending/unavailable/invalid evidence keeps the order `processing`, issues zero new credits/access and explains that the customer must not pay again. Confirmation rechecks it; no automatic AI, paid Tax calculation or new payment is initiated for recovery. Tax-ID verification is not a professional-identity certification.
- A Customer's tax-ID list must contain the exact type/value collected in the original Session. Pending or unavailable automatic checks can be resolved by an explicit operator review below. An automatically `unverified` ID cannot be overridden by this mechanism. Tax profiles changing after an order is already paid do not revoke that established access.
- Refund/dispute calculation runs before the business review gate. Full refunds/disputes continue reconciling while checkout is paused. Generic tax completion/zero-tax validation is not replaced: zero tax can mean no registration, not an exemption. Registration readiness must therefore be cleared before opening, not inferred from a successful Session.
- Saved-card/direct top-ups retain their historical path and remain disabled at launch. This PR does not authorize enabling them; they need a separate business/tax review. Hosted requests cannot create a new Session on a policy-0 order, and direct requests cannot charge a policy-1 order, including when concurrent inserts select the same pending order. The losing path reports the pending amount without contacting Stripe to create a payment. Existing Sessions, card removals, pending charges and webhook reconciliation are preserved. A legacy pending order with neither a Session nor a top-up claim must expire before a new hosted order is created; it is never silently converted to policy 1.

Stripe SDK/API versions and existing prices are unchanged. Google projects/drafts/credentials are not copied into Stripe. Legal business name and tax IDs remain in Stripe; D1 adds only a per-order policy marker.

## 1. Review / merge gate — owner

Review the exact commit and required `verify` result. This task does not authorize merge. The committed public policy edits are review material; they do not claim an executed international DPA, appointed representative, foreign registration or authority-approved classification.

## 2. Migration gate — held until merge and separate release authorization

Target `migrations/0020_checkout_business.sql` from the approved merged SHA. Use the existing read-only `coordinationPreflight` classifier with target `0020_checkout_business.sql` and current schema/stamps. It compares the exact table definitions, both added columns and the version marker:

- entirely absent -> apply the committed SQL byte-for-byte;
- completely matching -> skip;
- partial or mismatching -> STOP, do not repair/generate replacement SQL.

Before and after, compare the protected business records excluding only the newly added default columns. Old rows must have policy0 and preserve every other value. Do not export secrets to chat or use production records as disposable fixtures.

## 3. Configuration gate — separately authorized, checkout still paused

Use `ops/business-launch-settings.HOLD.json`. Replace the existing private Production `STREAMLION_REQUIRE_LICENSE` binding with `true`; keep existing `STREAMLION_CHECKOUT_MODE=paused`. Do not add runtime bindings: the current free-tier deployment already uses64 slots. Verify app status reports `required:true`, pending/paid confirmation works, unpaid server workspace operations return402, and device-backup download / original Google files remain available. Do not change live/test accounting namespaces, grants, QA allowances, recipient rules or webhook configuration.

Assert AI/importing remain disabled; saved-card top-ups/auto-recharge remain off. Existing owner approval of purchase requirements does not authorize execution of this gate during the current PR task.

## 4. Functions deployment gate — held

Deploy only the approved merged Pages Functions. No coordination/cleanup Worker deployment is required. Verify the exact approved SHA and health, new checkout fails closed if migration0020 is missing, and confirmation/signed reconciliation of historical orders remains independent of current checkout availability. No live purchase, mail or AI request.

## 5. Frontend release gate — held

Deploy the matching assets, routing and frontend; verify release marker, both purchase-page declarations, review messages, mobile layout and service-worker asset consistency. A Functions deployment is not frontend acceptance. Both declarations apply to paid provider checkout, including business purchasers in the US; clients remain free and no country is excluded.

## 6. Owner/device and business readiness gate — still required

Owner completes installed PWA update/reopen, capture permissions, offline draft recovery and isolated backup restoration. Do not overwrite real work. Owner/operator also clears:

- Canadian federal/BC/Quebec forecasts/thresholds and Saskatchewan/Manitoba requirements; the business-only scope does not eliminate provincial software taxes.
- Eligible UK/EU business evidence/reverse-charge treatment and correct invoices. A sole trader can be a business without a VAT number; accept appropriate documented evidence where allowed rather than treating it as a government-verified tax ID.
- Foreign credit-pack classification and tax timing; NY's tax-at-purchase decision is not a foreign ruling.
- Customer DPA/transfer safeguards, representative requirement or justified exception, public seller/contact details and Quebec language applicability. See `business-data-handling-review.md` for the review worksheet. No paid adviser, representative, registration, filing, MoR or invoice service is enrolled by this PR.
- Stripe restricted-key Customer/tax-ID read permissions, actual invoice/receipt content, and live tax registrations where required. Receipt creation is not proof of a compliant VAT invoice. Optional Stripe one-time invoice creation is separately priced and remains off.

If automatic checks are pending, customer uses Check again. If manual evidence is needed, follow the operator process below. Do not grant app access, tax exemptions or credits merely to make QA pass.

## Operator review of pending/unavailable business tax evidence

No new public approval endpoint or verification database is added. Only an authorized Stripe operator can set the private Customer review metadata. This is tax evidence review, not provider professional vetting.

1. Confirm the live/test account, original order, Google subject, exact Checkout Customer and original Session tax-ID type/value. Independently verify the registration/business evidence and appropriate tax treatment using the authority's registry or reliable documents. Retain supporting evidence privately under the merchant's financial-record process. Do not post tax IDs or credentials in chat.
2. Prepare a private local JSON input with `verifiedByOperator:true`, `mode`, `orderId`, `subject`, `taxType`, `taxValue` and `basis` (`government_register` or `documentary_evidence`). Only run this after the actual review; self-declared evidence is insufficient. The following local command does not contact Stripe or approve anything:

   ```sh
   node scripts/prepare-business-tax-review.mjs < /private/tmp/streamlion-private-tax-review.json
   ```

3. Under separate approval for the customer tax correction, set only the returned `streamlion_business_tax_review` metadata on that exact Stripe Customer, preserving other fields. The token binds mode/order/account/type/value and expires after7days. Application accepts no more than30days. It cannot override an invalid (`unverified`) ID, a different order/account/ID or stale metadata.
4. Reconfirm the existing Session through StreamLion. Expect exactly one access/pack grant. Do not create another checkout or reset allowances. An invalid original ID or disputed classification needs a proper invoice/tax/refund correction through the merchant process; metadata is not a way to waive tax or rewrite the original calculation.

## 7. Sales-opening gate — separate owner authorization

NY registration is scheduled for October24, 2026 at `04:00 UTC`, midnight New York; verify it is active before NY taxable sales. This schedule neither opens checkout nor clears other jurisdictions. Open only after the relevant readiness evidence and phone QA pass and the owner explicitly authorizes sales. AI/importing remain off. Do not perform a mandatory real-card trial charge; sandbox/mocked evidence is separate from genuine commercial settlement.

## Sources and limitations

- [Stripe tax-ID collection/verification](https://docs.stripe.com/tax/checkout/tax-ids): format acceptance does not establish government validity; Guest Customers lack validation events.
- [Stripe zero-tax reasons](https://docs.stripe.com/tax/zero-tax): missing registrations may produce zero tax.
- [Stripe receipts/invoices](https://docs.stripe.com/receipts): one-time paid invoice creation is separately priced.
- [HMRC digital services](https://www.gov.uk/guidance/the-vat-rules-if-you-supply-digital-services-to-private-consumers), [EU OSS](https://europa.eu/youreurope/business/finance-and-tax/vat/one-stop-shop/index_en.htm), [CRA digital thresholds](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/digital-economy-gsthst/find-out-need-register/cross-border-threshold-amounts.html).

This is a technical release plan and policy draft for owner review, not a foreign tax determination. Mocks establish application behavior; they do not issue registrations, certify documents, prove inbox delivery or operate the owner's phone.
