# In-app project brief preparation — review only, disabled by default

Create Project offers readable-PDF or pasted-text input, a small collapsible
email/message-to-PDF tip, a credit/USD quote, and a prepared-details review.
Only an explicit import fills empty draft fields; existing nonempty fields are
kept. Nothing automatically saves a Google project. Manual entry and the user's
own ChatGPT handoff remain available.

The existing lazy PDF.js reader runs on the device: at most 5 MB, 20 pages and
6,000 characters. Image-only, password-protected and over-limit PDFs produce a
clear error and preserve the current source and draft. There is no OCR in this
version. Only extracted/pasted text is transmitted after price confirmation;
the original PDF is never uploaded by this feature. Server input is bounded to
30,000 bytes and output to 48,000 bytes/3,000 model tokens. `gpt-6-luna` uses
strict JSON Schema with no tools, no response history, and no inference retries.
Schema validity does not prove factual accuracy: review remains required.

## Default state and billing

`ENABLE_BRIEF_IMPORT=false` and `STREAMLION_BRIEF_IMPORT_COST_APPROVED=false`
are explicit defaults. New D1 policies for test/live are inactive, unpriced and
have zero budgets. The endpoint additionally requires approved live payments,
a paid StreamLion license, server-only OpenAI key and a valid 32-byte existing
Google token encryption key. Test-mode wallets can never buy OpenAI calls.
No AI pilot, coordination, checkout or payment setting is changed.

`streamlion_brief_jobs_v1` is a separate purpose-specific journal using the
existing purchased/promotional wallets. Atomic SQLite triggers check policy,
available funding, one pending job per account, a ten-attempt rolling daily
account ceiling, and global daily/total attempt budgets before reserving credits.
All attempts, including failed/refunded ones, consume the operator's reserved
spend budget. The existing AI and coordination ledgers/triggers are unchanged.
The brief budget is additional to their budgets; approve the aggregate ceiling
before any future paid activation.

The customer price comes from the active brief policy, never a frontend constant.
It must cover the operator reserve and be a multiple of 50,000 wallet micros
(4 credits = USD 0.05), avoiding fractional-credit or fractional-cent quotes.
**12 credits / USD 0.15 in tests and screenshots is a synthetic fixture, not
an approved launch price.** No price or budget is activated by this PR.

## Retry/recovery and privacy

The browser persists only a request ID and opaque account/workbook scope before
POST. The server binds that ID to the authenticated owner, workspace and source
hash. Concurrent/replayed requests never invoke the model twice; changed input
or workspace requires explicit reconciliation. GET recovery works even when
new preparation is paused. A valid result is encrypted in D1 using a job-bound
AES-GCM context before completion; raw source text is not stored in D1 or logs.

Refusals, truncated/malformed/unusable output, provider errors and timeouts
fail the job and atomically return its reserved purchased/promotional credits.
There are no automatic inference retries. A worker interrupted after reservation
leaves a recoverable pending job, which is failed/refunded after five minutes
on the next account check/recovery or scheduled cleanup. It is never run again.
Completed preparation is charged even if the user later discards the result.
Re-importing fills empty fields only and never duplicates a Google save.

Saving either a draft or a reviewed project is blocked while that draft has a
recoverable preparation reference. The editor returns to Start with recovery
instructions; import/discard the result or recover a failed attempt before saving.
This keeps a new draft from gaining an ID and stranding its recovery marker.
Starting preparation is also disabled during an active save, closing the reverse
race. Local edits and draft backups remain available; no marker is migrated or
silently deleted to allow a save.

Results cease to be recoverable after 24 hours. Account access removes expired
payloads; the existing daily session-cleanup Worker also erases them, normally
within 48 hours of creation. Financial metadata remains for budgets/refunds.
The cleanup addition safely skips databases without migration 0016. Updated
privacy pages explain OpenAI processing and its separate retention controls.

## Separate release gates — all live actions held

1. **Review/merge:** review this PR and passing required `verify`. No merge is
   authorized. Commit messages use `[CF-Pages-Skip]`, not `[skip ci]`.
