# StreamLion operations, recovery and capacity

## Service ownership and diagnostics

The owner must record an incident owner, backup operator and private alert destination before paid launch. No alert delivery or paid monitoring subscription is created by this change. Use existing account controls; if needed capabilities exceed the current allowance, stop for an owner decision.

A safe baseline is one health check every five minutes plus daily release/cleanup review. Check `/api/health`: schema 2 returns 503 for missing configuration, unavailable D1 or missing required schema stamps. Results may be cached 30 seconds. It makes no provider calls; authenticated Google and payment acceptance remain separate. HTTP failures carry `X-StreamLion-Request-ID`; support should collect that ID, timestamp, operation and app revision, not credentials or customer content.

Application failure entries contain generated ID, fixed route class, status and elapsed milliseconds only; at most 60/minute/isolate. Do not enable full request/response, invocation URL, token, query or exception-body logging. Restrict access and use the existing platform retention; do not create exports or third-party telemetry. Cleanup emits aggregate deletion counts with no customer identifiers. Its committed log configuration needs Worker redeployment. A configured logger is not an installed alert or recovery receipt.

Use the [private operations report](private-operations-report.md) for a bounded manual view of queue age, grants, deadlines, delivery outcomes, internal request/credit budgets and an explicit cost allocation. It returns aggregate metadata only and cannot mutate or activate a service. Keep actual reports outside the repository in protected operator storage; incomplete coverage, stale receipts and unknown costs cannot clear a launch gate.

Alert on repeated health failure, sustained Google/Stripe 429/5xx, missed daily cleanup, D1 hard-limit approach, or save/restore failures. Review current allowances and per-customer recurring hosting/support cost before growing sales. Keep payment webhooks processing existing customers during a checkout incident.

## Incident response

1. Pause the affected operation; preserve device drafts, original media, D1 authorization/purchase state and Google history. Collect safe diagnostic ID and exact revision.
2. Check release mismatch, platform outage, configuration presence and quota state. Never print private values, rotate the Google encryption key or broaden scopes as a troubleshooting shortcut.
3. Use a previously accepted Pages deployment and, if needed, the corresponding cleanup version. Restore approved flags without deleting databases. Record versions and rerun anonymous checks.
4. For Google failures, retain queued operations. An uncertain write is verified using its existing revision/file identity before retry; do not invent a new identity or automatically replay a mutation.
5. For payment incidents, pause new checkout through an approved change while preserving webhook processing and verified existing licenses. Never affect F|3D products/endpoints. Follow the dedicated Stripe rollback guide.
6. Owner accepts a synthetic account/device roundtrip before reopening the operation. A rollback deployment alone is not restored customer service.

## Recovery drills — isolated, zero spend

Run existing automated drills with `node --import tsx --test src/backup.test.js src/google.test.js functions/api/extension-workbook.test.js functions/api/session-cleanup.test.js functions/api/extension-cleanup.test.js`. They verify exact original media/drafts, collisions and storage rollback, lost acknowledgement without duplicate append/upload, grant isolation and expired-state purge. Fixtures never call real providers. They do not establish live recoverability.

For D1: use the platform's current backup/Time Travel capability or an approved owner export; confirm plan/retention first. Protect the dump because it contains encrypted credentials and account identifiers. Restore into an isolated database, compare schema stamps and aggregate counts, test synthetic session refresh/purchase isolation there, and record restore point/version and recovery time. Never restore over production without a separate reviewed incident plan. Preserve the encryption key; backups are not a reason to rotate it. No claim is made that a current backup/export has been created by this PR.

For Google: pause all writers; duplicate the affected workbook and export both complete tabs before any repair. Confirm Drive sharing and linked-file access. Use Google version history only after identifying which customer changes would be rolled back. Retain the original and every branch in protected archival storage. Build/validate an isolated recovered copy, then have the owner accept and explicitly select it before reopening writes. Never remove headers/identities or resolve a fork by timestamp alone.

For a device: export a backup with unsaved work and original media; verify/restore it in a clean separate browser profile; compare exact measurements, drafts, operation/file identities and media bytes. Restore twice to prove no duplicates. Corruption/collision must preserve newer work. Physical iPhone/Android recovery remains an owner drill.

## Read-only workbook inspection

Use a private full Sheets `values:batchGet` JSON response (ranges Projects and Observations) or `{ "Projects": [headerRow, ...rows], "Observations": [headerRow, ...rows] }`. Keep the input outside the repository and public artifacts.

```sh
node scripts/inspect-workbook.mjs /private/path/workbook-values.json
```

The script accepts up to 25 MiB, reports only tab counts, issue codes and spreadsheet row numbers, and exits nonzero for missing headers, oversize grid, duplicate identities or invalid/forked histories. It performs no network calls or modifications and does not produce a partially writable snapshot. Review every affected row on the protected copy. Missing ancestors/cycles require restoration of the original chain; forks require owner-reviewed reconciliation on an isolated copy, with both branches preserved. Automatic repair/compaction is deliberately unavailable.

At row/response ceilings, create and validate a new explicitly selected workbook for future work while retaining the old workbook/history and linked media read-only. Do not blindly copy only latest heads: observations and original file links must be retained and validated. A complete automated migration/archival design remains a scale gate.

## Capacity envelope

`npm run verify:capacity` is local, synthetic and forbids fetch. It bursts 400 shared reads (exactly 200 accepted), 100 single-account writes (exactly 40 accepted), verifies rejection does not consume shared capacity and next-minute recovery, then parses 100/1,000/5,000/9,999 revision rows five times. It prints payload bytes, local parser timings and process heap, not production capacity. Run with Node >=22.13 for the SQLite fixtures.

Keep the committed 200 read/200 write per project per minute, 40 per account, 10,000 grid rows/tab, 8 MiB extension response and single-active-editor/project boundaries. A typical plain revision save uses four reads and one write; media/refresh add requests. Fixed-window boundaries, external Google clients and shared ChatGPT egress require representative staging checks. Do not raise limits to make a failing exercise pass.

Before claiming scale, choose concurrent users, actions/minute, workbook payload/history size, p95/p99 latency, save-error/uncertain-outcome objectives and acceptable recurring cost. Use only synthetic accounts and isolated staging, with owner-approved $0 envelope and an explicit request budget. Measure actual Workers memory, network/provider throttling and D1 indexed row usage. Stop if allowance/cost/configuration cannot be verified. No paid upgrades, auto-recharge, real searches, live charges or load against production are authorized by these fixtures.

References: [Google Sheets limits](https://developers.google.com/workspace/sheets/api/limits), [Cloudflare D1 allowances](https://developers.cloudflare.com/d1/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
