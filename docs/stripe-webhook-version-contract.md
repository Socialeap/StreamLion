# Stripe request and snapshot version contract

StreamLion keeps two separate version contracts:

| Surface                                               | Version             | Purpose                                                                                 |
| ----------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| Outgoing Stripe requests                              | `2026-08-26.dahlia` | Explicit `apiVersion` pin in `server/stripe-purchase.js`; reused by the credit handler. |
| Current incoming Core/credit snapshots                | `2026-09-30.endive` | Version observed on both live Stripe destinations on October 29, 2026.                  |
| Legacy incoming snapshots covered by regression tests | `2026-08-26.dahlia` | Preserves the earlier test/replay contract.                                             |

These versions need not be identical for this JavaScript integration. Stripe
[versions snapshot payloads independently of outgoing SDK requests](https://docs.stripe.com/upgrades#update-your-event-destinations).
The SDK verifies the signature of the original body. StreamLion reads the
snapshot's routing metadata/session or PaymentIntent ID, checks payment mode
and product, then re-fetches current Stripe objects with the pinned client
before reconciling entitlement, refunds, disputes or credit balances. A signed
snapshot claiming payment is not itself proof of current payment.

Retain both existing live endpoints and their signing secrets. Do not change
the outgoing request version, Stripe account default, SDK version, endpoint
configuration, prices, quotas or checkout gate to make the two version strings
match. An outgoing major-version upgrade is a separate change: it can alter
request parameters as well as response shapes.

## Bounded regression acceptance

Run:

```sh
node --import tsx --test functions/api/stripe-purchase.test.js functions/api/stripe-credits.test.js
```

The regular signed-event fixtures now carry explicit Endive snapshot envelopes.
The added lifecycle matrix also runs both snapshot versions in both payment
modes through the actual purchase and credit request handlers, using the real
Stripe SDK for signature parsing, an in-memory ledger and mocked provider
transport. It exercises all nine ordinary subscribed event types, including:

- A signed paid snapshot against an unpaid current object grants nothing.
- Completion, asynchronous success/failure and expiry reconcile current payment
  rather than trusting stale snapshot status; replay does not double-credit.
- Dispute creation/withdrawal blocks access or funding; current reinstatement
  and closure restore only what the authoritative objects support.
- Partial/full refunds and late completion preserve the current refunded state.
- Product/account/payment-mode isolation and signature rejection remain intact.
- Outgoing mocked SDK requests must still send `Stripe-Version:
2026-08-26.dahlia`; checkout stays paused during reconciliation.

These are synthetic compatibility/regression checks, not actual Stripe
delivery or proof that deployed signing secrets match their destinations. Do
not call them a paid production transaction, successful bank refund, complete
provider-schema conformance or a new live end-to-end payment receipt. An actual
delivery/financial smoke test remains separately authorized, with the
certificate, owner/device acceptance, spend ceiling and sales-opening gates
kept distinct.

## Observed live destinations — October 29, 2026

Read-only observation, not activation authority:

| Purpose | ID                            | URL                                                              |
| ------- | ----------------------------- | ---------------------------------------------------------------- |
| Core    | `we_1US2aeCQXdxBxU8GTGFkrrom` | `https://streamlion.transcendencemedia.com/api/purchase/webhook` |
| Credits | `we_1US2c1CQXdxBxU8GYvnG2Jmj` | `https://streamlion.transcendencemedia.com/api/credits/webhook`  |

Both were Active, **Your account**, snapshot payloads at
`2026-09-30.endive`, with exactly the nine events in
`docs/ai-credit-activation.md`. Optional saved-card top-ups have their own
additional-event and permission gates and remain disabled in this closeout.
No secret values are recorded here.

## Release classification and stop conditions

This correction changes tests, synthetic fixtures and activation documentation
only. No production runtime, migration, D1 state, Cloudflare/Stripe setting,
secret, endpoint, frontend asset or paid service change is required. Review and
merge the PR separately; no backend activation or frontend deployment is needed
for this correction. No Lovable action is required.

Keep checkout paused. A later readback showing a different snapshot version,
URL, event set, account scope, disabled endpoint or delivery error is a fresh
verification item: inspect the exact change and retest the consumed payload
fields before accepting it. Never rotate credentials, recreate an endpoint,
upgrade API versions or replay live events to clear a documentation mismatch
without the owner's explicit approval.