2. **D1 migration:** HOLD until merge and explicit migration approval. Verify
   all existing 0001–0015 markers first. For 0016, inspect every named table,
   index and trigger below. Apply `migrations/0016_brief_import.sql` byte-for-byte
   only when ALL are absent. If all exist, validate their definitions and stamp;
   do not replay. Stop on any partial state or mismatch. Check existing row
   counts/balances/policies before and after; new policies must remain inactive
   and zero-priced/zero-budget. No production restore or record rewrite.
3. **Configuration:** no activation is authorized. Keep both new flags false,
   both brief policies inactive, and every existing pilot mode/checkout control
   unchanged. No new credentials, sales activation or AI spend. A future
   activation needs owner approval of the customer price, model availability,
   current model rates, conservative per-attempt reserve, aggregate daily/total
   spend ceilings and permitted document handling. Mock tests cannot establish
   real extraction quality or the sufficiency of a paid cost reserve.
4. **Server deployment:** HOLD until merge and explicit backend release approval.
   Compile/release the merged Pages Functions, including
   `/api/brief-import/{config,prepare,result}`. Separately release the changed
   `streamlion-session-cleanup` Worker from `ops/wrangler-cleanup.jsonc` only
   within the same approved backend scope; no coordination Worker change.
   Keep the feature disabled. Verify config is disabled and prepare fails closed
   without model calls; preserve existing webhook reconciliation.
5. **Frontend deployment:** HOLD until merge and explicit frontend release
   approval. Release that merged SHA's assets/privacy pages, verify release.json,
   and use the ordinary PWA update without clearing storage. Routing is unchanged:
   `/api/*` already covers these dedicated server handlers; static shells keep
   their exact exclusions.
6. **Owner/device QA:** after an approved disabled release, check the collapsible
   tips, readable-PDF file picker, source limits, handoff/manual fallback and
   preserved projects/drafts/selections on the phone. Enabled-flow QA must use
   an isolated local mocked harness; there is no production mock-bypass flag.
   Real-AI quality/cost acceptance and paid activation require a separate approved
   spend ceiling and release decision. Do not infer that approval from merge or
   a successful disabled deployment.

0016 markers: tables `streamlion_brief_policy_v1`, `streamlion_brief_jobs_v1`,
`streamlion_brief_schema_v1` (stamp 1); indexes
`idx_streamlion_brief_pending`, `idx_streamlion_brief_capacity`,
`idx_streamlion_brief_cleanup`; triggers `streamlion_brief_reserve_v1`,
`streamlion_brief_debit_v1`, `streamlion_brief_transition_v1`,
`streamlion_brief_return_v1`.

## Validation

Mocked endpoint/SQLite tests cover additive inactive migration, missing schemas,
approval/test-mode/auth/license/origin guards, scope/quote changes, policy races,
funding and budgets, duplicate/overlapping requests, encrypted recovery after
response loss/pause, refusals/incomplete/invalid/no-fact outputs, provider
errors/timeouts, exactly-once refund, stale jobs and expired result cleanup.
React tests cover PDF selection, tips, unavailable state, price display,
review-before-import, preserved existing fields, no automatic Google save,
failure recovery and remount without another POST. All provider responses are
injected mocks; no production credentials, files or balances are used.

Local validation: full suite and focused mocked checks passed; the hosted
required check records the final suite result. Vite/PWA
and extension build, Pages Functions compile, cleanup Worker dry-run and capacity
check passed. Local IAB browser QA used a synthetic readable PDF and pasted text,
mocked API responses and viewport overrides 320/390/1280: tips expand/collapse,
the real picker extracts page-labelled text, price/review render, explicit use
opens populated draft steps, and no horizontal overflow or app-console errors
were found. This is browser QA, not physical-phone or real-model quality proof.

API contract references: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[Responses](https://developers.openai.com/api/reference/resources/responses),
[Data controls](https://developers.openai.com/api/docs/guides/your-data).
