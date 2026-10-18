# Privacy-filtered brief preparation — release held

## Approved scope and boundaries

This implements the owner's approved initial brief workflow only. It does not
activate the importer, change Ask/ChatGPT handoff behavior, add Orama, send mail,
modify saved projects or change pricing/pilot/QA allowances. The base is
`b12db62` (merged PRs 109/110 included). Google remains the authoritative saved
project store; no separate Google identity-map file or new D1 table is added.

The browser reads a PDF or pasted text, masks detected emails/phones/URLs/street
addresses, labeled names, existing project contact identities and user-selected
phrases, and requires an explicit filtered preview before preparation. This is
assisted masking, not guaranteed anonymization: unlabeled names, unusual contact
formats and identifying context can be missed. The user can add phrases or use
manual entry. Lines containing labeled credentials are excluded entirely;
work/access requirements on those lines must be checked separately. The original
filename is replaced with `Project brief` for OpenAI. Original source text is
kept in component memory, not added to draft/recovery storage.

The authenticated StreamLion request carries the filtered text and a bounded
replacement list separately. The server validates that envelope before debit.
Only filtered text, candidate fields and review findings cross the OpenAI
boundary. The list exists in request memory; no map/source is written separately
to D1 or logs. The server restores known references before encrypting the final
result with the existing account/request binding. A second session can recover
that completed result with the same request ID and account/workbook scope; it
needs no map from the first device. This does not add a cross-device pending-job
listing. If an isolate dies before storage, the existing stale-job refund applies;
recovery never restarts inference. Historical encrypted results stay readable. Restored results are size-checked before
completion so a short tokenized result cannot expand beyond the recovery response limit.

## Bounded preparation

- GPT-6 Luna, standard processing, `store:false`, no paid tools or external fetches
  except the explicitly authorized OpenAI Responses requests when activated.
- One generation, then a separate review with the ENTIRE filtered source and the
  generated brief. Any finding triggers one full corrective generation and one
  final review. Maximum four calls, one shared 45-second deadline, authorization checked before each call, no network
  retries, one job/credit reservation/QA attempt and the existing quoted price.
- Unknown/altered references, malformed output/review or final extraction errors
  fail/refund rather than returning unverified fields or running another cycle.
- Source gaps/conflicts remain `Needs confirmation`; they are not resolved by
  invention. Original source findings survive a later empty review. Affected
  actionable fields are cleared rather than silently chosen; their extracted
  wording is retained as explicitly unconfirmed evidence.
- New requests require privacy protocol v1; the server quote includes workflow v2.
  A stale frontend fails closed before debit and must update. Completed historical
  results remain recoverable and are not falsely described as having this review.
- The existing minimum reserve remains USD 0.10. At the verified standard Luna
  rates (USD 0.10/M input, USD 0.50/M output), the conservative four-request bound
  is USD 0.040816: 65,536 UTF-8 request bytes plus 4,096 framing tokens per call,
  1.25x cache-write input allowance, and 3,000 output tokens on EACH call (reviews
  are actually capped at 1,200). This is a code-bound estimate at those rates,
  not a vendor billing guarantee. Reverify rates before activation. Never raise a
  rate, reserve, mode or allowance automatically to make a request succeed.

## Separate release gates

1. **Review/merge — HOLD.** Review the PR and successful required `verify` check.
   Neither merge nor deployment is authorized by the implementation task.
2. **Migration — NONE.** Do not apply SQL or mutate policies, credit journals,
   account records, historical attempts or replacement grants. Existing migration
   0016 result encryption/expiry/cleanup works without changes.
3. **Configuration — PRESERVE.** No secret/config change is required to deploy
   this code. Keep sales, public importer, general AI and all existing pilot/QA
   settings exactly as they are. Enabling or funding real calls requires separate
   owner approval, current pricing check and a bounded allowance; this PR grants
   no real calls or allowance reset.
4. **Functions deployment — HOLD** for merge and explicit owner authorization.
   Deploy only the approved merged Pages Functions including `brief-pipeline.js`.
   No cleanup/coordination Worker deployment is required.
5. **Frontend release — separate HOLD** for merge and explicit authorization.
   Release matching assets/revision. Pages bundles Functions/assets together, so
   obtain both scopes and record both receipts. Use ordinary PWA Update; never
   clear storage, drafts or folder selection.
6. **$0 release checks and owner QA — separate gates.** Check served revision,
   closed gates and historical result access without submitting a preparation.
   Mocked tests establish protocol/credit/recovery behavior, not real-model
   extraction quality or physical-device acceptance. Any later real-model test
   needs explicit capped spending authorization; keep live sales closed.

No Lovable action is required. StreamLion uses GitHub, Cloudflare and Google.

Official references checked October 18, 2026:
[Model](https://developers.openai.com/api/docs/models/gpt-6-luna),
[pricing](https://developers.openai.com/api/docs/pricing),
[data handling](https://developers.openai.com/api/docs/guides/your-data).

## Validation receipt

- 896 local unit/integration tests passed, including actual local workerd/D1
  fixtures with injected provider responses. No live OpenAI call was made.
- Regression cases include repeated/case-varied detected names, case-sensitive
  URL restoration, secret omission, exact measurements, unknown references,
  correction/recheck findings, source conflicts, result expansion, permission
  expiry between stages, one debit/refund, simultaneous retries, historical
  result recovery and a fresh same-account session without a local map.
- Frontend/PWA/extension build, Pages Functions compile and local capacity checks
  passed. These do not establish real-model accuracy or production capacity.
- A fresh branch review found repeated-name, conflicting-field, response-size
  and URL-case issues; each has a failing-then-passing regression and fix.
