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
  even if current tax configuration changes. The additive migration preserves
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

Read-only preflight on October 18 found Stripe Tax **pending**, no sandbox
head-office address and no active sandbox registrations. Actual tax-enabled
Checkout acceptance is blocked on this missing sandbox configuration. No
payment/refund, tax settings, registrations or catalog objects were created.
Automatic approval review rejected the command that would have initialized
simulated tax configuration; it was not retried or bypassed.

The next narrowly scoped sandbox approval, if the owner elects to give it, is:

> Approve simulated tax setup only in the existing Transcendence Media Stripe
> sandbox (acct_1TMcTVIymyyYttjt): fill its currently empty head-office address
> with fictional US/NY QA address data, add one simulated NY state-sales-tax
> registration, and create StreamLion-tagged disposable test products/prices.
> Run tax-aware Checkout with Stripe test cards, then partial/full test refunds
> against local disposable app data. Preserve existing sandbox objects and
> defaults, all live settings and records. No real government registration,
> paid tax service, live payment, production deployment or spending.

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
skip. Stop on any partial/mismatched state; do not replay the ALTERs, improvise
SQL or regenerate a migration. Take the existing recovery bookmark/receipt and
read back protected record counts and financial histories. No production
migration has been applied during this task.

## 5. Stripe/Cloudflare configuration gate — separate authorization

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
