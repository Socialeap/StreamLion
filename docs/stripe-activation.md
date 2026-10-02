# StreamLion one-time purchases: activation and acceptance

**HOLD — ACTIVATE ONLY AFTER PR MERGE AND OWNER CONFIGURATION APPROVAL.**

## Release classification

Backend + frontend + durable D1 state + server-only secrets + Stripe provider setup. This PR does not activate payments on merge. The owner must approve the final price, refund period and live sales separately. Default payments mode is disabled; existing Google/PWA use continues until the owner explicitly enables license enforcement. StreamLion uses GitHub, Cloudflare and Google Cloud. **No Lovable action is required.** No Supabase migration, paid upgrade, new account, auto-recharge or LLM API is involved.

Use existing Stripe account **3DPS by TM**, Transcendence Media LLC, `acct_1JnHIaCQXdxBxU8G`. StreamLion is a separate product within this business; do not edit, delete or replace F|3D products, prices, payment links or webhook endpoints. Changes to the account-wide descriptor affect other sales and require a separate reviewed change. Recommended full descriptor `FRONTIERS3D`, shortened card prefix `FRONTIERS` (max 10 characters), purchase suffix `STREAMLION`. This code sets only the purchase-specific suffix and Checkout display name.

All project content stays in Sheets/Drive. D1 records purchases, refunds, disputes, account binding and minimal webhook receipts. The license belongs to the Google subject selected **before** checkout, not to a mutable checkout email, device or workbook. No full card details, Google tokens or project data are sent to Stripe. The existing OAuth flow returns a buyer to `/api/purchase`; its return destination is an encrypted fixed allowlist value.

## Price/policy approval gate

Proposed existing landing offer: $39.95 USD standard, $29.96 USD for 100 launch-price places reserved when checkout starts. The backend reads approved Stripe Price objects, never browser amounts. An optional launch Price uses 100 transactional reservations. Pending/processing payments hold their slots; confirmed expired/failed checkout releases its slot. Completed purchases, including later refunded purchases, keep the historical place. Missed expiry events conservatively hold places until their Stripe events are redelivered; do not free reservations with guessed SQL.

The owner must choose **14 or 30 days** for the full-refund period before configuring `STREAMLION_REFUND_DAYS`. No recurring subscription. Review the committed purchase terms and privacy additions, price and tax treatment before live sales. Stripe Tax is **not enabled** by this integration; do not enable paid automatic tax or represent tax compliance as completed without an owner decision. Configure any required tax registrations/tax rates before live sales. The current code accepts the configured Price's tax behavior; amounts/taxes must be checked in the test Checkout receipt. No new paid services during activation; incremental activation spend ceiling **$0**, with test cards only. Stop if an upgrade is required.

## 1. D1 preflight (Cloudflare owner, after merge)

Sync to the **current approved merged `main` SHA** and record it. Back up the existing database before migration using the existing Cloudflare recovery process. Reuse `streamlion-google-sessions` and its `GOOGLE_SESSIONS` production binding. Never copy production Google credentials or this database into public PR previews.

Check all seven markers:

```sql
SELECT name,type,sql FROM sqlite_master WHERE name IN (
 'streamlion_purchases_v1','streamlion_purchase_owner_v1',
 'streamlion_purchase_pending_v1','streamlion_stripe_events_v1',
 'streamlion_purchase_limits_v1','streamlion_purchase_limit_expiry_v1',
 'streamlion_purchase_schema_v1'
);
```

There are **seven named markers** (the purchases table also contains two inline UNIQUE constraints). If all named markers are absent, apply **`migrations/0004_streamlion_purchases.sql` byte-for-byte in one transaction**. If only some exist, stop and report partial state. If all exist, compare definitions against the committed migration and confirm `SELECT version FROM streamlion_purchase_schema_v1` returns exactly `1`; skip only when they match. Never generate substitute SQL or alter existing Google tables. Do not print users' records or credentials.

## 2. Stripe test setup (owner/dashboard or explicitly authorized API)

1. Switch to **test mode/sandbox** in the existing Stripe account. Create one product **StreamLion** with metadata **`app=streamlion`**, and the approved USD **one-time** Price(s). Do not create a subscription or coupon. Reusing this account in test mode does not modify its live F|3D catalog.
2. Create a **test-only webhook endpoint** at `https://streamlion.transcendencemedia.com/api/purchase/webhook`. Use snapshot events and API version **`2026-09-30.endive`**, matching Stripe SDK 23. Subscribe only to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`
   - `charge.dispute.funds_withdrawn`
   - `charge.dispute.funds_reinstated`
3. Create a temporary **test restricted API key** with Checkout Sessions write/read and read access to Accounts, Products, Prices, Payment Intents, Charges and Disputes. No payout, transfer, customer deletion or refund-write permission is required by the app. Perform test refunds manually in Stripe. If Stripe cannot give the required account-read permission with a restricted key, use a temporary test secret key, then revoke it after testing; never use a live key for this stage.
4. The owner stores values **directly in Cloudflare production Secrets**. Do not paste them into chat, a PR, repository, VITE variables or browser code:

| Secret | Initial test value |
| --- | --- |
| `STREAMLION_PAYMENTS_MODE` | `test` |
| `STREAMLION_REQUIRE_LICENSE` | `false` initially; test enforcement only with owner approval |
| `STREAMLION_REFUND_DAYS` | approved `14` or `30` |
| `STRIPE_SECRET_KEY` | temporary `rk_test_...` or `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | signing secret from this **test endpoint**, `whsec_...` |
| `STRIPE_ACCOUNT_ID` | `acct_1JnHIaCQXdxBxU8G` |
| `STRIPE_PRODUCT_ID` | test StreamLion `prod_...` |
| `STRIPE_PRICE_ID` | test standard one-time `price_...` |
| `STRIPE_LAUNCH_PRICE_ID` | optional test launch one-time `price_...`; omit for no promotion |
| `STREAMLION_LIVE_PAYMENTS_APPROVED` | leave absent/false |

