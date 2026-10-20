# Device voice and separately priced hosted speech

The base voice feature (PR121 / migration0021) is deployed with speech inactive. The fixed-price follow-up is review-only: opening its PR authorizes no merge, migration, configuration, deployment, purchase or provider spend. StreamLion uses GitHub, Cloudflare and Stripe. No Lovable action is required.

## Behavior and price contract

- Device voice selection, speed (0.5–1.5×), and test use browser voices. Preference is local to this browser; a missing voice falls back to the browser default. Free deterministic lookup, text, manual entry, ordinary exports, backups, and retired ChatGPT routes are unchanged.
- Preview serves the publisher's pinned Kokoro `af_heart` WAV from this app, with transcript/source/license. No Google/project text, provider invocation, credits, or automatic playback. This demonstrates the voice, not DeepInfra latency or guaranteed delivery quality.
- Speech-only rebuilds an authorized saved-detail answer from the current Google workbook, displays its exact text and a one-minute quote, then requires explicit confirmation per clip. It invokes only DeepInfra `hexgrad/Kokoro-82M`, `af_heart`, WAV, speed1; never OpenAI. Names/contact details may be included after review. Access answers, detected labeled/repeated secrets, arbitrary instructions, and answers over1200 characters are refused. Detection is not a guarantee; review remains essential.
- Owner-approved retail price: **1 credit per clip**, up to 1,200 characters. Migration 0022 adds independent `price_micros=12500`, constrained to the existing one-credit display unit. The customer price is never calculated from the provider reserve. `cost_micros` remains a separately approved conservative **maximum provider cost for a 1,200-character clip**, not a retail price or unverified estimate. Provider budgets count `reserve_micros`; customer debits/refunds use each ledger row's actual `price_micros`. No provider allowance or cost approval is implied by retail-price approval.
- Purchased wallet only; no starter/promo debit, OpenAI allowance, auto-top-up or new Stripe product. Reserve before inference, refund generation failures once, completed clip charged even if delivery/playback fails. Replay of the loaded clip is free; another generation needs a new quote and confirmation. Provider attempts, including refunded failures, remain in daily/lifetime budgets. One pending clip per account, three attempts per account/minute, configurable daily request/cost caps. Provider timeout20seconds; interrupted reservations expire after5minutes on authenticated recovery or daily cleanup.
- Ledger retains account/request/workbook-scope hash, input hash, time, state, price and provider reserve, not text/audio. Short-lived encrypted quote stays in the browser; loaded audio lasts only in the current view. Definitive pre-reservation validation errors clear the local recovery reference immediately and require a fresh quote. A409 reporting an existing reservation, a503, unreadable replies and network failures retain recovery and block automatic retries. Reservation storage errors are checked against the ledger before reporting a definite rejection. A missing reservation is only cleared after quote expiry plus5minutes, so an interrupted validation cannot later start a new charge. There is no server audio recovery; completed-but-lost audio is not generated again automatically.

## 1. Review and merge — owner

Review the PR commit and passing App checks. Merge is held for explicit owner approval. All later operations must use the approved merged `main` SHA, verified against the PR, never an arbitrary current worktree. `[CF-Pages-Skip]` prevents a branch commit from being treated as a deployment request.

## 2. Closed migration — Cloudflare operator, held until merge and release authorization

Back up/recovery-bookmark `streamlion-google-sessions`, and capture protected-table counts/fingerprints without exposing customer data. Read `sqlite_master` (`name,type,sql`) and the `streamlion_speech_schema_v1` / optional `streamlion_speech_pricing_schema_v1` versions into a private local JSON `{ "schema": [...], "stamps": { "streamlion_speech_schema_v1": 1 } }` (include the pricing stamp only when present); omit an absent stamp. No customer rows/credentials belong in this file.

Run this read-only classifier against that actual schema:

```sh
node scripts/preflight-speech-price.mjs /private/tmp/streamlion-speech-schema.json
```

