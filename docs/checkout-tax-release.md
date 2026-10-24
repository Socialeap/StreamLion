# Tax-aware Checkout: review and separate release gates

Status: review only. Checkout remains paused in production; AI, brief importing
and saved-card sales remain off. This document does not authorize a migration,
configuration change, deployment, real tax registration, paid service or sale.

## Implementation

- `STREAMLION_CHECKOUT_TAX_MODE` defaults to `off`. Only `off` and `stripe`
  are accepted. No existing Wrangler setting, credential or API version changes.
- With `stripe`, Core and credit Checkout require an explicit product tax code,
  an explicitly tax-exclusive price, and migration 0019. No fallback to the
  account's unspecified price behavior or generic product classification.
- Credit Checkout additionally requires
  `STREAMLION_CREDIT_TAX_TREATMENT=tax_on_purchase`. This represents a separately
  confirmed merchant decision, not a legal determination by the application.
  If packs must instead be taxed at redemption, keep their sales closed: this
  PR does not implement tax collection at redemption.
- Each new taxed order persists `checkout_tax_mode=stripe`. Existing orders
  default to `off`. Retries keep the original parameters and idempotency key,
  even if current tax configuration changes. Before retry Session creation, the
  exact order price is revalidated against its saved tax mode, including when
  that price is no longer in the current catalog. The additive migration preserves
  order, wallet, grant, event, identity, project and draft history.
- New taxed Checkout collects a billing address and enables Stripe automatic
  tax. Stripe displays tax and the final total. No tax rate is hardcoded.
- Paid reconciliation requires a complete tax calculation, an integer tax
  amount, total = original subtotal + tax, and the matching captured charge.
  Zero tax with a complete calculation is allowed; it does not establish a
  legal exemption or prove a registration exists.
- Credits are granted from the pack's fixed credit quantity, never its gross
  payment. Partial gross refunds revoke credits proportionately, rounding
  toward safety; full refunds revoke all. Core access remains after a partial
  refund and is revoked on full refund. Tax reversal/reporting is Stripe's
  responsibility; verify its sandbox tax record separately. This code does not
  initiate refunds or implement tax-only adjustments.
- Tax-enabled orders do not save/reuse a Stripe customer/card. Direct saved-card
  PaymentIntent top-ups fail closed while tax mode is `stripe`, because that
  path does not calculate tax. Existing payment confirmation, card removal and
  signed webhook reconciliation remain available, including with checkout
  paused or invalid current tax configuration.

## 1. Review and merge gate — owner

Review this PR and its checks. Do not merge as part of the current authorization.
The review and all later gates are independent.

## 2. Isolated sandbox acceptance gate — Codex, then owner if prompted

Use the existing **Transcendence Media** private sandbox,
`acct_1TMcTVIymyyYttjt`, not the live account or its legacy shared test mode.
Confirm the Stripe Dashboard says **Sandbox** and every API object has
`livemode=false`. Use only a sandbox key and disposable local SQLite migrated
from the committed SQL. Use synthetic identities and `example.com` addresses;
no production D1, Google account/workbook, customer record or secret binding.

The initial October 18 (New York time) read-only preflight found Stripe Tax
pending with no sandbox head office or active registrations. Automatic approval
review initially held setup. The owner subsequently explicitly authorized the
simulated sandbox configuration and $0 tests; acceptance completed October 19
UTC / October 18 New York time, against application code `f22e06d`.

Executed scope: the existing private sandbox only, its empty head office filled
with fictional QA data, one simulated NY state-sales-tax registration expiring
after 24 hours, two tagged test products and five exclusive test prices.
Existing sandbox defaults and objects were preserved. No real government
registration, paid service, production migration/configuration/deployment,
Google write, AI call or email was performed.

| Completed sandbox case | Subtotal |   Tax |  Total | Result                                                                     |
| ---------------------- | -------: | ----: | -----: | -------------------------------------------------------------------------- |
| Core launch, NYC       |   $29.96 | $2.66 | $32.62 | Purchase, confirmation, partial/full refunds and access revocation passed. |
| Core standard, Buffalo |   $39.95 | $3.50 | $43.45 | Same checks passed; local rate differs from NYC.                           |
| 800-credit pack, NYC   |   $10.00 | $0.89 | $10.89 | Exactly 800 credits, then proportional/full revocation.                    |
| 2,000-credit pack, NYC |   $25.00 | $2.22 | $27.22 | Exactly 2,000 credits, then proportional/full revocation.                  |
| 4,000-credit pack, NYC |   $50.00 | $4.44 | $54.44 | Exactly 4,000 credits, then proportional/full revocation.                  |

