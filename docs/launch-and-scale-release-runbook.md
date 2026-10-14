# StreamLion launch and scale release runbook

Updated October 14, 2026. This procedure replaces the activation instructions in the external `launch_and_scale_readiness_report.md`. It is not authorization to merge, deploy, change configuration, send email, charge a payment, or call an AI provider.

**Current decision: preserve the restricted test pilot; public paid launch and production scale remain HOLD.** Baseline source for the review was `2b2a5282212ce72bf8b2e18ebd1f1f0c38d67dd7`. The October 14 read-only review observed that revision live, coordination reporting `pilot`, and AI reporting `credits_not_active`. These are dated observations; obtain fresh receipts at each release gate.

## Gate 1 — reviewed code and local verification

This change reduces an ordinary fresh activation from nine to **six full-workbook snapshots**, retaining four append writes. It starts with a fresh snapshot after the existing durable journal has been acquired. Each append returns raw echoed values; the adapter checks their contents and destination before extending its request-local state. Each projection also refreshes authoritative history after the preceding remote event request, so a valid manual Sheets edit is rejected before a conflicting projection can be appended. A complete authoritative snapshot verifies the first event/projection before finishing the project charge, and another verifies history and final projection before completing the operation. Event chains are grouped in one pass before validation.

The connection-wide `streamlion_coordination_one_writer_v1` constraint is retained. A failed or ambiguous response leaves the original sealed operation pending. Recovery starts with a fresh snapshot, reuses that original operation ID and plan, and detects previously saved rows. Completed replay performs no Google writes or reads. No five-second takeover, timeout-based unlock, new executor, financial policy change, or cross-request project-content cache is introduced.

The regression suite covers each lost append acknowledgement with a cold adapter, missing/corrupt response echoes, stale planning heads, tampered history at both completion checkpoints, another job blocked during recovery, and exactly one charge. Existing suites cover signatures/forks, Core writes, templates, public intake, notifications, and archive import. These local tests do not establish live Google latency, Workers CPU/memory capacity, or supported concurrent users.

**No new D1 migration is required.** `migrations/0008_streamlion_ai_credits.sql` already creates `streamlion_credit_turns_time_v1(mode,created_at)`; do not add a duplicate `0014_scale_indexes.sql`. Lifetime credit aggregation still warrants profiling before a broader rollout. Do not prune cumulative reservation or webhook-idempotency records without reviewed accounting/replay requirements.

Run from the repository root:

```sh
npm test
npm run verify:capacity
npm run build
npx wrangler pages functions build --outdir=/tmp/streamlion-functions --compatibility-flags=nodejs_compat
npx wrangler deploy --dry-run --config ops/wrangler-coordination.jsonc --outdir /tmp/streamlion-coordination-worker
npx wrangler deploy --dry-run --config ops/wrangler-cleanup.jsonc --outdir /tmp/streamlion-cleanup-worker
git diff --check
```

The runner is Node's test runner with `tsx`, not Vitest. CI already checked capacity and the coordination Worker dry-run before this change; this release also adds the cleanup Worker dry-run. All Worker commands above are dry-runs. They do not activate live Workers or cron schedules.

Before scale approval, measure representative signed histories, multiple jobs and viewers, cold/warm verification, response bytes, full/targeted read counts, p95/p99 latency, memory, pending age, and recovery throughput in separately authorized staging. Snapshot requests still use complete tab ranges and reject oversized history after download; bounded response sizes and the remaining larger-history cost require separate measured work. Never remove integrity checks to meet a read-count target.

## Gate 2 — Cloudflare backend deployment

**HOLD until the PR is reviewed and merged by an authorized owner, and deployment is authorized.** Record the exact current merged `main` SHA containing this change. Deploy only that approved revision through the existing Pages pipeline. The changed server modules are `server/coordination-engine.js` and `server/coordination-google.js`, used by the coordination Pages Functions and enrolled-workbook write paths.

No migration, secret, provider setting, runtime mode, quota, grant, price, or scheduler configuration change is needed for this optimization. Verify that prerequisite schemas remain fully applied using the existing committed preflights. Stop on partial/altered markers; never generate substitute SQL or replay an applied migration. Preserve all pending journals and existing encrypted records.

Record Pages deployment ID/SHA, Functions build result, schema/preflight result, unchanged configuration/policy classification, and safe health/configuration probe results. `/api/health` reports `upstreamsChecked:false`; it is not proof of authenticated Google access, AI availability, payment settlement, email delivery, or a scheduled action. The two auxiliary Workers have no runtime change in this PR; their dry-run checks do not require redeployment.

If rollback is needed, use a separately approved prior code revision through the existing deployment workflow. Do not delete journals, financial rows, or Google originals, rotate the token/signing key, or disable live payment webhooks to roll back this optimization.

## Gate 3 — separately approved commercial configuration

This gate is future work and is not part of the Gate 1 change. Inspect effective Cloudflare Pages settings and D1 policy values read-only before preparing an exact activation receipt. `wrangler.jsonc` does not contain payment mode, AI-credit mode, the approval flags, or the test recipient list; do not treat example documentation as the effective configuration.

### Preserve the pilot modes

Keep the existing payment and AI-credit modes at matching `test` values. `coordinationReady()` and notification dispatch require the modes to match. Changing only `STREAMLION_AI_CREDITS_MODE` to `disabled` pauses coordination and its notifications.

`disabled` means the paid-credit ledger is disabled; the AI handler can instead use the manual pilot ledger and incur real provider costs. It still requires keys, an enabled pilot, an active policy, an eligible wallet/workbook, and remaining allowance. Concurrent manual-pilot AI and test coordination needs a reviewed code change, not a one-variable toggle. No new pilot or live spend is authorized here.

