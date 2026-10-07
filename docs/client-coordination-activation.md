# Client coordination: implementation and activation

This is a disabled pilot implementation. Review/merge, D1 migration, backend configuration/deployment, frontend release and owner/device QA remain separate gates.

## Architecture and contracts

Canonical HTML entries use the existing service-worker-excluded `/api/` prefix so an installed PWA cannot replace a client invitation with the offline provider workspace. These static entries are separate from the JSON `/api/coordination/` endpoints.

Provider entry is `/api/client-requests`; free client entry is `/api/client-portal?job=<opaque-id>`. APIs live under `/api/coordination/provider/` and `/api/coordination/client/`. The provider uses the existing purchased Google account; a client uses a verified email grant scoped to one job.

Google `CoordinationEvents` holds immutable full revisions. `Projects` receives the agreed field brief, existing observations remain provider-only, and `ArchiveIndex` points to verified Drive packages. D1 holds authorization, financial allocations and encrypted temporary operations/outbox. Google remains the authoritative project record.

One provider/account/payment mode enrolls a private, owned workbook and folder. A workbook cannot enroll twice. Background credentials require explicit consent, expire after one year and are revoked through either coordination revocation or ordinary Google disconnect.

A partial unique D1 index permits one pending operation per workbook. PWA and extension appends enter the same gate. Managed project terms are edited in Client requests; field observations remain usable. Uncertain operations have no automatic lease expiry. Retries reuse immutable events, field revisions, Drive IDs and charge identity. Identical physical retry rows represent one logical event; conflicting duplicates or external edits stop for review.

Activation reserves funds, saves the prepared job and draft field projection, commits its single charge, saves confirmation, then publishes the reviewed field projection. Readback precedes completion. There is no atomic transaction across D1 and Google.

Material changes require both approvals. Access/contact updates require provider acknowledgment and invalidate old proposal approvals. Field completion saves are blocked while questions, proposals or acknowledgments remain. Portal polling runs every 15 seconds while visible; Core status runs every 20 seconds. Unsaved wording survives newer revisions and failures. This is polling, not guaranteed instantaneous delivery.

Email login uses fragment tokens, a deliberate verification button, 20-minute single-use challenges and a separate seven-day Secure/HttpOnly/SameSite cookie. Every request derives its job from the grant. Clients cannot select arbitrary Google files or other jobs.

Attachments support PDF/JPEG/PNG, up to 512 KiB each and 20 per job. The service checks signatures, ownership, private permissions and byte readback. Client views contain opaque attachment IDs; Drive IDs and private provider fields remain hidden.

Payment receipt is **provider-reported**. No bank, invoice service or agency payment ledger is connected.

## Credits

Google coordination events carry HMAC signatures bound to the workbook, provider and payment mode, using a domain-specific signing context and the existing approved encryption key. Missing/altered signatures stop processing. Keep that key stable during the pilot; key rotation requires a reviewed signing-key transition and credential re-encryption, rather than silently replacing the key.

`0009_client_coordination.sql` defaults both coordination policies to inactive. A confirmed job defaults to 3,000,000 microUSD (240 credits); the schema also permits 2,000,000 (160 credits). The UI presents credits.

A paid Core account can receive 7,500,000 promotional microUSD (600 starter credits) once per payment mode, shared with AI assistance. Promotional funds are used first; purchased and promotional allocations remain separate. Failed reservations return their original sources once. Core refunds/disputes revoke remaining starter funds; they are not reissued. Negative purchased balances block spending.

Existing AI price, model budgets, rate limits, Stripe reconciliation and purchased-credit refund behavior remain. Already-reserved AI turns are backfilled without another debit. No new checkout, subscription, auto-recharge or provider call is installed.

One project charge follows mutual approval. Drafts, clarification, rejected requests, later revisions and reopening incur no second charge. Cancellation after confirmed activation does not automatically refund it. Commercial cancellation/refund terms need owner approval before a paid pilot.

## PWA notifications and Resend

The integrated notification implementation replaces the production mailer binding with Resend. Invitations and important notices use transactional email; routine edits coalesce and prefer optional device alerts. Provider/client updates are routed to the opposite party, with private provider attachments excluded from client alerts. Authorized Google history appears in the portal's Updates panel.

Coordination additionally requires the additive `0010_coordination_notifications.sql` schema. Event-triggered dispatch and a one-minute fallback worker use durable notices, bounded retries and approved daily/monthly attempt ceilings. Acceptance, signed delivery evidence and explicit project acknowledgment remain separate. The old `COORDINATION_MAILER` exists only for synthetic test compatibility.

The complete configuration, exact migration preflight, credential boundaries, device limitations and deployment/QA procedure is in [notifications-activation.md](notifications-activation.md). All flags remain disabled pending owner configuration and authorization.

