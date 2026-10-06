# Managed AI voice pilot (draft, inactive)

StreamLion uses repository/GitHub, Cloudflare Pages/Functions/D1, Google Cloud/Sheets/Drive and Stripe. **Lovable has no role in this stack. No Lovable action or handoff is required.** Apply backend and frontend release steps directly through the existing Cloudflare and Google Cloud systems.

StreamLion pays OpenAI for `gpt-6-luna` text and DeepInfra for `hexgrad/Kokoro-82M` speech. Customers never provide keys. Google Sheets/Drive remain authoritative. The server uses the authenticated session's selected workbook and project, not a browser-supplied record or workbook ID. AI cannot change records, call tools, or search externally.

## Review without credentials

Run `npm run dev`, then open `http://127.0.0.1:5173/ai-demo.html?ai-demo=1`. The isolated page supplies a synthetic project; enable Read answers aloud, ask “What is the name of the location?” and “Who is the site contact?”, then stop an answer or change projects mid-stream. This development-only fixture simulates incremental text and uses device speech. It contacts neither provider and spends zero credits. It does **not** prove model accuracy, hosted voice quality, provider protocol compatibility or latency. Production builds cannot enable the fixture with a URL parameter.

## Pilot boundaries

- Account enrollment remains closed. The approved activation configuration sets production `ENABLE_AI_PILOT=true`, but both server keys must exist, the D1 policy must be active with a positive budget, and the authenticated user's wallet must be explicitly enabled before a paid request is possible. The policy is staged inactive until the operator starts the approved test session. No public enrollment or automatic wallet grants.
- Pricing is a configurable **pilot proposal**, not settled commercial pricing: 12,500 micro-USD = $0.0125 (1.25 cents) per completed text answer, including attempted speech. 390 answers would use $4.875 in credits. The displayed price is submitted and checked again; a changed price requires review. No Stripe top-ups, paid wallets, auto-recharge or subscription changes are implemented.
- Credits are reserved atomically before provider calls. Duplicate request identities cannot re-run a provider call. Insufficient credits, disabled accounts, one active turn per account, six requests per minute per account, the global daily request limit and the global daily budget all fail closed. The owner controls the initial wallets; there is no customer write endpoint for credit balances.
- Incomplete text returns customer credits once. A completed text answer remains charged if voice or delivery subsequently fails. Unknown outcomes can retain customer credits for up to five minutes; a subsequent config/answer request expires stale reservations. **Refresh credits** reads the server balance. Questions/results/audio are not stored in the credit ledger. Request identities remain as deduplication tombstones for this bounded pilot.
- Every attempted turn permanently consumes a 6,000 micro-USD ($0.006) **estimated provider-cost reservation** for that UTC day, even on error or cancellation. This is conservative at documented standard prices and our bounded inputs; it is not a provider-enforced dollar cap or reconciliation against provider invoices. Never recycle reservations after unknown spending. Configure provider-side restrictions/alerts as available and revalidate prices before activation.
- Limits: 500 question characters, 10,000 UTF-8 bytes of project/field context, 300 output tokens, 1,200 answer characters, six speech phrases, one speech request at a time, standard provider tiers and no retries. Oversized projects refuse the AI pilot instead of silently dropping records. Google reads have existing 20-second timeouts; the overall AI operation has a 60-second deadline. Stop/background/unmount abort local playback and the browser request. A provider may still bill work already accepted before cancellation.
- Text streams through the Responses API. Complete phrases go to Kokoro while text generation continues. This first draft deliberately uses the documented native JSON/base64 WAV response for each phrase, **not unverified raw PCM streaming**. AudioContext is unlocked in the user gesture and plays phrase buffers in order. Playback failure keeps text available; device read-aloud does not incur another provider request. Hosted keys are never in Vite/browser configuration.
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
   - With a consistent Wrangler history: use `d1 migrations apply` only when 0007 is the only pending migration. Stop on other pending migrations or a contradictory 0007 stamp.
   - Without Wrangler history: after explicit authorization for this narrow installation, execute **only** the exact committed file with `npx wrangler d1 execute streamlion-google-sessions --env production --remote --file migrations/0007_streamlion_ai_pilot.sql --yes`. Do not run the migration directory, recreate previous objects, create/backfill `d1_migrations`, or generate/substitute SQL. Preserve the Cloudflare execution receipt and final bookmark as the platform receipt; this path does not produce a Wrangler migration stamp.
4. If all eight AI markers exist, skip application and compare their tables/index/triggers against the committed SQL and expected columns/constraints. If Wrangler history exists, check its 0007 stamp for consistency. Any missing AI marker, mismatched definition, duplicate/contradictory stamp, or failed prerequisite is partial state: **STOP and report; do not repair, regenerate, substitute or apply again**.
5. Re-read all eight definitions. On a fresh installation confirm policy `active=0`, `daily_budget_micros=0`, and no wallets. Owner-approved pilot grants and limits are separate changes; keep policy `active=0` while staging them. No client routes can grant credits or mutate the policy. D1 is accessed only by the existing server binding, not from the browser. No RLS/grants change is involved.
6. Deploy the current merged Pages build and its Functions through the existing GitHub/Cloudflare deployment path. This deployment changes both server code and the bundled frontend. The approved feature flag may be true while the policy is inactive; that remains a zero-provider-spend state. The owner operates Cloudflare directly. No Lovable action is required.
7. Non-credit-consuming check: GET `/api/ai/config` returns `{ "enabled": false }` with `Cache-Control: no-store` while the policy is inactive, including for the authenticated staged test account. With the feature flag false, POST `/api/ai/answer` returns 503. With the feature flag true but policy inactive, an authenticated request returns 403 (unauthenticated requests return 401). No provider call occurs in either case. Spend ceiling for this setup is **$0**. No real questions/searches or paid health checks.
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

Merged source and passing checks are not deployment proof. Confirm a fresh Cloudflare build SHA and refresh the installed Android PWA/service worker separately. Then, within the owner's approved budget, test both synthetic accounts for isolation; name versus address paraphrases; recorded and missing contacts; multi-field questions, measurements and checklist questions; malicious instructions inside records; ambiguous/unknown questions; dictation → Get answer; first visible text and first audible phrase; stop/background/project/account changes; low credits; double taps/retries; provider text failure; speech failure with device fallback; stale reservations and balance readback. Compare 20–30 varied questions to their actual Google records and record first-text/first-audio timing on Android, including a poor connection. Live provider compatibility, answer quality, speech quality and latency remain unverified until this paid pilot.

Commercial credit top-ups, signed Stripe credit issuance, refund/reconciliation policy, retention, sustained-load proof, support/observability and customer-facing final pricing are separate production work. This is a bounded internal pilot, not a production/scale green light.

Provider contracts checked 2026-10-06:

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/streaming-responses
- https://deepinfra.com/hexgrad/Kokoro-82M/api
