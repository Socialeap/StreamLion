# Coordination snapshot optimization implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Keep the user-authorized execution scope: implement, validate, commit, push, and open a review PR; do not merge or activate anything live.

**Goal:** Reduce activation snapshot amplification while preserving durable recovery, serialized writers, and pilot modes; replace the inaccurate release instructions with a committed runbook.

**Architecture:** A request-local Google write context starts with a fresh snapshot after the existing journal has been acquired. Validate append response values and destination before extending that context; reconcile the full authoritative history before finishing the activation charge and before completing the operation. Retain cold recovery and all existing lock/identity checks.

**Tech Stack:** JavaScript, Node test runner, SQLite/D1, Cloudflare Pages Functions, Google Sheets API.

**Spec:** Owner instruction on October 14, 2026: implement safe Gate 1 optimizations and correct the release runbook; preserve the writer lock and pilot modes; validate recovery and open a review PR; do not merge or change live settings. The corrected operational requirements are recorded in [the release runbook](../../launch-and-scale-release-runbook.md).

## Global constraints

- Preserve `streamlion_coordination_one_writer_v1`, sealed journal identities, pilot modes, existing policy prices, email quotas, and live settings.
- No migration, duplicate index, secret/provider change, deployment, real provider call, merge, or spending.
- Keep existing Core and archive recovery behavior and signed-history checks.

## Review focus

- Planning snapshots are stale until revalidated under the acquired writer gate.
- Every one of four appends can succeed remotely and lose its response.
- Echoed range metadata without matching values cannot verify an append.
- External edits/forks must prevent operation completion, including after the last append.
- Recovery must preserve one charge, one logical event/revision, and blocking of other jobs.

## Task 1: Pin the optimized transport and recovery contract

**Files:** Create `functions/api/coordination-scale.test.js`; update the synthetic append receipts in `test/archive-fixture.js` and the injected adapter in `functions/api/client-coordination.test.js` only as required by the new interface.

- [ ] Add real-engine/real-adapter synthetic tests: activation uses four full snapshots and four appends; completed replay uses zero; each lost acknowledgement recovers cold with one charge and blocks another job until recovery.
- [ ] Add tests for missing/corrupt append echoes, stale heads before journal execution, and tampering before the charge checkpoint or final reconciliation.
- [ ] Run the new suite and confirm the expected amplification/interface failures before production edits.

## Task 2: Reuse only verified request-local state

**Files:** Modify `server/coordination-google.js` and `server/coordination-engine.js`.

**Interfaces:** `withWriteSnapshot(callback)` supplies `event`, `projection`, and `verify`; existing standalone methods retain their readback behavior. `append` returns the Google append response with values included. `parseSnapshot(rows)` retains current validation and groups event chains in one pass.

- [ ] Implement echo/destination validation and context updates; abandon the context on any error.
- [ ] Use the context in normal journal execution, with full verification before `finishProject` and before completing the journal. Leave Core/template/archive-import execution paths intact.
- [ ] Run new and existing coordination/AI/notification tests; fix all regressions.

## Task 3: Correct the runbook and deliver the review branch

**Files:** Add `docs/launch-and-scale-release-runbook.md`; link it from `docs/launch-readiness.md` and describe measured behavior in `docs/backend-efficiency.md`.

- [ ] Document correct Stripe routes/secrets, mode coupling, prices/policies, existing index/CI checks, actual verification commands, and separate approval/activation/deployment/device gates.
- [ ] Run the full test suite, capacity exercise, frontend/extension build, Pages Functions build, both scheduled Worker dry-runs, and whitespace checks.
- [ ] Request an independent code review, resolve important findings, commit and push the branch, open and attach a review PR. Do not merge or change live settings.
