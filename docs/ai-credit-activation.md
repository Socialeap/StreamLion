# StreamLion prepaid AI credits: activation and acceptance

**HOLD — ACTIVATE ONLY AFTER THIS PR IS MERGED AND THE OWNER APPROVES THE TEST CONFIGURATION.**

Backend, frontend, additive durable D1 state, Stripe catalog/webhooks and server-only configuration are separate release gates. The implementation does not open live sales or increase provider spending on merge. Use the existing Cloudflare Pages project `streamlion`, D1 `streamlion-google-sessions` / `GOOGLE_SESSIONS`, Google and Stripe account `acct_1JnHIaCQXdxBxU8G`. The repository's StreamLion boundary excludes Lovable; any conflicting generic handoff instruction needs an owner decision before activation. No Supabase objects are involved.

## Commercial policy

Core StreamLion is $39.95 USD once; the already approved first-200 launch offer remains $29.96. Optional AI top-ups are $10 / 800 credits, $25 / 2,000 credits and $50 / 4,000 credits, plus any applicable owner-configured tax. No subscription, expiry, automatic recharge, discount or customer API keys. One fixed credit represents 12,500 internal micro-USD units; balances and quoted charges use that same denomination. Each completed text answer costs `ceil(approved_cost_micros * 1.30)` internal units. The quote is shown before use and rechecked server-side. This implements the owner's **30% markup on an approved estimated fully loaded per-answer cost**, not actual-token invoice reconciliation or a 30% gross margin. Review AI, attempted hosted speech, hosting, support and payment fees in that cost before approval. Existing pilot grants have no cash value and never become purchased credits.

Only authenticated Google accounts with a verified app purchase can top up or spend commercial credits. Stripe Checkout uses one server-selected Price and one unit. Signed fulfillment reconciles current Stripe payment/refund/dispute state. An incomplete text answer returns reserved customer credits once; completed text remains charged when speech fails. Refunded/disputed credits are revoked proportionally; spent refunded credits can leave a negative ledger balance that prevents further AI use until resolved. The UI reports a hold rather than presenting a negative available balance. Refund requests for unused AI credits are manual through `info@transcendencemedia.com`, separate from the core app's seven-day guarantee; review final terms/tax treatment before live sales.

## Read-only setup evidence: 2026-10-06 / 07 UTC

The production D1 read showed none of the purchase or credit markers and no `d1_migrations` table. The existing pilot remains active with price 12,500, daily reservation budget 180,000 and 30 daily requests; its cumulative ceiling remains unchanged. This inspection applied no migration and changed no policy or wallet.

Test-mode catalog created and visibly verified in the existing Stripe account:

| Setting                  | Test value                                |
| ------------------------ | ----------------------------------------- |
| `STRIPE_PRODUCT_ID`      | `prod_VOWPvm1he8b3Cl`                     |
| `STRIPE_PRICE_ID`        | `price_1UNjN8CQXdxBxU8GFkLU0Siv` ($39.95) |
| `STRIPE_LAUNCH_PRICE_ID` | `price_1UNjPMCQXdxBxU8GhQNfjysg` ($29.96) |
| `STRIPE_AI_PRODUCT_ID`   | `prod_VOWWsquUsWYtLj`                     |
| `STRIPE_AI_PRICE_10`     | `price_1UNjTfCQXdxBxU8GsAbS0o5C`          |
| `STRIPE_AI_PRICE_25`     | `price_1UNjUwCQXdxBxU8Gc6h4DBaA`          |
| `STRIPE_AI_PRICE_50`     | `price_1UNjVDCQXdxBxU8GVZdjSaH3`          |

Core metadata is `app=streamlion`. AI product metadata is `app=streamlion`, `kind=ai_credits`. All five Prices are USD one-time. Existing F|3D objects were preserved. No live product, restricted key, webhook destination, real payment or provider call was created by this evidence snapshot. Webhook configuration is prepared for owner confirmation; delivery is unverified. The Stripe dashboard offers `2026-08-26.dahlia`; the client explicitly pins that version, even though SDK 23 defaults to a newer version. Do not upgrade the account-wide API version to accommodate this integration.

## D1 idempotent preflight: Cloudflare owner, after merge

