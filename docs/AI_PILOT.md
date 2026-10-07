# Managed AI voice pilot and commercial credit boundary

StreamLion uses repository/GitHub, Cloudflare Pages/Functions/D1, Google Cloud/Sheets/Drive and Stripe. **Lovable has no role in this stack. No Lovable action or handoff is required.** Apply backend and frontend release steps directly through the existing Cloudflare and Google Cloud systems.

StreamLion pays OpenAI for `gpt-6-luna` text and DeepInfra for `hexgrad/Kokoro-82M` speech. Customers never provide keys. Google Sheets/Drive remain authoritative. The server uses the authenticated session's selected workbook and project, not a browser-supplied record or workbook ID. AI cannot change records, call tools, or search externally.

## Review without credentials

Run `npm run dev`, then open `http://127.0.0.1:5173/ai-demo.html?ai-demo=1`. The isolated page supplies a synthetic project; enable Read answers aloud, ask “What is the name of the location?” and “Who is the site contact?”, then stop an answer or change projects mid-stream. This development-only fixture simulates incremental text and uses device speech. It contacts neither provider and spends zero credits. It does **not** prove model accuracy, hosted voice quality, provider protocol compatibility or latency. Production builds cannot enable the fixture with a URL parameter.

## Pilot boundaries

- Account enrollment remains closed. The approved activation configuration sets production `ENABLE_AI_PILOT=true`, but both server keys must exist, the D1 policy must be active with a positive budget, and the authenticated user's wallet must be explicitly enabled before a paid request is possible. The policy is staged inactive until the operator starts the approved test session. No public enrollment or automatic wallet grants.
- Pricing is a configurable **pilot proposal**, not settled commercial pricing: 12,500 micro-USD = $0.0125 (1.25 cents) per completed text answer, including attempted speech. 390 answers would use $4.875 in credits. The displayed price is submitted and checked again; a changed price requires review. The pilot uses no Stripe top-ups or paid wallets. The separately gated commercial ledger is described in [AI credit activation](./ai-credit-activation.md); neither lane has auto-recharge or subscriptions.
- The app displays **credit counts**, using a fixed 12,500-internal-micro-unit pilot denomination: the current charge is 1 credit per answer. Balances use that same fixed conversion, independently of the answer price. This does not change ledger debits, provider budgets or grants. Commercial top-ups use the approved 30% markup on a separately approved estimated full cost; cost approval and live activation remain pending. Internal pilot grants have no customer cash value.
- Credits are reserved atomically before provider calls. Duplicate request identities cannot re-run a provider call. Insufficient credits, disabled accounts, one active turn per account, six requests per minute per account, the global daily request limit and the global daily budget all fail closed. The owner controls the initial wallets; there is no customer write endpoint for credit balances.
- Incomplete text returns customer credits once. A completed text answer remains charged if voice or delivery subsequently fails. Unknown outcomes can retain customer credits for up to five minutes; a subsequent config/answer request expires stale reservations. **Refresh credits** reads the server balance. Questions/results/audio are not stored in the credit ledger. Request identities remain as deduplication tombstones for this bounded pilot.
- Every attempted turn permanently consumes a 6,000 micro-USD ($0.006) **estimated provider-cost reservation** for that UTC day, even on error or cancellation. This is conservative at documented standard prices and our bounded inputs; it is not a provider-enforced dollar cap or reconciliation against provider invoices. Never recycle reservations after unknown spending. Configure provider-side restrictions/alerts as available and revalidate prices before activation.
- Limits: 500 question characters, 10,000 UTF-8 bytes of project/field context, 240 output tokens, 900 answer characters, six speech phrases, one speech request at a time, standard provider tiers and no retries. Oversized projects refuse the AI pilot instead of silently dropping records. Google reads have existing 20-second timeouts; the overall AI operation has a 60-second deadline. Stop/background/unmount abort local playback and the browser request. A provider may still bill work already accepted before cancellation.
- Text streams through the Responses API with low verbosity and no reasoning stage. Answers normally use 1–3 short sentences, at most 60 words, while preserving exact measurements, units and review status. Only empty project fields are omitted; all nonempty facts and field records remain available. Text is marked complete and credits update as soon as the model completes, without waiting for speech.
- Updated clients negotiate `audioFormat: "pcm_s16le"`. Complete sentences or natural clauses go to DeepInfra's documented `/v1/text-to-speech/af_heart/stream` Kokoro endpoint while text generation continues. This is DeepInfra's compatible API, not a new ElevenLabs provider. The server sends raw mono, signed little-endian 16-bit PCM at Kokoro's 24 kHz sample rate: an initial 50 ms frame, then bounded 100 ms frames. The browser creates audio buffers directly with an 80 ms startup/underrun scheduling cushion. Network chunks may split a sample; the server retains incomplete bytes. Startup is capped at eight seconds per phrase, idle gaps at five seconds, PCM at 1 MiB per phrase / 3 MiB per turn, and local queued playback at 60 seconds. Provider/audio-format failures expose device read-aloud rather than trigger a paid retry. Installed older clients keep the native JSON/base64 WAV path until refreshed.
- AudioContext unlocks in the submit gesture. If audio initialization/resume is unavailable, the client requests text only. Text updates are batched every 50 ms; completion flushes immediately. Stop/background/unmount clears pending text updates, stops audio, and aborts providers, including while waiting for audio bytes. No paid warm-up, automatic retry, priority tier, second model stage or new service. Device read-aloud never incurs another provider request. Hosted keys remain server-only.
- Source labels identify a newly read Google workbook. A local demo is explicitly simulated. AI output is marked for checking against records, and partial answers are marked incomplete. Do not promise perfect grounding or production readiness before real evaluation.

