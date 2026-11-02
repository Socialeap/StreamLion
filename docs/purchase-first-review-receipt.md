# November 2 purchase-first review receipt

Owner TO-DOs

1. Review [PR #147](https://github.com/Socialeap/StreamLion/pull/147) and approve merge. Keep `[CF-Pages-Skip]`. This receipt establishes source/sandbox evidence, not a Production release.
2. No upfront deposit is required. The approved $100 USD Stripe minimum balance accumulated from sales is enabled and verified. See the superseding funding decision below; other release/QA gates remain.
3. After Codex deploys the reviewed merged revision with checkout paused, complete physical-phone/installed-PWA sign-in, onboarding, save/retrieve, export and backup QA on isolated owner data. Resolve the hosted 3DS challenge acceptance gap before paid opening.
4. Review the closed-release receipt and report owner QA results. Codex then performs the separately recorded checkout-opening step within the existing authorization when all gates pass. No additional generic live-action approval or mailed-certificate delivery is required.

## Superseding funding decision — November 2

The owner replaced the upfront deposit prerequisite with a $100 USD minimum balance accumulated from incoming sales. The live shared Stripe seller setting was saved and verified after reload, with daily payouts/destination unchanged and no bank transfer. Earlier deposit/funding prerequisites below are historical and superseded. Do not wait for $100 accumulation to open under this approved arrangement; other technical/QA release gates remain. A configured minimum is not cash already available: settlement delays and retained processing fees still affect refund funding. See the current release packet. PR #147 is now merged as `1fb2087774aad05a76527c294299b50c704eb520`.

## Source and scope

Runtime source tested in the final sandbox cycle: `e70905303970d2d958358e5b484288048e56562f`, based on main `57cf9bcd75632e6acfd2118c8c4ca631a83709f3`. Later receipt/runbook-only commits do not change that tested runtime tree. The reviewed merged SHA does not exist yet and must be recorded before deployment.

The change adds the $29.95 one-time Core offer, the approved December 31 New York cutoff followed by $39.95 for new checkouts, an unconditional 14-day refund request, durable automatic processing and matching account/terms/landing/admin copy. Purchased access has no age expiry. Historical orders, pilot promises, Google files and credit wallets remain separate. See [the release packet](purchase-first-release.md) for migration/configuration, ordered closed release, stop conditions and compatible rollback.

## Verification actually performed

- `npm test`: **1,223 passed, 0 failed/skipped**, after the final runtime fix. Local Workers/D1 listeners required the authorized host execution environment.
- `node --import tsx --test functions/api/core-guarantee.test.js functions/api/core-guarantee-runtime.test.js functions/api/stripe-purchase.test.js`: **63 passed** after the mode-verification fix. The recovered-refund-ID follow-up additionally passed all 62 non-runtime focused tests and the full suite above.
- `npm run build`: passed. `npx wrangler pages functions build --outdir=/private/tmp/streamlion-final-functions --compatibility-flags=nodejs_compat`: passed. `npx wrangler deploy --dry-run --config ops/wrangler-core-refunds.jsonc --outdir /private/tmp/streamlion-final-refund-worker`: passed. The final runtime was also actually bundled/deployed into the disposable sandbox receiver.
- `npm run verify:capacity`, `npm run verify:scale`: passed during implementation. `npm audit --audit-level=high`: passed with zero high/critical findings; 12 moderate and 3 low findings remain. Dependencies were unchanged.
- Isolated local Chrome fixtures at 1280×900 and 390×844 verified the offer/date, navigation, distinct pending/succeeded states, retained backup control after refund, and no page errors, overlay or horizontal overflow. These were simulated responsive browser checks, not physical devices or live Google data operations.
- Unit/Workers tests cover exact inclusive refund boundaries, timely receipt processed later, duplicate/concurrent requests, retry/lost response, pending/failed refunds, gross amount including tax, existing paid-order preservation, purchased access after day 14, held checkout, offer cutoff, schema preflight and default-disabled processing.

## Real Stripe sandbox acceptance

Dedicated sandbox `acct_1UW65eCFI7vOrS96`, disposable D1/Worker `streamlion-guarantee-qa-20261102`, synthetic identity/address and documented Stripe test cards only. Existing sandbox key reused, no real funds. Authentication was verified through the actual application session/account checks using an isolated synthetic session; it did not exercise normal Google OAuth or customer files in this receiver.

The $29.95 order calculated $2.66 New York tax and a $32.61 gross payment. A genuine insufficient-funds decline granted no access. Real signed `payment_intent.succeeded` and `checkout.session.completed` deliveries set the immutable payment timestamp and purchased entitlement without success-screen trust or manual confirmation recovery.

The first automatic cron run issued a full $32.61 refund, but exposed a reconciliation bug: Stripe's actual Refund object omits `livemode`. The strict fixture had invented that field. Regression tests reproduced the failure, then the implementation verified the parent Charge's mode and bound each refund by charge/currency/amount/status. The scheduled retry discovered the existing refund without issuing a duplicate and reconciled the target entitlement. A second regression ensures a recovered own refund's provider ID is retained. See [Stripe's Refund object](https://docs.stripe.com/api/refunds/object).

First payment: `pi_3UXTdZCFI7vOrS961GK5PFkN`; full succeeded refund: `re_3UXTdZCFI7vOrS961DLJSiUZ`. Stripe Tax's actual sandbox ledger showed the $32.61/$2.66 collection (`tax_1UXTcgCFI7vOrS963K53LTMZ`) and matching negative refund (`tax_1UXTjuCFI7vOrS96DAl0Lft2`), net gross and tax zero. This is provider ledger evidence, not an inference from application state.

The final clean cycle used payment `pi_3UXTtrCFI7vOrS961P6IkzfP` and full succeeded refund `re_3UXTtrCFI7vOrS961zvH6lvJ`. The authenticated request was received at `2026-11-02T22:44:35.580Z`; the scheduled Worker recorded success at `22:44:54.380Z`, on its first attempt. Genuine `refund.updated` and `charge.refunded` deliveries returned 200 and the order became `refunded` for the gross 3261 cents. One concurrent `refund.created` delivery returned retryable 503; do not report that every event delivery was successful. The queue and ledger converged without a manual refund or relying on that delivery. Exact tax ledger records `tax_1UXTryCFI7vOrS96xP8hZQZS` (collection) and `tax_1UXTyPCFI7vOrS96cmE0fnjA` (reversal) show another matched $32.61 gross/$2.66 tax pair. Both payments and both tax collections net to zero.

Cleanup disabled only this run's sandbox webhook, expired its simulated registration, archived the synthetic ledger, deleted the disposable Worker/D1 and removed the temporary local key. Existing sandbox history/key/product remain preserved. Final read-only Production receipt at `2026-11-02T22:47:51.170Z` confirmed the same serving SHA/deployment/configuration fingerprint and financial/pilot aggregates. Core checkout remains paused, tax mode is Stripe and the pilot remains disabled; migration 0026 remains pending. Private local artifacts are in the workspace's `artifacts/purchase-first-2026-11-02/`; secrets are excluded from source.

Stripe's live reserve controls offer **Refunds and disputes balance — USD**, with manual bank-transfer instructions and an estimated 0–3 business-day arrival. Those instructions are left open for the owner. No transfer was initiated and no payout/minimum-balance setting was changed. Wait for actual available reserve funds before sales opening.

## Remaining launch gates and limits

- **Codex:** finish/recheck the hosted authentication challenge in a working sandbox browser. Two documented 3DS cards reached Stripe's challenge frame, but it rendered blank; the alternate intent was verified `requires_action`/unpaid. No access was granted while authentication was incomplete. Recovery followed by an ordinary test card succeeded. Completed or cancelled 3DS challenge acceptance is still missing; do not weaken authentication to pass it.
- **Owner:** source merge approval; actual $100 reserve funding; physical-device Google workflow acceptance after the closed release. The reserve is approved, not yet funded, and covers only three $32.61 refunds at the tested tax rate. Maintain funding as gross guarantee liability grows; do not imply a sales/admission cap.
- **Codex/Stripe:** restricted Production refund-write credential and Pages refund-read permissions, scoped price/event changes, exact additive migration preflight, closed Pages/Worker deployment and receipts. No Production write/deploy or live-money test is established by this review receipt.
- **Tax records:** NY issuance confirmed November 2; actual effective date unverified. The mailed certificate and inaccessible dashboard document are not prerequisites to validating/enabling Stripe Tax. Existing live NY registration and tax settings are active; do not duplicate them or guess a date.

Backend Activation Required: YES — after reviewed merge, apply/verify committed `migrations/0026_core_guarantee.sql` on Cloudflare Production D1 `streamlion-google-sessions`; create the scoped $29.95 Stripe Core price/add the four named Core webhook event types/verify restricted permissions; configure and deploy `streamlion-core-refunds` plus matching Production Pages/Functions `streamlion` with checkout paused. Funding, refund-processor activation, served QA and eventual `STREAMLION_CHECKOUT_MODE=open` remain ordered gates in the release packet.

No Lovable action is required.