Retain the existing Google secrets and flags. Deploy only Pages project `streamlion` from the approved merged main, including frontend and Pages Functions. The public welcome page retains launch-interest buttons while mode is `test`; the owner opens **`/api/purchase`** directly. This page labels test mode explicitly. Do not route real customers to test checkout.

## 3. Test acceptance (no real charges)

- Run `node scripts/verify-purchases.mjs https://streamlion.transcendencemedia.com test`. It reads only public configuration/status/revision; no card, checkout creation, Google calls or model credit. Require the expected revision separately using the existing `verify-release.mjs` script.
- Open `/api/purchase`, Google sign in, check correct account + price + terms, and use Stripe test card `4242 4242 4242 4242`, a future expiry and synthetic billing data. Confirm the same order in Stripe, webhook HTTP 200, and purchased status on the return page.
- Close/reopen in the same browser and sign in on a second device. Confirm restoration on the **same Google account**; a different account must not inherit the purchase.
- Cancel checkout, duplicate clicks, direct success URL access before paying and temporary configuration/network failure: no unverified access; retries remain available without another charge.
- Refund the test payment in Stripe: full refund removes active access; a partial refund retains it. Deliver completion/refund events again and out of order. A full refund or unresolved dispute must not be overwritten by an old completion event. Retry missing events from the **existing test endpoint**, not another integration.
- In a controlled test, enable `STREAMLION_REQUIRE_LICENSE=true`; check UI gate and server Google proxy rejection for an unpaid account, and normal Google read/write for a purchased account. Keep this **false** if it would lock out existing production testers. Existing testers need an explicit purchase/entitlement plan before live enforcement.
- Verify local offline work after a verified purchase and backup download while access is unavailable. A 7-day browser receipt allows local offline use only; it is not a server authorization credential or DRM. All server-backed Google operations recheck the D1 account purchase. A verified disabled-license state also permits existing device work offline. The static client cannot prevent a determined party from modifying local JavaScript; stronger offline licensing would require a separately designed signed receipt/distribution system.
- Physical Android: hosted Checkout navigation, Google callback, close/reopen, clipboard/voice unaffected, and no input lost. Desktop and mobile viewport render checks are source QA, not physical-device proof.

## 4. Live activation — separate approval required

Do not set live keys or `STREAMLION_LIVE_PAYMENTS_APPROVED=true` until the owner accepts the complete test receipt, final pricing/refund/terms/tax setup, existing-tester treatment and customer-facing statement descriptor. Create/reuse live StreamLion product and approved one-time Prices (metadata `app=streamlion`), live endpoint and restricted key with matching permissions. Configure live equivalents of the secrets, then `STREAMLION_PAYMENTS_MODE=live`, `STREAMLION_REQUIRE_LICENSE=true`, and the explicit live approval flag. Deploy the approved main and verify the public Buy button, final checkout price, webhook delivery and buyer restoration. A **real payment/refund** requires separate explicit owner authorization; test-mode success does not prove settlement.

Webhook validation rejects wrong-mode events, other products, altered quantity/discount/price and wrong-account confirmations. Unrelated F|3D events are acknowledged without changing their data. The backend retries recognized StreamLion events on verification failures. Current Stripe payment/charge/dispute state is reconciled with optimistic concurrency, not event delivery order. Refunds and disputes affect the order's license state only; other valid paid orders for the same account retain access. Disabling checkout is not a refund-processing substitute: leave the live webhook configured and functioning after sales open.

## Receipt and rollback

Report approved merged main SHA; D1 migration/stamp result; secret **names/presence only**; Stripe account/mode/product/price IDs; webhook endpoint ID/version/types and test delivery result; Pages deployment ID/revision; authenticated purchase/restore/refund/account-isolation results; Android result; final public price/refund/terms/tax/descriptor approval. Until these are present, report **code complete, activation/test pending**, not production ready.

For a prelaunch test rollback, set `STREAMLION_REQUIRE_LICENSE=false` and `STREAMLION_PAYMENTS_MODE=disabled`, deploy the previously approved state, and preserve purchase tables/Google records. Disabled webhooks return a retryable status so events are not silently dropped. For a live incident, preserve webhooks and existing entitlements; do not disable/refund another product or delete purchase data. Revoke the temporary test key after its replacement is verified. Do not rotate the Google token encryption key.