Sync the current approved merged `main` and record its full SHA. Obtain a Cloudflare D1 recovery bookmark first (`wrangler d1 time-travel info streamlion-google-sessions --env production --json`). Apply no unrelated pending migration and never copy the production database or Google credentials into a preview. Use only the named committed files byte-for-byte through a transactional D1 migration runner.

Purchase prerequisites are exactly `migrations/0004_streamlion_purchases.sql` and `migrations/0005_streamlion_launch_200.sql`. Follow [the purchase activation preflight](./stripe-activation.md#1-d1-preflight-cloudflare-owner-after-merge) verbatim: verify all seven original definitions and v1 stamp; apply 0004 only when all original/v2/staging markers are absent; apply 0005 only when the complete original schema matches and v2/staging are absent. Skip only on a full final-schema match with stamps 1 and 2. Stop on any partial state, leftover `streamlion_purchases_200_stage`, definition mismatch or incorrect stamp.

Then query all **13** credit markers:

```sql
SELECT name,type,sql FROM sqlite_master WHERE name IN (
 'streamlion_credit_policy_v1','streamlion_credit_wallets_v1',
 'streamlion_credit_orders_v1','streamlion_credit_pending_v1',
 'streamlion_credit_grant_v1','streamlion_credit_turns_v1',
 'streamlion_credit_turns_time_v1','streamlion_credit_reserve_v1',
 'streamlion_credit_debit_v1','streamlion_credit_transition_v1',
 'streamlion_credit_return_v1','streamlion_credit_events_v1',
 'streamlion_credit_schema_v1'
);
```

- All absent: apply committed **`migrations/0008_streamlion_ai_credits.sql` byte-for-byte in one transaction**, then verify all 13 definitions, version 1 and both initial policy rows. Default rows have `active=0`, `cost_micros=0`, all budgets/limits 0. No grants or provider calls are installed.
- All present: compare all definitions to committed 0008, verify exactly version 1 and both test/live policy rows, and skip the migration only on a full match. Existing balances/policy are not reset.
- Partial presence, wrong stamp, missing policy mode or mismatched definition: **stop and report**. Never generate, substitute, repair, drop or replay a migration, and never invent a platform migration stamp. Record the actual platform stamp if one exists; otherwise report it absent along with the schema stamps.

Preserve all Google, ChatGPT extension, pilot, purchase, credit and webhook records. D1 has no Supabase RLS/grants; security is authenticated server-only access, account/mode-bound queries, constraints, atomic triggers and signed webhooks. Verify no public client binding or balance-write route is introduced.

## Stripe and server test configuration

Follow [purchase setup](./stripe-activation.md#2-stripe-test-setup-ownerdashboard-or-explicitly-authorized-api) for the shared account/key and core settings. A new restricted key is a separate security-access confirmation; the owner enters it directly into Cloudflare secrets, never chat/repository/VITE variables. Required permissions are Checkout Sessions read/write and Accounts, Products, Prices, Payment Intents, Charges and Disputes read only. No refund-write, transfer, payout, customer deletion or unrelated-product change.

Create/reuse two **test** webhook destinations:

- `https://streamlion.transcendencemedia.com/api/purchase/webhook` → `STRIPE_WEBHOOK_SECRET`
- `https://streamlion.transcendencemedia.com/api/credits/webhook` → **independent** `STRIPE_AI_WEBHOOK_SECRET`

Both receive **Your account** snapshot events at `2026-08-26.dahlia` only: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`. Never subscribe all events, change existing F|3D endpoints or use connected-account events. Both handlers ignore the other product's fulfillment. Store signing secrets directly in Cloudflare. Record endpoint IDs/version/event sets without secret values.

Server settings for the test environment:

| Setting                                                            | Value                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `STREAMLION_PAYMENTS_MODE`                                         | `test`                                                                                            |
| `STREAMLION_AI_CREDITS_MODE`                                       | `test`                                                                                            |
| `STREAMLION_AI_CREDIT_SALES_ENABLED`                               | `true` only after test catalog/secrets/schema are verified                                        |
| `STREAMLION_REQUIRE_LICENSE`                                       | `false` initially, preserving current testers; paid credits independently require an app purchase |
| `STREAMLION_REFUND_DAYS`                                           | `7`                                                                                               |
| `STRIPE_ACCOUNT_ID`                                                | existing account above                                                                            |
| `STRIPE_SECRET_KEY`                                                | owner-entered test restricted key                                                                 |
| `STRIPE_WEBHOOK_SECRET`, `STRIPE_AI_WEBHOOK_SECRET`                | separate owner-entered test endpoint secrets                                                      |
| Five core/AI Price and two product IDs                             | verified test IDs above                                                                           |
| `STREAMLION_LIVE_PAYMENTS_APPROVED`, `STREAMLION_AI_COST_APPROVED` | absent/false                                                                                      |

Keep both credit policy rows inactive/zero during test fulfillment. Test balances cannot authorize live OpenAI/DeepInfra calls, even if pilot keys exist. Setting test credit mode temporarily makes the AI route fail closed as `credits_not_active`; schedule that controlled test with the owner instead of silently interrupting pilot QA. Do not rebind production Google credentials to a public preview. Deploy only the approved `streamlion` Pages/Functions release: core purchase, `/api/credits/{config,status,checkout,confirm,webhook}`, paid `/api/ai`, fixed Google OAuth return and middleware, plus their committed frontend. No unrelated functions/provider settings/secrets, data edits or services.

Activation spend ceiling **$0**: no real purchase/refund, real model request, search, external AI tool, new paid service, upgrade or auto-recharge. Fail closed on missing provider configuration, absent approval, unavailable policy/credit check, insufficient funds, changed quote, paused policy, capacity or mode mismatch. Existing supervised pilot approvals do not authorize new commercial/provider spend.

## Acceptance and live approval

1. Read-only health: `node scripts/verify-credits.mjs https://streamlion.transcendencemedia.com test`, the purchase verifier and release verifier. These create no Checkout/model request. Check exact merged release SHA separately.
2. With a synthetic, signed-in Google account, perform a core test purchase and a credit top-up using test card data; inspect the same order in Stripe, HTTP 200 signed webhook and wallet readback. Repeat delivery/out-of-order events, refresh/close/reopen, cancel/retry, changed selected pack and return while sales are paused. No duplicate grant/payment. A different Google account gets no access to the order or balance.
3. Test partial/full refund, unresolved/won dispute and refund after simulated spent credits; debt blocks spending and old completion cannot restore refunded credit. Do not manually edit balances to pass acceptance. Test charges must never fund live provider calls or pilot balances.
4. Check desktop and physical Android: hosted Checkout, Google callback, correct account/balance, installed PWA refresh and credit quote. Local synthetic viewport proof is not device, Google, Stripe settlement or hosted voice proof.

Before commercial activation the owner must accept this receipt, tax/terms/core entitlement plan, live catalog/key/webhooks and exact cost/reservation ceiling. Validate that **6,000 micro-USD per attempted bounded answer including hosted speech** remains a conservative provider estimate for current `gpt-6-luna`, `hexgrad/Kokoro-82M` rates and implementation limits (10,000 context bytes, 240 output tokens, 900 answer characters). If it is insufficient, stop for a reviewed code/migration change. It is an estimated application reservation, not a provider-enforced dollar cap or actual invoice reconciliation. Approve fully loaded `cost_micros` (minimum 6,000), cumulative/daily provider reservation budgets and daily requests explicitly; no commercial allowance is assumed.

Only then set live counterparts, `STREAMLION_LIVE_PAYMENTS_APPROVED=true`, `STREAMLION_AI_COST_APPROVED=true`, and the exact approved live policy. Enable commercial sales last. Keep `ENABLE_AI_PILOT=true` as the existing provider gate; commercial credit mode selects the new ledger and never alters pilot grants. Live provider and payment QA requires its own explicit owner spend limit. Retain functioning live webhooks after sales pause (`STREAMLION_AI_CREDIT_SALES_ENABLED=false`) so refunds/disputes still reconcile. To stop AI use set paid policy `active=0`; preserve mode, metadata and records. Do not return to pilot mode as a paid-credit rollback.

## Required concise receipt

Owner shares approved merged main SHA; backup bookmark; 0004/0005/0008 result and actual platform stamp/absence; schema stamps 1/2/1 and definition match; authentication/account/mode isolation and server-only security result; configuration names/presence only; exact Stripe account/mode/product/price/webhook IDs/version/events; exact Pages Functions deployment ID/SHA; one non-credit-consuming health result. Frontend release/landing revision, authenticated test purchase/top-up/refund/restoration, physical Android and any separately authorized live AI/payment result are separate gates. **No activation-complete claim before that receipt.**
