# Admin Portal Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. No live side effects.

**Goal:** Owner-only visual user reporting and audited manual credits, with approved caps and speech support.
**Architecture:** D1-enforced transactions and source allocations; server Google subject authorization; separate online-only React entry.
**Tech Stack:** React/Vite, Cloudflare Pages/Functions/D1, existing Google OAuth and Stripe ledgers.
**Spec:** docs/superpowers/specs/2026-10-24-admin-portal.md

## Global Constraints

800 credits per grant/account/month; 4000 across all accounts/month; 12500 integer units/credit. America/New_York months. Manual goodwill survives refunds but cannot bypass access/holds. Speech uses manual/purchased funds, never starter. No merge/deploy/live grants/credentials/provider spend.

## Review Focus

Source restoration after refunds; partial reservations/reversals; request replay after changed policy; missing authentication assurance; historical reporting coverage and mode isolation.

### Task 1: Source-aware ledger and schema

- [ ] Write/observe failing tests for caps, replay, reserved/spent reversals, mixed source restoration and schema preflight.
- [ ] Add migration 0025, database guards, manual funding allocations and speech integration.
- [ ] Run real SQLite migration/ledger tests; prove rollback and competing writes. Test D1 integration remains a pre-activation gate without remote authorization.
      Interfaces: existing shared wallet/turn APIs preserved; adminWallet, grantCredit, reverseGrant consume D1 and verified actor context.

### Task 2: Owner authorization and reporting

- [ ] Failing tests for non-owner denial, same-origin rules, idle/absolute windows, step-up nonce/JWT freshness, grants/reversals, registry/date/reporting correctness.
- [ ] Add narrow admin API, Google verified-signin hook, daily activity, bounded directory reconciliation, reporting and immutable audit receipts.
- [ ] Run server tests. Missing Google assurance leaves mutations closed; no credentials are enrolled.
      Interfaces: handleAdmin(context), observeAccount(db,identity,time), server-owned reporting projections; client never supplies owner authority.

### Task 3: Visual portal and telemetry

- [ ] Failing user-flow tests for table/filters/cards/drawer/confirmation/retry/account switching.
- [ ] Add online-only admin entry, chart summaries, credit grant/reversal UI, foreground activity endpoint and minimal app signal; exclude admin caches.
- [ ] Run component tests and build, verify synthetic desktop/mobile preview.
      Interfaces: API allowlisted DTOs; no customer content or credentials in browser reporting.

### Task 4: Operator preflight and recovery documentation

- [ ] Add runnable exact-schema classifier tests and bounded bootstrap/reconcile/recovery tooling.
- [ ] Document exact SHA release gates, owner binding/assurance and disabled default policies; add disclosures.
- [ ] Verify scripts with synthetic input only.

### Task 5: Whole-branch review and PR

- [ ] Run repository test/build/Functions/Worker/capacity/audit checks.
- [ ] Fresh whole-branch security/accounting review; fix important findings with regression tests.
- [ ] Commit, push codex/admin-portal with [CF-Pages-Skip], open PR to main, attach it. No merge/deploy.