## Committed deployment scope

Cloudflare Pages Functions: `functions/api/ai/[[path]].js` (`/api/ai/config`, `/api/ai/answer`), `server/ai-pilot.js`, `server/ai-providers.js`; existing auth/workbook helpers are reused. `functions/_middleware.js` adds the fixed `ai` log category, with no prompts/records/keys logged. Frontend: managed mode inside the existing ProjectVoiceAnswers flow, `src/useManagedAnswers.js`, `src/managed-ai.js`.

Existing Cloudflare D1 binding: `GOOGLE_SESSIONS`; existing database: `streamlion-google-sessions`. New migration: `migrations/0007_streamlion_ai_pilot.sql`. No Supabase, RLS, Edge Functions, OAuth scope changes, new hosting services, or new dependency packages.

Server-only required secrets: `OPENAI_API_KEY`, `DEEPINFRA_API_KEY`. Existing persistent Google auth configuration must already be working (`GOOGLE_AUTH_ORIGIN` must match the deployed origin). Feature variable: production `ENABLE_AI_PILOT=true` is committed **after explicit owner pilot/spend authorization**. For a zero-spend deployment, keep the D1 policy `active=0`; changing this variable back to false is an additional kill switch. Do not put provider credentials in a chat, PR, source file, VITE variable, or frontend settings. Owner enters keys through Cloudflare's encrypted secrets UI for the selected environment, after reviewing this draft.

## Idempotent preflight (owner / Cloudflare)

1. Sync to current merged `main`; record its exact SHA. Verify this migration and the named function files match that SHA. Work on the existing Pages project and D1 binding only; never provision a new database or Supabase project. Do not touch Google OAuth, Stripe, other providers/functions, real project records, or publish as a side effect.
2. Read these **eight markers** from `sqlite_master`:
   `streamlion_ai_policy_v1`, `streamlion_ai_wallets_v1`, `streamlion_ai_turns_v1`, `streamlion_ai_turns_time_v1`, `streamlion_ai_reserve_v1`, `streamlion_ai_debit_v1`, `streamlion_ai_transition_v1`, `streamlion_ai_refund_v1`.
   First check whether `d1_migrations` exists before querying it. Historical StreamLion migrations were applied through D1 Studio and may have application schema markers without a Wrangler migration-history table. Absence of that table alone does not authorize recreating existing tables or inventing migration stamps.
3. If **all eight AI markers are absent**, verify the Google prerequisite definitions from committed migrations 0001–0003, including `folder_id` and schema version rows. Purchases 0004–0005 and extension 0006 are separate scopes, not prerequisites for this manually funded AI pilot. If purchase-license enforcement is enabled, its purchase schema and entitlement must already work; never disable enforcement to bypass that requirement.
   - With a consistent Wrangler history: use `npx wrangler d1 migrations apply streamlion-google-sessions --env production --remote` only when 0007 is the only pending migration. Stop on other pending migrations or a contradictory 0007 stamp.
   - Without Wrangler history: after explicit authorization for this narrow installation, execute **only** the exact committed file with `npx wrangler d1 execute streamlion-google-sessions --env production --remote --file migrations/0007_streamlion_ai_pilot.sql --yes`. Do not run the migration directory, recreate previous objects, create/backfill `d1_migrations`, or generate/substitute SQL. Preserve the Cloudflare execution receipt and final bookmark as the platform receipt; this path does not produce a Wrangler migration stamp.