Five distinct hosted sandbox Checkout payments and ten successful refunds were
read back from Stripe. The local app database contains exactly two refunded
Core orders and three refunded credit orders, with zero purchased-credit
balance. Replayed and late completion events did not duplicate or reinstate
entitlements. Starter-grant idempotency was checked separately, once per
synthetic account. Stripe's actual sandbox tax ledger contains all five payments
and ten reversals: gross and tax each net to zero.

A California preview completed with zero tax and explicit
`taxability_reason=not_collecting`, consistent with the sandbox's NY-only
registration. This is not a customer exemption determination. An empty billing
address prevented the first test submission; the missing/failed-calculation
and malformed-total cases also pass the isolated mocked tests.

Hosted Checkout, tax calculation, payment and refund evidence came from Stripe
sandbox; confirmation/restoration and webhook reconciliation ran against the
actual app handlers and disposable local SQLite. Signed envelopes were generated
for that local fixture, with real sandbox API readback. No production or publicly
exposed webhook delivery, real Google sign-in or production settlement is claimed.

931 unit/integration tests and the required GitHub `verify` check passed for the
application change. All live sales, AI/importer and deployment gates below remain
closed. Receipt packet: workspace `artifacts/tax-checkout-2026-10-18/sandbox/`.

Sandbox configuration is not an application for a real tax certificate. If any
screen requests paid activation, a binding agreement or live registration,
stop and hand that screen to the owner. Existing account-wide sandbox defaults
and objects should remain unchanged; no destructive sandbox reset.

Acceptance matrix:

| Check                                         | Expected evidence                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core launch/standard Checkout                 | Tax-exclusive catalog; address required; tax and final total shown before test payment; one order/license after repeated confirmation.                       |
| NY tax/location                               | Two valid synthetic NY billing addresses produce completed location-based tax calculations; do not hardcode one statewide rate.                              |
| Other state                                   | Explain the taxability/registration reason for the resulting tax; zero tax is not exemption proof.                                                           |
| Missing/invalid address or failed calculation | Cannot grant a paid license or credits from an incomplete calculation.                                                                                       |
| All three packs                               | 800/2,000/4,000 purchased credits regardless of tax. Starter promotional grant remains separate and is not repeated.                                         |
| Restoration/replay                            | Same synthetic subject restores; duplicate and out-of-order completion/refund events do not duplicate/reinstate refunded grants.                             |
| Refunds                                       | Half-gross and full-gross test refunds, credit/entitlement readback, and corresponding Stripe tax reversal evidence. No separate tax-only refund assumption. |
| Safety                                        | Test keys/objects only, local database only; production gates unchanged; no AI, importing, email or real funds.                                              |

Local mocked-Stripe tests prove request parameters, calculations/validation,
signed handler behavior, migration preservation and ledger invariants. They do
not prove hosted Checkout, actual sandbox tax calculation, external webhook
delivery, settlement or merchant legal classification. An API-fetched sandbox
event re-signed for a local fixture is not a Stripe-signed public delivery.

## 3. Legal and business configuration prerequisites — owner

Seller: **Transcendence Media LLC**, based in NY. Its application is **pending
issuance**, not an active Certificate of Authority. Keep taxable NY sales closed
until the certificate is received and effective. Do not put application numbers,
tax IDs or certificate numbers in this repository or chat.

Confirm product classification (cloud/downloaded business software as appropriate),
credit tax timing, treatment of included promotional credits, customer location
and any multi-state use/apportionment. Do not classify credits as exempt gift
cards solely because they are called credits. Same-entity sales through other
channels can affect state obligations. None of this blocks isolated sandbox QA.

Approve future Stripe Tax usage pricing separately before enabling it live.
Recommended billing is Tax Basic pay-as-you-go; no Tax Complete subscription,
paid registration or filing service is enabled by this PR. Only StreamLion's
approved products/prices and valid registrations are in scope. Preserve shared
Stripe account defaults and unrelated products.

## 4. D1 migration gate — Cloudflare, after merge and explicit authorization

Migration: `migrations/0019_checkout_tax.sql`.

Export only SQLite schema definitions and version stamps (no project or credential rows), then run `node scripts/preflight-checkout-tax.mjs schema-state.json`. This read-only exact-shape check checks these three markers:

