# StreamLion: client-to-delivery workflow

## Result

The landing page leads with the provider/client relationship: directory discovery or a branded share link, intake and scope agreement, field assistance and saved client progress, then a reviewed Completion Brief. The hero is **Win the client. Deliver the capture.** Separate CTAs serve providers and clients looking for a provider.

Core remains a one-time purchase. Optional AI preparation, broader answers and hosted speech retain separate quotes and charges. New jobs use the existing active project policy (currently 240 credits) at Completion Brief delivery, rather than scope approval. The app does not scan spaces, host tours, automatically list providers or independently certify capture quality.

## The existing 600-credit implementation

- `migrations/0009_client_coordination.sql` defines a once-per-account/mode 7,500,000-micro-unit grant, equal to 600 credits. The grant requires a paid Core purchase and an active coordination policy.
- `server/client-coordination.js` grants it when the provider connects client coordination. It is not issued at checkout or anonymous signup. `grantStarter()` is idempotent; repeated setup does not issue another grant.
- AI and project fees share the promotional balance, which is used before purchased credits. Hosted speech retains its separate purchased-credit rules. A full refund or dispute that removes the final paid Core purchase revokes remaining starter credits; repurchasing does not issue another grant.
- Read-only production aggregate checks on October 24, 2026 confirmed test and live policies active with `project_micros=3000000` and `starter_micros=7500000`. There were no paid live Core accounts and no live starter grants. One test account had a recorded grant. Queries wrote zero rows. No grants or payments were changed remotely.

## Settlement and delivery

1. A newly recorded scope approval pins `projectBilling: delivery` and the authorized price in the existing signed Google event record. Both approvals still confirm the agreed field brief. They create no project spend. AI remains independently metered.
2. At **work completed**, the provider prepares a Completion Brief from verified Google project and observation heads. It includes the agreed scope, reviewed records, exact measurements, exceptions, source references and shared reference-file links. Internal project fields are excluded, and a draft checklist blocks generation until reviewed. The provider checks the rendered report and explicitly authorizes delivery.
3. The server recomputes the report and compares the exact content hash with the preview. Changed saved records, unanswered questions, pending scope changes or a changed unpaid fee stop delivery before any charge or upload. Preview itself changes no credits or Google records.
4. One encrypted journal reserves the existing stable `job:<id>` fee, uploads and byte-verifies the HTML in the provider's private Drive folder, records a `delivery_pending` checkpoint, then saves and verifies the client-visible attachment reference. Only after that verification is the reserved fee marked complete. The reference remains protected by the existing job-scoped client session.
5. Insufficient funds retain the project and original delivery operation without uploading a file. A top-up lets that same operation recover. Unknown outcomes retain their journal and reservation for retry; a timeout is not treated as a refund or proof of failure. Client acknowledgment and the provider's service-fee payment remain separate from platform settlement.
6. Repeated requests, acknowledgment, reopening and same-job correction delivery reuse the job spend identity. Already paid jobs are never charged a second project fee. Encrypted pending legacy activation plans retain their original approval-time charging and recovery behavior. Existing Core preview/export functionality remains available.
7. Generated reports do not consume the 20 user-reference slots. The existing overall signed-job size limit still applies. Completion downloads verify their exact bytes and hash; modified originals fail closed.

No new model calls, AI spend permissions, automatic recharge, credentials, Stripe products or payment policies are introduced. Clients receive saved and refreshed online updates; this is not guaranteed instantaneous delivery while offline. Public intake retains the provider's existing email-confirmation choice; private invitations require verification.

## Verification

Regression coverage includes unchanged approval/progress balances; exact reviewed report bytes; private fields and draft checklist protection; insufficient funds and same-operation recovery; failed delivery checkpoints; legacy encrypted-plan recovery; 20 existing references; reopened jobs and changed future pricing; and source-change rejection before spending. Existing starter-grant, mode isolation and mixed-funding/refund tests remain in place. UI, production build, Cloudflare bundle and capacity checks are required before handoff. Local previews use synthetic API responses and make no Google, AI, Stripe or email calls.

## Release gates

1. **Review and merge:** owner reviews the PR, including the charging-time change and revised terms. Require exact-head CI. No merge is authorized by this implementation request. `[CF-Pages-Skip]` commits hold incidental branch deployment.
2. **Cloudflare backend deployment:** after merge and owner release authorization, deploy Pages Functions from the approved merged main SHA, including `server/completion-brief.js`, coordination engine/API and existing ledger helpers. No D1 migration, new secret, provider setting or policy activation is required. Preserve existing active policies, account balances, encryption keys, AI/cost gates and payment modes. The cron relay source is unchanged and needs no separate deployment.
3. **Frontend release:** Pages publishes Functions and assets together, so approve the frontend release from that same SHA as a separate gate before invoking the existing Pages release procedure. Do not release this frontend against the old backend: it describes delivery-time settlement. Verify `/release.json`, service health and fresh landing, terms, credits and provider/client routes. Do not open payments, enable AI or run a credit-consuming request as a deployment health check.
4. **Owner/device QA:** verify branded intake/email recovery, agreed visit, field clarification and saved progress; review/download a Completion Brief as provider and client; confirm scope approval leaves credits unchanged and one explicit delivery deducts 240 once. Use an approved synthetic/test workflow first. Phone, live-customer, live-money or real AI acceptance requires the owner's separate scope and authorization. Share the deployment and QA receipt before calling this live.

Receipt: merged main SHA; exact Pages backend/frontend revision; migration/configuration `not required`; preserved policy/mode and safe health result; synthetic delivery and balance evidence; separate owner phone/client acceptance. No live deployment or customer delivery is claimed by this PR.
