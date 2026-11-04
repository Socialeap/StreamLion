# Provider Setup Bridge Implementation Plan

> For agentic workers: use superpowers:executing-plans task by task.

**Goal:** Deliver an explicit verified read-only F|3D profile connection in StreamLion as the first increment of the approved shared-provider wizard.
**Architecture:** F|3D reads existing owner-scoped profiles and signs a short-lived snapshot; Cloudflare verifies and stores only its account-scoped operational projection. No credentials cross the bridge.
**Tech Stack:** TanStack server functions/React/Supabase; Cloudflare Functions/D1/WebCrypto/React.
**Spec:** ../specs/2026-11-04-provider-setup-bridge.md

## Global constraints
No production/credential changes, no service role for user reads, no publication or enrollment writes, no entitlement migration, no Google record migration. Preserve prior branding-removal correction. Exact origin/source plus audience/nonce/session checks. No stale snapshot authorization.

## Review focus
Wrong-account approval; expired/replayed assertion; malformed snapshot/private-data leakage; absent profile or conflicting source names; interrupted popup/request must not misreport connection.

## Tasks
- [ ] 1. Pin strict shared snapshot/signature contract in identical fixtures, RED then GREEN in both repos.
- [ ] 2. F|3D owner-scoped projection/signing server function and popup consent page. Sign only server reads; never accept snapshot from browser. Build/typecheck.
- [ ] 3. SL D1 nonce/snapshot migration, authenticated start/complete/read/unlink handler. RED then GREEN negative/positive API tests; preserve session/credit ownership.
- [ ] 4. SL reusable profile connection UI in Account/setup, popup handshake, explicit manual refresh/freshness and recovery. Component tests.
- [ ] 5. Record cross-repo audit/release packets and generated maps, run verification, fresh-context review, commit/push separate PRs. No merge or activation.

Ruling: shared saves cannot safely precede the existing F|3D public/Directory profile ownership reconciliation. Increment 1 makes the verified existing sources visible without adding a third canonical profile or pretending that global SSO exists. Subsequent increments remain explicit in the spec.
