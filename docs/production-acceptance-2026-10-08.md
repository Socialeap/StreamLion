# Production acceptance and client-link recovery — October 8, 2026

This records actual post-deployment checks of PR #63 and a separate frontend follow-up. It does not declare paid-public or scale readiness.

## Deployed release

- PR #63: owner approved merge and deployment after required CI passed.
- Reviewed head: `4f5de19e9b9017804bdbe4ca67621ade4f493211`.
- Merged main: `a51041a3b9fa52af57101a996b2cfc16cd5bc1e4`, merged at 06:40:11 UTC.
- Successful production deployment: `835b1a8b-307d-49dc-9ebb-959436124c76`. Cloudflare and the public `/release.json` artifact agree on the exact SHA.
- `/api/health` reports ready, with persistent Google sessions and configuration/database ready. Public coordination availability reports `enabled: true`, `public: false`, `status: pilot`.
- The owner-approved temporary test email allowance is active: base 20/day, temporary 40/day until `2026-10-12T04:00:00.000Z`, monthly 500 and approved QA recipient restriction unchanged. Live mode never uses the override. No budget history was reset.

## Real synthetic acceptance

Only the existing approved QA workbook/folder and QA inbox were used. No client submission, private brief or credential from a real customer was used.

Request: `job-98395f75-130f-4ee0-b9c4-381d5338013f`, “StreamLion synthetic acceptance 2026-10-08”. The temporary Google grant was explicitly approved by the owner.

| Check                     | Actual result                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation                | Fresh email arrived at the approved inbox at 06:45:11 UTC. The earlier challenge expired while the original daily allowance was exhausted; it was not replayed as a current invitation.                                                                                                                                                 |
| Verification              | Actual private-link verification completed in the QA client browser. The credential fragment was removed before the brief was displayed.                                                                                                                                                                                                |
| Device draft              | Unsaved scope containing the exact reading `12 7/16` survived reload at the same version without automatic sharing or a false newer-version warning.                                                                                                                                                                                    |
| Shared brief              | Client explicitly saved scope, access instructions, deliverables, street address and city; verified version 1 readback.                                                                                                                                                                                                                 |
| Reference/document fields | Client explicitly saved Reference 2 and Document 1 names/HTTPS links; verified version 2. Provider saw the updated version and exact scope wording.                                                                                                                                                                                     |
| Appointment               | Provider saved October 10, 2026, 09:30–10:30, `America/New_York`, confirmed. Client reopened and saw the appointment at version 4. Native date entry was used because the automation's DOM date-fill operation did not commit a React change.                                                                                           |
| Original upload           | Owner approved temporary extension file access and enabled it manually. Only the 68-byte synthetic PNG was uploaded. The Google adapter returned success after downloading the saved original and comparing every byte; version 5 displayed the protected client file link.                                                             |
| Background access         | The upload completed at 07:12:58 UTC, after the initial Google sign-in was performed around 06:09 UTC, without a new consent flow. This is an end-to-end recovery observation; an exact token-renewal receipt and physical-phone reopening remain separate gates.                                                                       |
| Browser download          | The media-download helper timed out and lost its tab binding. A normal-click download event also timed out; a later direct file navigation was blocked by the browser. No cookies were exported, browser download storage inspected, or blocked browser settings bypassed. Completed-download/hash and print acceptance are still open. |
| Financial effect          | The displayed wallet stayed at 1,160 existing credits. A read-only production query found zero coordination spends for this request. Before cleanup, today's email attempt history was 22, within the temporary 40 ceiling; two QA notices were delivered and five notices skipped.                                                     |
| Cancellation              | Provider cancelled the synthetic request with an explicit QA-completion reason. Version 6 is read-only, all seven durable operations are complete, originals retained. No agreement or project charge was created.                                                                                                                      |
| Access cleanup            | Provider revoked the QA coordination grant. Read-only D1 checks found one revoked QA connection and one revoked client session. The old client browser opened the verification screen with no brief displayed.                                                                                                                          |
| Workspace cleanup         | Restored original workbook `102g0-N0A4UNIFkOmooOf26DND_tH5S_Zp15jRP-pbs8` and private folder `1_rEM-duT9VVvDJX3BwCtm1f2LrkBZMrY` using the ordinary Google pickers. No workbook or file was moved.                                                                                                                                      |
| Extension cleanup         | Owner confirmed “Allow access to file URLs” was turned off after the approved upload.                                                                                                                                                                                                                                                   |

The synthetic original was 68 bytes, SHA-256 `eb17861bd2d540a1ce8adb27f8c93add53328852b39aa07387fa0ed3d7593585`. This identifies the approved fixture; it is not claimed as a hash of a completed browser download.

## Separately reviewed frontend fixes

1. A private link opened into an existing tab can change only the fragment, without mounting the client portal again. The portal now detects a new verification fragment and reloads through the existing capture-and-remove path. Existing device drafts remain recoverable.
2. An app update could reload the page after its private token was captured and removed from the URL but before verification completed. Update is now disabled during pending verification and writes, with explicit guidance to finish opening the private link first.
3. A client session is bound to one project. Opening a different project's locator must not display that previous project's brief. The portal compares the requested job ID with the authorized response before storing or rendering the view, clears the private view on mismatch and requires verification for the requested project. Server job authorization remains bound to the session.

Review follow-up: verification acknowledgement now clears the consumed token before project readback. Expired/consumed-link rejection clears the retry and offers a new link; an unacknowledged transient failure preserves its token until retry or an authorized current-project session read. A failed post-acknowledgement read offers an availability check without retrying verification. The update lock is released after a known outcome.

Focused rendered tests: 16 passed. Complete source suite: 421 passed, zero failed/skipped. App/extension builds passed for this follow-up. Earlier Pages Functions compilation passed; Functions source and the existing relay were not changed. Native local checks previously proved the mismatch screen, same-tab verification capture and exact unsaved draft recovery; the new failure cases are source checks and need deployed acceptance. No provider request or email was issued by the local fixtures.

## Release classification

This follow-up changes client frontend behavior, regression tests and receipts only. No database migration, server change, environment variable, secret, Google permission, payment mode, AI request or spend ceiling is added. Release requires its own PR review, explicit owner merge approval, existing Cloudflare frontend deployment and fresh deployed client-link checks. No Lovable action is required.

The remaining planned intake-template/cold-restore work, physical-device proof, commercial approvals and representative workload/cost gates remain visible in [launch-readiness.md](launch-readiness.md).