For a later live AI launch, the handler requires `STREAMLION_AI_CREDITS_MODE=live`, `STREAMLION_PAYMENTS_MODE=live`, `STREAMLION_AI_COST_APPROVED=true`, and `STREAMLION_LIVE_PAYMENTS_APPROVED=true`, plus configured provider keys, eligible purchased access, and approved active policy values. Review `cost_micros`, `daily_budget_micros`, `total_budget_micros`, and `daily_requests`; setting `active=1` alone is insufficient. Fail closed on unavailable policy, funding, provider configuration, or capacity checks. Keep live credit sales disabled until service eligibility and explicitly approved budgets are ready.

### Stripe routes, credentials and prices

Use the implemented HTTPS endpoints:

- `https://streamlion.transcendencemedia.com/api/purchase/webhook`
- `https://streamlion.transcendencemedia.com/api/credits/webhook`

The consumed secret names are `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_AI_WEBHOOK_SECRET`. Live activation replaces their values with the explicitly approved live credentials under those names; `STRIPE_LIVE_SECRET_KEY`, `STRIPE_LIVE_WEBHOOK_SECRET`, and `STRIPE_CREDITS_LIVE_WEBHOOK_SECRET` are not consumed by these handlers. Keep values out of source, receipts and logs.

Follow [stripe-activation.md](stripe-activation.md) and [ai-credit-activation.md](ai-credit-activation.md) for the source-derived account, product, prices, pinned API version and event requirements. Confirm the live account ID, license product, $39.95 standard price, $29.96 launch price and remaining First 200 slots, AI credit product and $10/$25/$50 price IDs, refund/terms/tax/descriptor acceptance, webhook signatures and replay handling. Set `STREAMLION_AI_CREDIT_SALES_ENABLED` only under separate authorization after live credit readiness passes. Preserve test/live record isolation; test purchases and wallets never become live funds.

Coordination has its own active policy. The committed schema defaults to **$3 per agreed job**, allows $2 or $3, and grants $7.50 starter credit. The report's $1.50/job and five starter jobs are not supported by this schema. Any change to that commercial policy requires explicit owner approval and a reviewed migration/product change; do not substitute an arbitrary policy UPDATE.

### Google authorization and request capacity

Confirm the actual OAuth project's audience/publishing status, requested scopes, branding/domain verification, and any applicable verification or user limits. “In production” removes the Testing-specific seven-day refresh-token rule for relevant new grants; it does not make tokens permanent, establish verification, or prove existing Testing-issued grants became durable. Test a non-test-user consent flow, refresh/reconnect, and revocation without losing local or Google records. [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

StreamLion reserves **40 requests/account/minute and 200/project/minute per read/write bucket**, including its Sheets and Drive traffic. These are application safety limits. Google's standard Sheets read limits are 60/user/project/minute and 300/project/minute; inspect actual project quotas before any separately approved limiter change. Four activations/account/minute or 22/project/minute from the old nine-read arithmetic were optimistic bounds without other traffic, not proven capacity. [Google quotas](https://developers.google.com/workspace/sheets/api/limits).

### Email allowance and recovery

Preserve the effective `RESEND_TEST_RECIPIENTS` allowlist and existing budgets. The committed 40/day temporary boost expired at `2026-10-12T04:00:00.000Z`; the fallback is **20 attempts/day and 500/month**, unless separately approved effective settings differ. Retries consume attempts; acceptance is separate from delivery. No paid tier, upgrade, auto-recharge, recipient expansion, or higher allowance is requested by this change.

Previously skipped messages have their payload replaced and are not replayed by expanding the allowlist. If separately authorized, issue fresh valid invitations/verification requests rather than blindly requeueing those rows. Before public intake scale, reserve access/verification capacity, control unauthenticated verification abuse, and measure queue age, budget use, accepted/delivered messages and failures. Provider Google OAuth sign-in is not a Resend email-sign-in flow. Retain dispatch ownership and provider pacing. Recovery cron cadence is not a one-minute completion guarantee: retries back off up to an hour, and unresolved access/integrity issues remain pending for review.

## Gate 4 — frontend release and public read-only checks

This PR changes no frontend behavior or copy. Pages may release frontend assets and Functions together; verify both against the approved merged SHA through the existing pipeline. This gate does not authorize public sales or activation.

Use the actual script entry points; there are no corresponding `npm run verify:release`, `verify:purchases`, or `verify:credits` aliases:

```sh
node scripts/verify-release.mjs https://streamlion.transcendencemedia.com APPROVED_MERGED_SHA
node scripts/verify-purchases.mjs https://streamlion.transcendencemedia.com test
node scripts/verify-credits.mjs https://streamlion.transcendencemedia.com test
```

Replace `APPROVED_MERGED_SHA` with the exact approved 40-character SHA. Use `live` instead of `test` only after the separately approved live configuration gate. These public GET checks do not perform a purchase or AI call, and their success does not prove payment settlement, an AI answer or device acceptance. Confirm the landing's sales and coordination copy accurately reflects the effective gated state; hiding the offer in test mode is intentional.

## Gate 5 — owner and device acceptance

Obtain separate authorization and a fixed spend ceiling before any real purchase/refund, live AI invocation, or additional email allowance. Prove buyer restoration, account isolation, Google refresh/reconnect, one actual agreement, one lifetime project charge, a fresh verified Google projection, and actual email delivery. Exercise a permitted interrupted save and its original-operation recovery in isolated staging. Complete the installed-device checks separately from source tests and deployment receipts.

Record the approved main SHA, deployment IDs, schema/configuration classification, secret names/presence only, mode-scoped policy/budget values, public probes, authenticated results, and owner/device acceptance. Until each required gate has its own receipt, report code/review readiness and the remaining holds; do not report public launch or production scale ready.