- Exact committed 0021 schema with no pricing column/v2 reserve trigger/pricing stamp: apply **only** committed `migrations/0022_speech_fixed_price.sql` byte-for-byte to the existing production D1 database. Do not use a bulk pending-migrations apply.
- Exact complete 0022 schema/stamps: skip migration.
- Missing 0021, any partial/mismatching state, unexpected speech objects or conflicting stamps: STOP for review; never generate replacement SQL or delete/recreate financial tables. The original 0021 preflight intentionally does not accept the updated 0022 schema; use this pricing classifier.
- Before mutation, verify both policy rows remain inactive with zero provider cost/budgets/request allowance and the hosted-speech approval flag absent/false. Unexpected activation: STOP. Do not silently pause, reset or inflate an existing reserve.

The exact optional application command, only after the pending preflight and authorization:

```sh
npx wrangler d1 execute streamlion-google-sessions --remote --env production --file migrations/0022_speech_fixed_price.sql
```

Re-run classification; verify both policies have `price_micros=12500`, `active=0`, `cost_micros=0`, budgets 0 and requests 0. Migration 0022 preserves every existing policy field, wallet balance, historical turn price/reserve/state and all other records; only the new retail-price column defaults are added. Compare protected-table fingerprints, excluding only that new policy column from the old-policy comparison. Historical charges keep their original price and refund that amount once, even if it differs from the new retail price. The migration replaces only the reservation trigger and adds a pricing-version stamp. It does not alter the existing debit, immutable-transition or refund triggers.

Require a receipt with approved merged `main` SHA, D1 recovery bookmark, migration result/platform stamp, exact schema and price markers, preserved policy/ledger/wallet fingerprints, deployment ID, unchanged configuration and safe health checks.

## 3. Backend deployment — Cloudflare operator, closed configuration

After migration verification, deploy the approved merged Pages release. Verify backend behavior before frontend acceptance below. Neither auxiliary Worker needs redeployment for 0022. Preserve the existing cleanup Worker, bindings and schedules; its existing refund logic uses each turn's stored customer charge.

Keep `STREAMLION_HOSTED_SPEECH_APPROVED` **absent/false**, policy inactive with the approved 1-credit retail price and zero provider reserve/budgets, checkout paused, AI/import gates unchanged. No secret is added by this PR. Do not insert a new runtime binding: production already uses64 slots; activation needs a separate binding-slot plan. Do not repurpose an existing gate to fit.

Verify the approved deployment SHA, safe health response, `/api/speech/config` returns `enabled:false`, existing AI/import gates remain closed, and retired ChatGPT extension/MCP routes still return410. Zero inference, checkout, mail or credit-consuming tests. Record deployment IDs and policy/schema receipts separately from frontend acceptance.

## 4. Frontend release and owner/device QA — separate gates

Cloudflare Pages deploys matching functions/assets together; verify the frontend as a separate acceptance gate after the backend receipt. Confirm routing, service-worker revision and sample WAV/license. Verify desktop and phone controls, sample playback, voice selection/rate persistence and unavailable-voice fallback. Owner verifies installed PWA update/reopen, free lookup/text, manual entry, export, backup download and isolated restore. Device/OS-specific voice quality requires owner hardware; browser mocks do not prove it.

## 5. Paid speech activation — HOLD, separate pricing/spend approval

The 1-credit retail price is approved. Activation still requires approved maximum provider cost, daily/lifetime cost ceilings and daily request cap; a runtime binding-slot review; authorized migration/server/frontend receipts; and explicit owner authorization for a bounded live speech QA ceiling. Until then spend ceiling **$0** and no real synthesis. Do not enable speech merely because the PR merged.

On separately authorized activation, preserve `price_micros=12500` and set only the speech policy's approved provider reserve/budgets/request allowance and active status and independent `STREAMLION_HOSTED_SPEECH_APPROVED=true` flag using the reviewed binding plan. Existing live-payments approval, live payment/credit namespace, DeepInfra secret, authenticated Google session/workbook and paid entitlement are also required. Missing/unavailable configuration, schema, price, funds or credit check must fail closed. Do not enable checkout, managed AI, brief imports, saved-card top-ups, auto-recharge, a new paid service or broader provider scope.

A later authorized paid QA must verify quote → explicit confirm → one debit → audio; replay without another debit; failed/aborted generation refund; uncertain-response recovery; and zero OpenAI calls, within the approved ceiling. Capture only sanitized request IDs/states and ledger differences. Public opening requires a separate owner decision after device acceptance.