1. `checkout_tax_mode` in `PRAGMA table_info(streamlion_purchases_v1)`;
2. `checkout_tax_mode` in `PRAGMA table_info(streamlion_credit_orders_v1)`;
3. table `streamlion_checkout_tax_schema_v1`, containing exactly version 1.

When all are absent and prior purchase/credit schemas are present, apply the
committed migration byte-for-byte through D1's migration process. When all are
present with the expected default `off` and constraint `off`/`stripe`, verify and
skip. Entirely absent optional saved-card schema (0017) is accepted; a partial
optional schema stops preflight. Do not apply 0017 to release this tax migration.
Stop on any partial/mismatched state; do not replay the ALTERs, improvise
SQL or regenerate a migration. Take the existing recovery bookmark/receipt and
read back protected record counts and financial histories. No production
migration has been applied during this task.

## 5. Stripe/Cloudflare configuration gate — separate authorization

### Workers Free binding capacity

The closed-tax setup encountered the Workers Free limit of 64 runtime
variables: adding both tax flags to the prior configuration produced 66.
The temporary test-email overrides expired on October 12, 2026 and are no
longer declared in the production Wrangler profile. Their removal frees two
runtime variable slots. The effective email ceilings remain 20 attempts/day
and 500/month in both payment modes; recipient rules, budget history and
notification retry behavior are unchanged. Keep the temporary-override support
in the notification code for separately authorized future testing.

Use encrypted Pages Production bindings for
`STREAMLION_CHECKOUT_TAX_MODE` and `STREAMLION_CREDIT_TAX_TREATMENT`, matching
the existing server-only configuration mechanism. Dashboard plaintext values
outside the committed Wrangler `vars` list do not reach Functions in this
project. Preserve all credential bindings, existing private QA settings and
other modes. This configuration change requires its own review/merge and
closed deployment before claiming tax activation; it does not authorize an
upgrade or sales opening.

On October 24, 2026, the owner rechecked the NY business dashboard and reported
the certificate is still pending. The earlier October 24 date and any existing
Stripe registration schedule are not proof of issuance or permission to sell.
Do not duplicate or change a Stripe registration under the free-pilot task.
Checkout must stay paused until the certificate is actually issued/effective
and the separate legal, commercial and release approvals are satisfied.

Prerequisites: gates 2–4 accepted, applicable legal approval and explicit future
cost approval. Verify Stripe live account and exact StreamLion product/price IDs
against the current release receipt. Configure only confirmed tax codes and
exclusive prices (create reviewed replacement prices if the old explicit behavior
cannot be changed), effective registrations, and correct legal head office.
Never substitute a sandbox registration or mark an application as active.

Then set `STREAMLION_CHECKOUT_TAX_MODE=stripe`; set
`STREAMLION_CREDIT_TAX_TREATMENT=tax_on_purchase` only if that timing was confirmed.
Keep `STREAMLION_CHECKOUT_MODE=paused`, saved cards off, AI/importing off and all
other existing pilot, spend and approval settings unchanged. Tax configuration
alone never authorizes opening sales.

## 6. Functions deployment gate — separate authorization

Deploy the reviewed merged Functions SHA only. No cleanup/coordination Worker
change is required by this PR. Verify signed reconciliation remains available,
the tax-aware public configuration and paused Checkout. No AI or paid request.

## 7. Frontend release gate — separate authorization

Release matching assets and existing routing. Verify Core/Credits explain
applicable tax and final-total confirmation. Preserve service-worker recovery,
device drafts, account restoration and current project/folder selections.

## 8. Owner acceptance and opening gate — separate authorization

Owner phone QA is independent. Confirm accepted release receipts, sandbox
purchase/refund results and legal prerequisites; then request explicit sales
opening approval. Do not manufacture a real-card test purchase/refund. Observe
and reconcile genuine commercial transactions after authorized opening.

## Official references

- [Stripe Checkout tax parameters](https://docs.stripe.com/tax/checkout/page)
- [Stripe sandbox tax settings and simulated registrations](https://docs.stripe.com/tax/testing)
- [Stripe test cards; no real-card testing in live mode](https://docs.stripe.com/testing)
- [NY software tax guidance](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/computer_software.htm)
- [NY Certificate of Authority prerequisite](https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/how_to_register_for_nys_sales_tax.htm)