4. If all eight AI markers exist, skip application and compare their tables/index/triggers against the committed SQL and expected columns/constraints. If Wrangler history exists, check its 0007 stamp for consistency. Any missing AI marker, mismatched definition, duplicate/contradictory stamp, or failed prerequisite is partial state: **STOP and report; do not repair, regenerate, substitute or apply again**.
5. Re-read all eight definitions. On a fresh installation confirm policy `active=0`, `daily_budget_micros=0`, and no wallets. Owner-approved pilot grants and limits are separate changes; keep policy `active=0` while staging them. No client routes can grant credits or mutate the policy. D1 is accessed only by the existing server binding, not from the browser. No RLS/grants change is involved.
6. Deploy the current merged Pages build and its Functions through the existing GitHub/Cloudflare deployment path. This deployment changes both server code and the bundled frontend. The approved feature flag may be true while the policy is inactive; that remains a zero-provider-spend state. The owner operates Cloudflare directly. No Lovable action is required.
7. Non-credit-consuming check: GET `/api/ai/config` returns `enabled:false` with `Cache-Control: no-store` while the policy is inactive, including for the authenticated staged test account. The response includes a safe prerequisite `reason` (such as `pilot_paused`, `connect_google` or `select_workbook`); it exposes no credentials or account identifiers. With the feature flag false, POST `/api/ai/answer` returns 503. With the feature flag true but policy inactive, an authenticated request returns 403 (unauthenticated requests return 401). No provider call occurs in either case. Spend ceiling for this setup is **$0**. No real questions/searches or paid health checks.
8. Return receipt: merged main SHA, Cloudflare deployment identifier/status, migration applied/skipped, the actual platform stamp **or** execution bookmark (identify which), eight marker/definition results, server-only storage/no browser credit-write result, AI route health results, and policy disabled status. Never claim a Wrangler stamp exists for a manually executed migration. Review the receipt before activating the paid policy.

## Later paid pilot — requires credentials and explicit budget

The owner chooses test accounts, grant amount, daily request cap and total budget before enabling. The approved 2026-10-06 session allows up to 30 test attempts and a $1 provider-spend allowance. The staged daily cap is 30 and estimated provider reservation budget is 180,000 micro-USD ($0.18); this is not a provider-enforced invoice cap. Start only a supervised test session, track cumulative attempts/spend across UTC-day boundaries, and set policy `active=0` after testing or on unexpected billing. The daily cap resets at UTC midnight and does not replace the approved total-session limit. See `docs/AI_PILOT_ACTIVATION_2026-10-06.md` for the installation receipt. Use immutable Google subjects from the existing authenticated synthetic-account sessions, not browser-supplied emails/subjects. Grant only those pilot wallets. Example owner-only SQL **templates**, not activation instructions and not authorization to spend:

```sql
-- Replace placeholders with approved subject and integer micro-USD amounts.
INSERT INTO streamlion_ai_wallets_v1(google_subject,enabled,balance_micros)
VALUES('<approved-google-subject>',1,<approved-credit-grant-micros>);
UPDATE streamlion_ai_policy_v1
SET active=1, daily_budget_micros=<approved-daily-provider-reservation-micros>,
    daily_requests=<approved-global-daily-request-cap>
WHERE id=1;
```

Read back balances/policy; never run a grant twice, never overwrite existing balances to retry an unknown result. Manually funded pilot credits have no real-money customer value. This draft grants **nothing** by default. Enable the feature only in the explicitly selected environment after its server secrets exist. Disable by setting `ENABLE_AI_PILOT=false` (or policy `active=0`); already accepted calls may finish.

## Separate frontend and owner QA gates

Merged source and passing checks are not deployment proof. Confirm a fresh Cloudflare build SHA and refresh the installed Android PWA/service worker separately. Then, within the owner's approved budget, test both synthetic accounts for isolation; name versus address paraphrases; recorded and missing contacts; multi-field questions, measurements and checklist questions; malicious instructions inside records; ambiguous/unknown questions; dictation → Get answer; first visible text and first audible phrase; stop/background/project/account changes; low credits; double taps/retries; provider text failure; speech failure with device fallback; stale reservations and balance readback. Compare 20–30 varied questions to their actual Google records and record first-text/first-audio timing on Android, including a poor connection. The original WAV pilot produced grounded answers, but first buffered audio took approximately 11.6–18.8 seconds after the server setup phase in two measured turns. The new streaming protocol and shorter prompt still require a live retest. Server `firstAudioMs` measures the first available audio frame, not physical audibility; `setupMs` and `requestFirstTextMs` / `requestFirstAudioMs` / `requestTotalMs` include the previously omitted auth, Google-read and credit-reservation setup. Record Android audible onset separately. Local tests cannot prove live voice quality or latency.

