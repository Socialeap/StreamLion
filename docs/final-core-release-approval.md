# StreamLion Core — final approval packet (HOLD)

This packet prepares a decision; it does not authorize sales, public launch,
cleanup activation, a deployment, real payments or paid provider use.

## Evidence and limits

- PR #163 merged at `a973edb0b3085f2db1850af82cf5683f46778a19`.
  Migration 0027 was applied and its exact schema verified. Canonical owner-QA
  deployment: `aca25f12-2680-4ea6-92ce-00d4acb56540`.
- Owner confirmed phone/desktop sample-project sync and the listed installation,
  interruption, microphone, backup/restore and report-preview checks in chat.
  Owner-QA denial in airplane mode is correct; this grant is online-only.
- Fresh isolated component tests use synthetic paid status responses, not a real
  purchase or production database insertion. They verify online cache issuance,
  the exact seven-day deadline on offline cold start, no offline extension,
  expiration rejection, online unpaid/revoked status clearing the cache, and
  offline denial afterward. Missing and malformed caches are denied.
- The existing offline workflow test verifies cached workbook records, local
  note/measurement persistence and workbook-pinned pending saves across reload.
  Existing server purchase/owner-QA tests cover durable entitlement boundaries.
- This is application-logic evidence in Node/JSDOM with IndexedDB fixtures,
  not a physical paid-account airplane-mode acceptance or a real-browser
  service-worker cold-start certification. Owner device tests establish the
  physical PWA behavior already reported, but under an online-only QA grant.
- The offline cache is a local device convenience, not a signed licence or an
  authorization credential. Server routes independently require durable access.
  Seven-day expiry is evaluated at licence checks/cold starts; there is no paid
  cache-expiry timer that forcibly closes an already-open offline workspace.
  Offline revocation cannot be immediate; it is enforced after online status
  verification. Do not promise continuous validation or immediate offline revoke.
- The November 7 sandbox receipt records hosted payment, tax, 3DS, decline,
  refund, access revocation and stale-event replay acceptance, then cleanup.
  A real canonical production payment round trip remains deliberately untested.

## Sequential approval and cleanup gates

1. Review this packet and its test-only PR. Merge only after checks pass. This
   diff changes tests/documentation only: no backend migration, activation,
   frontend deployment or Lovable action is required for this packet.
2. Decide the launch scope: Core only, with the existing offer and refund terms.
   Keep optional AI, paid speech, credit sales, free-pilot admissions, paid
   delivery and provider capabilities held unless separately approved. If
   physical paid-offline certification is required before launch, commission a
   separately isolated test environment with synthetic entitlement and a handset;
   do not fabricate a production purchase or change owner QA into paid access.
3. Separately authorize owner-QA cleanup. Before mutation, Codex reads the actual
   current canonical deployment/source and hashes configuration. Verify the exact
   current encrypted `STREAMLION_OWNER_CORE_QA_LICENSE` grant is the approved
   `google-workspace` grant; its recorded expiry is November 10, 2026 at
   4:38:42 p.m. EST. Preserve any unrelated/newer owner work. Stop on mismatch.
4. Under that cleanup authorization only, remove that one production QA binding,
   preserve all unrelated production/Preview settings, and redeploy the exact
   approved current source with its current assets/Functions. Do not run the old
   November 1 rollback script: its preconditions/source are stale and rolling back
   would remove the workbook fix. Preserve migration 0027 and account preferences.
   Do not delete Google workbooks, project rows, device backups or purchase data.
5. Codex independently verifies the serving source/deployment, QA binding absence
   in project AND serving deployment, normal online unpaid-owner denial, healthy
   database, paused Core/credit checkout, and unchanged pilot/AI/settings. Retain
   audit evidence; remove only identified local temporary grant/identity files
   after their ownership is verified. Do not broadly delete sessions or revoke
   Google permissions. Existing inactive deployments containing QA bindings must
   be inventoried; delete only owned QA deployments after the new deployment and
   rollback safety are confirmed. Expiry remains an independent fail-closed guard.
6. Owner reviews the cleanup receipt. Sales and public launch are still held.
   If opening Core sales is desired, explicitly approve its exact configuration
   diff, source, deployment and audience. Codex must first prepare/read back those
   exact values and check for intervening changes; this packet does not select a
   checkout flag value from memory. Keep credit checkout and optional features
   held. Record approved offer price/tax/refund/support terms in that approval.
7. Under separate exact sales/release approval, activate only the approved scope,
   verify the served source and public offer, and provide a release receipt.
   No real purchase is authorized by these preparations. A later real-payment
   smoke test would require explicit separate authorization and a spend limit.

## Copy-ready decisions (not authorizations until owner sends one)

Cleanup only:

> I approve owner-QA cleanup only under docs/final-core-release-approval.md:
> remove only the approved owner-Core QA binding and redeploy the verified current
> revision. Preserve workbook reconnection and data. Keep sales, credit checkout,
> optional features and public launch held. No real purchases or Lovable credits.

Prepare sales activation review only:

> Prepare the exact Core-only sales activation diff and final public offer for
> review. Keep activation, sales and public launch held. No real purchases,
> provider spending or Lovable credits.

These decisions are separate. The second can be prepared without activating the
first, but public launch must not be called complete before cleanup verification.
