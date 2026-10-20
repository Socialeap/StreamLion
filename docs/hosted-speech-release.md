# Device voice and separately priced hosted speech

Review-only release plan. No merge, migration, configuration, deployment, purchase or provider spend is authorized by opening this PR. StreamLion uses GitHub, Cloudflare and Stripe. No Lovable action is required.

## Behavior and price contract

- Device voice selection, speed (0.5–1.5×), and test use browser voices. Preference is local to this browser; a missing voice falls back to the browser default. Free deterministic lookup, text, manual entry, ordinary exports, backups, and retired ChatGPT routes are unchanged.
- Preview serves the publisher's pinned Kokoro `af_heart` WAV from this app, with transcript/source/license. No Google/project text, provider invocation, credits, or automatic playback. This demonstrates the voice, not DeepInfra latency or guaranteed delivery quality.
- Speech-only rebuilds an authorized saved-detail answer from the current Google workbook, displays its exact text and a one-minute quote, then requires explicit confirmation per clip. It invokes only DeepInfra `hexgrad/Kokoro-82M`, `af_heart`, WAV, speed1; never OpenAI. Names/contact details may be included after review. Access answers, detected labeled/repeated secrets, arbitrary instructions, and answers over1200 characters are refused. Detection is not a guarantee; review remains essential.
- Independent live policy: one flat quoted clip price in ledger micro-units, `ceil(cost_micros * 1.30)`, using the existing fixed credit display unit. This follows the existing cost-markup convention, not a 30% gross margin. `cost_micros` must be an approved conservative **maximum provider cost for a1200-character clip**, not an unverified estimate. No production price or allowance is proposed by the synthetic test values.
- Purchased wallet only; no starter/promo debit, OpenAI allowance, auto-top-up or new Stripe product. Reserve before inference, refund generation failures once, completed clip charged even if delivery/playback fails. Replay of the loaded clip is free; another generation needs a new quote and confirmation. Provider attempts, including refunded failures, remain in daily/lifetime budgets. One pending clip per account, three attempts per account/minute, configurable daily request/cost caps. Provider timeout20seconds; interrupted reservations expire after5minutes on authenticated recovery or daily cleanup.
- Ledger retains account/request/workbook-scope hash, input hash, time, state, price and provider reserve, not text/audio. Short-lived encrypted quote stays in the browser; loaded audio lasts only in the current view. Definitive pre-reservation validation errors clear the local recovery reference immediately and require a fresh quote. A409 reporting an existing reservation, a503, unreadable replies and network failures retain recovery and block automatic retries. Reservation storage errors are checked against the ledger before reporting a definite rejection. A missing reservation is only cleared after quote expiry plus5minutes, so an interrupted validation cannot later start a new charge. There is no server audio recovery; completed-but-lost audio is not generated again automatically.

## 1. Review and merge — owner

Review the PR commit and passing App checks. Merge is held for explicit owner approval. All later operations must use the approved merged `main` SHA, verified against the PR, never an arbitrary current worktree. `[CF-Pages-Skip]` prevents a branch commit from being treated as a deployment request.

## 2. Closed migration — Cloudflare operator, held until merge and release authorization

Back up/recovery-bookmark `streamlion-google-sessions`, and capture protected-table counts/fingerprints without exposing customer data. Read `sqlite_master` (`name,type,sql`) and any existing `streamlion_speech_schema_v1` version into a private local JSON `{ "schema": [...], "stamps": { "streamlion_speech_schema_v1": 1 } }`; omit an absent stamp. No customer rows/credentials belong in this file.

Run this read-only classifier against that actual schema:

```sh
node scripts/preflight-speech.mjs /private/tmp/streamlion-speech-schema.json
```

- All nine named objects absent and no stamp: apply **only** committed `migrations/0021_hosted_speech.sql` byte-for-byte to the existing production D1 database. Do not use a bulk pending-migrations apply.
- All nine exact definitions and version1 match: skip migration.
- Any partial/mismatching state: STOP for review; never generate replacement SQL or delete/recreate financial tables.

The exact optional application command, only after the pending preflight and authorization:

```sh
npx wrangler d1 execute streamlion-google-sessions --remote --env production --file migrations/0021_hosted_speech.sql
```

Re-run schema classification; verify both test/live policy rows are `active=0`, `cost_micros=0`, budgets0, requests0 on a fresh application. Preserve already-existing policy values on an already-applied migration; unexpected active values require STOP, not silent reset. Compare every protected preexisting table fingerprint. This migration only adds speech tables/indexes/triggers and stamps; it changes no existing wallet, purchase or project row.

## 3. Backend deployment — Cloudflare operator, closed configuration

Deploy only approved merged Pages Functions and existing `streamlion-session-cleanup` Worker (`ops/wrangler-cleanup.jsonc`), after migration verification. Cleanup only expires stale speech holds; preserve its schedule, D1 binding and historical extension cleanup. No coordination Worker change is needed.

Keep `STREAMLION_HOSTED_SPEECH_APPROVED` **absent/false**, policy inactive/unpriced, checkout paused, AI/import gates unchanged. No secret is added by this PR. Do not insert a new runtime binding: production already uses64 slots; activation needs a separate binding-slot plan. Do not repurpose an existing gate to fit.

Verify the approved deployment SHA, safe health response, `/api/speech/config` returns `enabled:false`, existing AI/import gates remain closed, and retired ChatGPT extension/MCP routes still return410. Zero inference, checkout, mail or credit-consuming tests. Record deployment IDs and policy/schema receipts separately from frontend acceptance.

## 4. Frontend release and owner/device QA — separate gates

Release matching frontend assets, routing, service-worker revision, sample WAV/license. Verify desktop and phone controls, sample playback, voice selection/rate persistence and unavailable-voice fallback. Owner verifies installed PWA update/reopen, free lookup/text, manual entry, export, backup download and isolated restore. Device/OS-specific voice quality requires owner hardware; browser mocks do not prove it.

## 5. Paid speech activation — HOLD, separate pricing/spend approval

Requires approved maximum provider cost, flat customer price, daily/lifetime cost ceilings and daily request cap; a runtime binding-slot review; authorized migration/server/frontend receipts; and explicit owner authorization for a bounded live speech QA ceiling. Until then spend ceiling **$0** and no real synthesis. Do not enable speech merely because the PR merged.

On separately authorized activation, set only the speech policy's approved values and independent `STREAMLION_HOSTED_SPEECH_APPROVED=true` flag using the reviewed binding plan. Existing live-payments approval, live payment/credit namespace, DeepInfra secret, authenticated Google session/workbook and paid entitlement are also required. Missing/unavailable configuration, schema, price, funds or credit check must fail closed. Do not enable checkout, managed AI, brief imports, saved-card top-ups, auto-recharge, a new paid service or broader provider scope.

A later authorized paid QA must verify quote → explicit confirm → one debit → audio; replay without another debit; failed/aborted generation refund; uncertain-response recovery; and zero OpenAI calls, within the approved ceiling. Capture only sanitized request IDs/states and ledger differences. Public opening requires a separate owner decision after device acceptance.