Commercial credit top-ups, signed Stripe credit issuance and refund reconciliation now have a separate implementation and activation guide. Live configuration, cost/budget approval, sustained-load proof and owner/device acceptance remain separate production gates. This is a bounded internal pilot, not a production/scale green light.

## Answer mode and recovery

The focused Ask page keeps the credit quote, provider disclosure and AI/free
choice in Settings or the first-request confirmation. An explicit AI choice
persists for the same authenticated Google account and selected workbook at the
same quoted price. `/api/ai/config` returns an opaque `preferenceScope` hash,
computed from the Google subject and workbook; it is neither a credential nor
an authorization token. The answer POST must echo this scope and price. A stale
account/workbook scope or price is rejected before Google/provider work. Every
answer still reads records server-side from the authenticated selected workbook;
browser-supplied records are never trusted.

Configuration failure disables paid requests while retaining the preference.
Rechecking availability never automatically sends the pending question. An
unavailable first request shows the specific reason and offers recovery or an
explicit free lookup. Narrow free lookup does not pose as an AI response.
Local-device records and disconnected Google copies cannot enter paid AI.
An unsupported free question stays in the composer with concise recovery text.

Safe reasons include `pilot_unavailable`, `pilot_paused`, `pilot_exhausted`,
`credits_exhausted`, `account_not_enabled`, `connect_google`, `select_workbook`
and a client-side `status_unavailable`. Operator configuration and exhausted
allowances direct the user to the administrator, rather than an endless retry.
Initial availability checks block submission; no configuration read charges
credits or submits a question. Availability controls show a disabled checking
state, then announce completion even when the same administrator pause remains.
Concurrent taps share one read. An eight-second deadline covers the response
body as well as the network request; failures disable paid requests and allow
retry without erasing consent. Lifetime/request-order guards reject late results.
Returning to the foreground refreshes availability without submitting a question.
Rapid double taps cannot reserve a second answer.

## Continuous closed pilot: cumulative ceiling

The owner-approved pilot is capped at **30 total attempts**, including previous,
failed and expired attempts, across all enrolled accounts and days. The server
also checks a cumulative provider-reservation ceiling of **1,000,000 micro-USD**
($1). Each bounded turn reserves 6,000 micro-USD. These reservations are a
conservative internal accounting estimate, not a provider invoice or final
customer price; the original $1 actual provider-spend allowance still applies.
Do not raise these limits, grant credits, enroll more accounts or turn on
provider auto-recharge without separate owner authorization.

`PILOT_CEILING` is committed in `server/ai-pilot.js`. The reservation inserts
conditionally under a single SQLite statement, then existing triggers enforce
wallet, quote, per-account pending/rate and daily shared budget limits. A
rejected insert charges nothing. Failure refunds customer credits once but
never releases the cumulative attempt/reservation. `expireTurns` retains the
ledger. Do not delete turn rows or reset wallets to restart a spent pilot.
At the cumulative ceiling, config reports `pilot_exhausted` and answer requests
stop before upstream reads. The atomic reservation remains the race guard.

This bounded pilot can remain open between acceptance tests. This supersedes
the earlier instruction to pause after every supervised test, while keeping the
administrator's pause switch and the original spend/attempt ceiling. It is not
a commercial launch or scale-readiness approval.

### Post-merge Cloudflare activation

HOLD until this PR is merged and Cloudflare Pages **and Functions** are deployed
from the current merged `main`. Record the main SHA and successful production
deployment receipt. Keep policy `active=0` during deployment. No migration,
new secret/environment variable, wallet grant, provider subscription or Lovable
action is required. Do not activate an older Function that lacks the cumulative
reservation guard. This revision requires the fresh client to echo
`preferenceScope`; old cached clients fail safely and must apply the PWA update.

In Cloudflare D1 `streamlion-google-sessions`, first read:

