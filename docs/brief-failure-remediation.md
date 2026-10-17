# Brief-output contract and failure diagnostics — release held

The failed replacement remains in the original four-attempt journal. It was
refunded; the test wallet returned to 1,520 credits. This change neither resets
that allowance nor makes a failed result recoverable.

## Evidence and diagnosis limits

Read-only inspection of the existing OpenAI project found the restricted Pages
key active with Responses Write permission and last used October 17. Usage
reported one `gpt-6-luna` request, 2,327 input tokens and 1,126 output tokens.
No new model request was sent. The Responses history had no retained result;
the application deliberately uses `store=false`, retains no source or failed
output, and previously discarded the exception. Those observations do not
establish the exact returned field or failure stage. Do not describe the
historical failure as a proven authentication, quota or specific-field error.

A reproducible defect exists at the provider/application contract boundary:
the old strict schema required only strings, so it permitted amounts such as
`$1,500`, area such as `9,200 sq ft`, arbitrary appointment statuses and invalid
date/link/email representations. The downstream project validator rejects
those values and refunds the whole preparation. Existing successful provider
fixtures contained already-validated project objects, masking this gap.

The provider schema now constrains money, numbers, appointment status, currency,
email, HTTPS links and date/time representations. Instructions explain exact
representations, preserve source wording/measurements, and require unknown or
unrepresentable facts to remain blank with their original wording in review
notes. No rounding, guessing or automatic URL upgrades are introduced. Calendar,
time-zone, cross-field and other semantic validation still runs after generation.
This prevents the reproduced representation failures; it does not establish
real extraction quality or prove which field caused the historical incident.

Provider, timeout, malformed/incomplete/refused result, project validation and
processing failures now receive fixed error codes and random support references.
Console logs contain only service/event/code/reference and, for HTTP rejection,
a numeric HTTP status. No source, generated text, upstream error body, key,
account/workbook identity or job ID is logged. New failed responses display the
safe reason/reference only after the existing failed/refund transition. Replay
and historical recovery do not invent a reason or re-run inference. No additional
failure data is added to D1. A lost response may therefore recover the original
generic failure; do not promise persistent detailed diagnostics.

## Validation

Tests first reproduced schema-permitted values rejected by the project validator
and the missing safe failure code. Tests compile the actual emitted provider
schema, cover valid and invalid field representations, mocked provider outcomes,
redaction, real local D1 reservation/refund/replay/exhaustion, and preserved UI
source/draft data. No external model or charge is used. Full required checks and
hosted CI remain separate evidence in the review PR.

## Separate release gates

1. **Code review/merge — HOLD.** Review the PR and require successful `verify`.
   Its base is merged `db2243fb339aeffb11a3fc7b34d064cb7c91bbfc`; record the
   final approved merged SHA. This task authorizes neither merge nor deployment.
2. **D1 migration — none.** Do not change migration 0016, policies, balances,
   jobs, failed history or recovery state. Do not replay an allowance amendment.
3. **Configuration — preserve.** Model, processing tier, 6,000-character input,
   3,000 output tokens, response/request bounds, timeout, no-storage setting,
   price/reserve, original expiry and all budget/owner guards stay unchanged.
   No secret or provider-permission change is required by this code fix. Keep
   public importer/AI/sales gates closed and preserve current pilot settings.
4. **Functions deployment — HOLD for merge and explicit release authorization.**
   Release only the approved merged Functions, including the new failure helper.
   Preserve effective runtime bindings, including exhausted owner-QA switches
   where still authorized; Wrangler's false defaults must not silently change
   approved runtime settings. No auxiliary Worker deployment is required.
5. **Frontend release — separate HOLD.** Publish matching assets with the exact
   SHA release marker under explicit authorization. Pages uploads Functions and
   assets together, so obtain both approvals and record both receipts. Use the
   normal PWA update without clearing records, drafts, source or device storage.
6. **$0 post-release QA.** Check release/mode/exhausted-allowance guards and
   preserved history/balances; do not submit a production preparation. The four
   failed attempts remain exhausted even after this fix is deployed.
7. **Real-model acceptance — separate HOLD.** No fifth attempt, allowance reset,
   window extension, provider call or new spend is authorized. If the owner later
   wants another real test, prepare a separately reviewed bounded grant and
   explicit activation/spend authorization. Keep sales and general AI closed.

Official contracts checked: [GPT-6 Luna capabilities](https://developers.openai.com/api/docs/models/gpt-6-luna)
and [supported Structured Outputs schemas](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas).
