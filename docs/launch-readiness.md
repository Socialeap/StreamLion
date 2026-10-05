# StreamLion launch readiness — October 5, 2026

This is the canonical readiness matrix. Historical PR receipts describe their own releases. Source checks, deployed configuration, authenticated acceptance, physical devices, payment activation and scale are separate gates.

**Decision: paid public launch HOLD; scale HOLD.** The Core implementation is an engineering candidate for owner acceptance. The launch-hardening branch must be reviewed and merged before its behavior is live. Follow [launch-hardening-activation.md](launch-hardening-activation.md) for deployment and [operations-runbook.md](operations-runbook.md) for recovery and capacity boundaries.

## Current evidence

Read-only production audit on October 5 verified main/deployed SHA `5747a275a13db0cac43ca2013cdb255a78e5517f`, passing App checks, 226 source tests, build/Functions compilation, public Google session configuration and anonymous ten-tool MCP smoke. Auth/counter/folder/extension objects matched committed definitions and schema stamps. Preview had no production secrets or D1 binding. These receipts do not prove authenticated phone or customer workflows.

Production purchases and enforcement were disabled; purchase/Stripe objects were absent. The scheduled cleanup Worker was configured for 03:23 UTC, with one invocation and zero errors in the preceding 24 hours; logs/traces were disabled. Google Auth Platform audience/branding status was not inspected because the owner passkey was required.

## Hardening delivered for review

- OAuth form bodies stop and cancel at 12,000 actual UTF-8 bytes, including missing/false Content-Length. No full buffering before rejection.
- Missing, malformed, invalid and expired webhook signatures are rejected locally before D1/provider work. Signed events retain fail-closed preflight, replay and current-state reconciliation.
- Public quotes have a shared 200/minute ceiling and a per-network 60/minute ceiling. Validated price catalogs coalesce/cache for 30 seconds; checkout validates fresh prices; no entitlement or reservation count is cached.
- Extension Google responses stop at 8 MiB before JSON parsing; oversized input never becomes an editable partial snapshot. The browser workspace and original records remain available for reviewed recovery.
- Health schema 2 checks configuration and required D1 markers, with 30-second coalesced caching and a bounded timeout. It does not call Google/Stripe or establish their availability.
- Middleware attaches a generated request ID and emits at most 60 sanitized failure entries/minute/isolate. No query, payload, tokens, account IDs or exception text is logged. Cleanup configuration enables its counts-only logs without invocation URL logging or traces; redeployment is required.
- The sales CTA defaults to the sample. Purchase/refund promotion becomes actionable only after a valid live quote; disabled/test/invalid/unavailable quotes keep the sample path.
- Wrangler/Miniflare/Undici and the compatible serialization dependency were patched. CI now audits development and production dependencies and runs a zero-provider-call capacity exercise.
- A read-only workbook inspection tool reports problem row numbers; it never repairs a branch, deletes history or writes to Google.

Main protection was applied and reread October 5: required `verify` check from GitHub Actions app 15368, strict up-to-date checks, one approving review, administrator enforcement, resolved conversations, no force push/deletion. An eligible reviewer must approve; PR authors cannot approve their own PRs. `ops/main-protection.json` records the requested policy. Protection and CI are not deployment or owner acceptance.

Verification for this hardening: **245 tests passed**, production/extension builds and Pages Functions compilation passed, cleanup dry compilation passed, all-dependency audit reported zero vulnerabilities, local quota/history exercises passed, and seven synthetic purchase states passed in rendered Chrome (1360 x 1000, with closed-sales flow also at 390 x 844). No physical-phone, authenticated provider or live-recovery acceptance is claimed.

## Remaining acceptance

| Gate                         | Status                         | Required receipt                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardening source and preview | Review/merge required          | Passing complete source suite, production/extension builds, Functions/cleanup dry compile, dependency audit, synthetic capacity and rendered closed/live-quote fixtures.                                                                                                                                    |
| Hardening activation         | Not activated                  | Approved merged main SHA; exact Pages and cleanup Worker versions; schema 2 database-aware health; anonymous session/MCP checks; counts-only cleanup log. No payment/schema/secret changes in this deployment.                                                                                              |
| Google public onboarding     | Owner required                 | Owner verifies actual Audience/Branding/publishing requirements; two external synthetic accounts select folder/workbook, save/read back, upload exact media, reconnect/refresh, revoke and switch accounts without inheriting stale destinations. Keep drive.file; no wider scopes.                         |
| Physical Android/iPhone      | Not evidenced for this release | Install/reopen, mic/camera denial/interruption, background/app switching, offline retry, draft-safe update, clipboard handoff, print/share and exact backup/media restoration.                                                                                                                              |
| Payments                     | Disabled / not activated       | Preflight and apply committed 0004/0005 only under [Stripe activation](stripe-activation.md); test checkout, license enforcement, restore, refunds, disputes, replay and account isolation; owner policies/descriptor/tax/tester treatment and live authorization. $0/test cards until explicitly approved. |
| Recovery and operations      | Owner acceptance required      | Private alert destination and responsible person; actual D1, Google and device recovery receipts; synthetic expiry cleanup in an isolated environment; quota/cost review and tested rollback.                                                                                                               |
| Scale                        | Hold                           | Defined workload/size/SLO and recurring cost; representative Workers/Google concurrency and memory measurements in authorized isolated staging. Local SQLite/Node fixtures establish control correctness only.                                                                                              |
| Public ChatGPT distribution  | Separate optional gate         | Synthetic reviewer account/workbook, secure reviewer access, demo recording, portal client/callback and identity verification, executed positive/negative cases, legal attestations, submission and publication acceptance per [submission guide](submission/README.md).                                    |

## Product boundary

Google Sheets/Drive remain authoritative. Core provides reviewed brief-derived tasks, exact measurements, exceptions/evidence, recoverable field drafts, source-linked handovers, device backups and bounded foreground factual voice with typed fallback. No customer model API key is required. Client acceptance is provider-recorded, not an authenticated client signature.

Calendar/invoicing/accounting automation, agency dispatch/roles, authenticated client approval, unrestricted/background/multilingual voice or OCR, semantic indexing and the Frontiers|3D directory remain deferred. They are launch blockers only if offered as delivered benefits. The public ChatGPT extension is additive and is not a prerequisite for standalone Core.

Initial operation requires one active editor per project. The 10,000-grid-row/tab safety ceiling includes history and is not a tested capacity guarantee. No automatic archival/compaction or unified PWA/MCP/direct-Sheets transaction exists. Device JSON backups are private but unencrypted; browser storage can be evicted. Use protected owner storage and verified restores.

No Lovable action is required under StreamLion's established stack-specific release protocol: GitHub, Cloudflare, Google Cloud and Stripe. No paid upgrade, auto-recharge or paid model/search is authorized.
