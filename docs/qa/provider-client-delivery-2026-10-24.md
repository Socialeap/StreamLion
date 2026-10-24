# Provider/client delivery QA — October 24, 2026

Result: **PASS in an isolated synthetic workspace**, using the deployed PR #126 source at `474dca0acf3d9022ef21cae329393fe3fb8ac3fb`.

## Executed workflow

The provider enabled coordination, created a private email invitation and scheduled the visit. The client verified the synthetic invitation, submitted intake and approved scope. Both sides exchanged a field clarification; completion was unavailable until the question was answered. The provider marked work complete, previewed/reviewed the generated Completion Brief and delivered it. The client downloaded and acknowledged it. The provider closed, reopened and delivered two corrections; an exact replay of the original delivery operation and repeated coordination setup were also checked.

| Checkpoint | Available credits | Completed project spends |
| --- | ---: | ---: |
| Fresh eligible synthetic Core account | 0 | 0 |
| First coordination setup | 600 | 0 |
| Scope approval, progress, and brief preview | 600 | 0 |
| First delivery | 360 | 1 × 240 |
| Exact delivery retry | 360 | 1 × 240 |
| Acknowledgment, closure, reopening, two corrected deliveries | 360 | 1 × 240 |
| Repeated setup | 360 | 1 × 240 |

The ledger retained exactly one starter grant. All 240 spent credits were promotional; purchased credits and pending operations were zero. The first client browser download was 4,709 bytes and matched the signed saved artifact hash: `48e101cb76ce474402d09a8f39504b55bdbccd203a2a3115c4228d97e6b12684`.

The client signed out and the provider revoked coordination after the run. The local database confirms both the client session and provider connection were revoked. Browser warning/error logs were empty. Local evidence is retained in `artifacts/pr126-workflow-qa-2026-10-24/qa-receipt.json` in the owner's workspace; it is not committed.

## Isolation and limits

The actual UI, API handler, coordination engine, signed append/history adapter and committed SQLite migrations/triggers ran locally. Core eligibility was a seeded test record. Google HTTP was fixture-backed, email went to a local sink, and a localhost proxy mapped test cookies/origins to the handler's HTTPS assumptions. The first attempt corrected an incomplete Drive-capability fixture before the fresh successful run.

No real payments, paid AI calls, production project writes or external requests occurred. This does not verify live Google OAuth/Sheets/Drive, real email delivery, directory/public-share entry, physical capture evidence, AI responses, or installed-phone/PWA behavior. The synthetic report correctly disclosed that no checklist or reviewed field evidence was supplied.

## Follow-up and release classification

QA found misleading setup/summary wording that implied an approval-time fee, and a 240-credit button on free correction delivery. The accompanying frontend changes describe first-delivery charging and no additional correction credits while retaining the review checkbox and unchanged server command contract. The updated labels were exercised in the same isolated browser flow before final closure.

Validation: 133 focused frontend/API tests passed; production Vite/PWA build and `git diff --check` passed.

This diff changes frontend copy, one UI regression test and this QA note only. No backend code, migration, durable-state change, secret, provider or environment update is required. Review and merge remain prerequisites for a separate Cloudflare frontend release, followed by hosted/device acceptance. The copy fixes are not deployed by this QA run. No Lovable action is required.