```sql
SELECT active,price_micros,daily_requests,daily_budget_micros,
  (SELECT COUNT(*) FROM sqlite_master WHERE name IN(
    'streamlion_ai_policy_v1','streamlion_ai_wallets_v1','streamlion_ai_turns_v1',
    'streamlion_ai_turns_time_v1','streamlion_ai_reserve_v1','streamlion_ai_debit_v1',
    'streamlion_ai_transition_v1','streamlion_ai_refund_v1')) AS ai_markers,
  (SELECT COUNT(*) FROM streamlion_ai_turns_v1) AS total_attempts,
  (SELECT COUNT(*) FROM streamlion_ai_turns_v1 WHERE state='reserved') AS pending_attempts,
  (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_ai_turns_v1) AS reserved_micros
FROM streamlion_ai_policy_v1 WHERE id=1;
```

Require all eight markers, price 12,500, daily requests 30, daily budget 180,000,
no pending turn, total attempts below 30 and reservations plus 6,000 at most
1,000,000. At investigation time: active=0, 9 attempts, no pending turn; the
business wallet remained enrolled with 262,500 (21 displayed credits). These
are observations, not values to overwrite. Stop on partial/unexpected state;
do not regenerate or reapply the existing migration, change secrets, grant or
reset credits. Verify the business account's existing enrollment separately;
never print raw session tokens, Google tokens or provider secrets.

Only after the fresh deployment and preflight, resume the **existing approved
allowance** with this idempotent, guarded policy update:

```sql
UPDATE streamlion_ai_policy_v1 SET active=1
WHERE id=1 AND active=0 AND price_micros=12500
  AND daily_requests=30 AND daily_budget_micros=180000
  AND (SELECT COUNT(*) FROM sqlite_master WHERE name IN(
    'streamlion_ai_policy_v1','streamlion_ai_wallets_v1','streamlion_ai_turns_v1',
    'streamlion_ai_turns_time_v1','streamlion_ai_reserve_v1','streamlion_ai_debit_v1',
    'streamlion_ai_transition_v1','streamlion_ai_refund_v1'))=8
  AND (SELECT COUNT(*) FROM streamlion_ai_turns_v1)<30
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_ai_turns_v1)+6000<=1000000
  AND NOT EXISTS(SELECT 1 FROM streamlion_ai_turns_v1 WHERE state='reserved');
```

Read back the policy and allowance; an unknown outcome must be read before a
retry. On the owner's signed-in business account, **Check AI availability**
should return enabled with the scoped quote, without provider calls or charges.
Receipt: main SHA, Pages/Functions production deployment, all eight existing D1
markers, policy readback and safe config-check result. A saved receipt and a
physical-phone retest are separate gates. Apply the PWA update, dictate the
same room-dimension question, confirm the displayed quote once, measure audible
onset, Stop, reopen and ask again. Subsequent submissions should retain the
same account/workbook choice. Any real answers count toward the original
cumulative allowance; no paid checks are part of deployment activation.

Provider contracts checked 2026-10-06:

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/streaming-responses
- https://deepinfra.com/hexgrad/Kokoro-82M/api

## Voice latency release and validation

This change requires the merged Cloudflare Pages frontend **and Functions** build. It adds no migration, secrets, environment variables, wallet grants or provider accounts. Keep the existing policy inactive during deployment and verify `/api/ai/config` returns `enabled:false`; record the exact merged SHA and Cloudflare deployment receipt. No Lovable action is required. Refresh the Android PWA so its request contains `audioFormat:"pcm_s16le"` before evaluating the new path; older cached clients remain compatible but use WAV.

Only then resume the existing approved supervised allowance (30 total attempts / $1 provider spend, cumulative with earlier tests). Re-run the same synthetic name/address, missing contact and exact-measurement questions, plus a multi-field question. Record answer words, exact facts, first visible text, first audible voice, total elapsed time and streaming continuity. Test Stop during startup/playback, backgrounding, text-only mode and speech failure/device fallback. For the older supervised workflow, set policy inactive afterward and read back credits; the cumulative closed-pilot release above now supports remaining active between tests. As always, never reset wallets or recycle unknown provider reservations. If startup reaches eight seconds, show the usable text and fallback rather than wait indefinitely; tuning that deadline requires evidence from the pilot.

Further efficiencies to evaluate after timing evidence: larger later phrases to reduce provider request overhead, compressed audio on poor mobile networks (PCM uses 48 KB/s before transport overhead), and reducing Google-read setup through an authoritative, freshness-preserving read strategy. Do not cache stale project facts, prefetch paid speech, enable a premium tier or add another model/provider without approval and measured benefit.