## Archival and pilot limits

Closure/cancellation defaults to 90 days of read-only client access, with a reminder 14 days before expiry. Client access ends on schedule independently of successful archival. Providers can extend unarchived access by up to 90 days or reopen for a recorded reason. Restoring expired access revokes old grants.

Archives include the current job, full coordination history, project revisions, observations, a readable report and verified attachment metadata. A stable Drive ID is encrypted before dispatch. Exact bytes and the ArchiveIndex pointer are verified before the job/Core projection becomes archived. Original attachments stay in the private folder.

**Original Google rows/files are retained. Automatic compaction/deletion is disabled.** External links and legacy audio URLs remain references; this is not a self-contained external-media backup. Restore currently restores provider visibility using intact Google history, rather than importing a deleted workbook.

Limits: 100 open requests per enrolled workbook; existing 10,000-row workbook ceilings; 700,000-byte plaintext archive packages to fit encrypted recovery limits. Segmentation/compaction, independently verified cold restore, bulk/multi-site intake, client identity replacement, agency dispatch, external payment reconciliation and client-side AI remain subsequent work. Do not claim unlimited scale.

## HOLD — only after merge and explicit owner authorization

1. Sync the current merged `main`; record its SHA. Confirm this document, `0009_client_coordination.sql`, API/coordinator modules and the dedicated worker exist. Do not deploy a draft branch.
2. Keep `ENABLE_CLIENT_COORDINATION=false`. Inspect D1 read-only: `SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL`; collect the version row of every existing `*_schema_vN` table. Do not collect secrets or project content.
3. Save the local inspection as `{"schema":[...],"stamps":{"streamlion_purchase_schema_v2":2,...}}`. Run `node scripts/preflight-coordination.mjs <inspection.json>`. It checks all committed prerequisite definitions and financial triggers.
4. Only when all new markers are absent and preflight reports `pending`, apply **committed `migrations/0009_client_coordination.sql` byte-for-byte in one transaction**. If all markers match and it reports `already_applied`, skip. Stop on partial state, drift or missing stamps. Never synthesize SQL. Record the file SHA-256 and platform migration receipt.
5. Reinspect/recheck. Verify both policies remain inactive, unique workbook/write indexes and shared-spend triggers match, and existing Stripe grant/AI transition triggers remain intact. Compare preserved purchase/order/wallet/reservation counts and backfilled allocation counts.
6. After the separate `0010` notification preflight/migration, and with owner authorization, configure the approved Resend/PWA settings from the notification procedure and existing Google settings in **both** Pages Functions and `ops/wrangler-coordination.jsonc`: `GOOGLE_SESSIONS`, `GOOGLE_AUTH_ORIGIN`, `ENABLE_PERSISTENT_GOOGLE`, `VITE_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `STREAMLION_PAYMENTS_MODE`, `STREAMLION_AI_CREDITS_MODE`, `ENABLE_CLIENT_COORDINATION`. Keep secret values out of source/prompts/receipts; use the approved encryption key consistently. Preserve unrelated settings.
7. Deploy merged Pages Functions and **only** the dedicated coordination worker. Its source config is disabled by default. Frontend release is separate.
8. Enable only the approved test policy/flag first; payment and credit modes must match. This document authorizes no live activation, real email/AI charge/purchase, secret/access creation or paid service.
9. Prove two isolated purchased test accounts/client grants; Google readback; interrupted/duplicate confirmation; source allocations; revocation/renewal; private uploads; delivery/closure; fake-clock expiry/reminder/archive recovery. Use synthetic data and an approved email test sink; no real AI spend.
10. Release frontend from the same merged SHA. Verify fresh provider/client loads, service-worker exclusions and provider phone/client-browser acceptance. Public availability requires a separate owner decision, terms approval and transport/cost/support evidence.

Receipt: merged SHA; migration SHA-256/platform stamp/classification; financial preservation/trigger checks; exact Pages Functions and coordination-worker revisions; mode/flag summary; binding names only; safe health result; separate frontend revision; owner/device QA result. Deployment alone does not prove field operation.

## Recovery

Keep verified Google history and financial records when disabling coordination for investigation. An uncertain reservation/write is not refunded, timed out or deleted automatically. Retry its original identity. Conflicting history requires administrator reconciliation before any explicitly authorized compensation; a timeout does not establish failure.

Revocation removes background credentials and client grants while preserving originals/recovery evidence. Renewal can resume exact pending operations. A rollback must preserve the managed-writer gate: an old appends-only backend would bypass agreement protection. Do not drop 0009 or substitute financial triggers as rollback.

The broader plan remains in [client-workflow-spec.md](client-workflow-spec.md). This first pilot keeps storage reversible and live activation explicit.
