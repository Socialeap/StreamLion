# Production completion candidate — October 8, 2026

Base production release: `9e90df8274883e6cd8243258b5915d75a62175e0` (PR #62). This receipt covers the completion branch, restricted activation and checks below. Review, merge, deployment and owner/device acceptance are separate.

## What changed

- Providers see loading, paused-service, sign-in, Core-required and connectivity states with appropriate actions. Paused service no longer suggests Google sign-in will activate it. The fixed OAuth return allowlist includes `/api/client-requests`; arbitrary destinations stay rejected.
- Exhausted email ceilings show the next UTC day/month boundary and disable new invitations while an existing verified brief stays usable. The server reads preserved attempt history before creating a job or sign-in challenge; the dispatcher still claims every send atomically.
- The request guide explains invitation, client intake, mutual approval and delivery. Each selected job exposes a copyable opaque project locator. Email verification is still required; the copied link contains no credential.
- Clients can supply the prototype's additional reference/document fields. Project/account/role-scoped device drafts preserve only changed editable wording and original comparison values. Reopening the same version does not falsely report a newer brief. A genuine newer revision preserves the draft and warns before stale submission; server conflict protection remains.
- Draft recovery has a seven-day restore limit, rejects malformed/private/closed-job records and never shares an edit automatically. It is separate from Core device backups. Successful acknowledged client sign-out clears client draft storage; failed sign-out preserves the usable form and reports failure. Storage denial leaves typing usable with an explicit warning.
- Clients can download a sanitized printable HTML work-order summary of the current shared version. User text is escaped, external loads/scripts are blocked, private notes/Drive IDs/unsaved edits are omitted, and attachments must be downloaded separately from the protected portal. Provider-reported payment remains explicitly labelled.
- The landing page now presents client request → agreed brief → field records → delivery, a working native provider/client request demo, existing field/voice demos and one-time Core plus optional prepaid services. A public status probe reports only enabled/public/status, coalesces schema checks for 30 seconds and fails closed within a bounded response time. Private authorization and mutations always read fresh readiness.
- Root and API privacy pages agree on existing optional AI disclosures and the new local portal-draft behavior. The reference form ID is corrected to Jotform 232567126292155; production uses the custom intake.

## Source and rendered verification

| Check                                        | Result                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete source suite                        | 416 passed, zero failed/skipped; final run covers the draft warning fix, invitation quota guidance and temporary-ceiling expiry/live isolation.                                                                                                                                              |
| App and extension production builds          | Passed.                                                                                                                                                                                                                                                                                      |
| Cloudflare Pages Functions compilation       | Passed.                                                                                                                                                                                                                                                                                      |
| Dedicated coordination relay dry compilation | Passed; no deployment performed by this compile.                                                                                                                                                                                                                                             |
| Dependencies                                 | Existing audit reported zero vulnerabilities; dependency/lock files are unchanged. CI repeats the audit.                                                                                                                                                                                     |
| Local capacity                               | Existing zero-provider exercise: 400 shared reads allowed 200; 100 account writes allowed 40; retained histories up to 9,999 rows exercised. This is control correctness, not Workers/Google load or an SLO.                                                                                 |
| Landing demo                                 | Native provider/client switch, client brief submission, both approvals, sample activation, provider delivery and client acknowledgement passed without real sends, writes or spend.                                                                                                          |
| Portal draft                                 | At 390 × 844, exact wording including “12 7/16” survived reload and became the shared version only on Save. Same-version recovery showed no false newer-brief warning.                                                                                                                       |
| Provider link                                | Native Copy client link produced “Project link copied.” The locator contained only the opaque job ID; email verification remained required.                                                                                                                                                  |
| Responsive render                            | 1,586 × 992 design viewport, 1,360 × 900, 390 × 844 and normal 1,200 × 863 had no horizontal overflow. Landing broken-image count was zero and console error/warning list was empty. Temporary viewport overrides were reset.                                                                |
| Work-order download                          | Button produced the truthful “download started” status; export escaping/private-field tests passed. Browser automation timed out obtaining a completed file path and browser policy blocked the internal Downloads page. Actual saved-file/print verification remains an owner/device check. |

### Design comparison and copy check

The three generated section concepts were viewed before implementation. Final native PNG captures were visually inspected at the concept viewport and mobile size.

| Concept point          | Final implementation / comparison                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero composition       | Airy warm background, forest text, left statement and right functional workspace; header and complete hero fit the 1,586 × 992 viewport.                                     |
| Hero hierarchy         | Exact H1: “From client request to completed work.” Audience line: “For 3D and 360 capture providers.” Both CTAs are native controls.                                         |
| Coordination layout    | Four numbered steps on the left; real role-switching request form on the right. The restricted-test status is visible below the section.                                     |
| Request affordances    | Inputs, submission, approval and acknowledgement work. The inert invented phone/URL in the concept was deliberately replaced with the actual native demo.                    |
| Pricing layout         | Open Core explanation/list on the left; forest purchase card and mint CTA on the right. Earlier heavy outlined card treatment was removed after comparison.                  |
| Mobile behavior        | Hero, coordination and pricing stack into one column at 390 pixels without squeezed side-by-side cards or horizontal overflow.                                               |
| Brand and factual copy | Original lion and real workspace controls are preserved. Invented “Clients/Templates” navigation, fabricated date and unsupported savings claims are excluded.               |
| Purchase behavior      | Existing exact quote, closed-sales fallback and no-subscription/no-auto-recharge controls remain. Availability is conditional rather than a hardcoded public-launch promise. |

Above-the-fold final copy:

> From client request to completed work.  
> For 3D and 360 capture providers.  
> Agree the brief with your client. Keep site tasks, exact room readings and evidence together. Deliver a clear handover from your Google workspace.  
> Try a sample job · See one-time pricing  
> One-time Core purchase · Optional prepaid services

There is no accidental copy mismatch in that implemented text. Deliberate concept deviations are listed above; literal image fidelity is not claimed where the concept invented unsupported product controls.

## Restricted live state and recovery

The guarded October 8 activation set only the test coordination policy active. Live policy stayed inactive. Existing schemas/stamps matched the committed preflight; no migration, secret, financial balance or ceiling was changed. The original email limits are 20/day and 500/month to the restricted QA inbox. Today's 20-attempt allowance was exhausted and one synthetic invitation queued. The owner approved a test-only 40/day allowance through October 11, expiring automatically at `2026-10-12T04:00:00.000Z` (midnight after October 11 in America/New_York). This source change awaits deployment; no counters were reset and the monthly cap/recipient restriction are preserved. No new paid service or AI/payment spend was introduced.

Pages currently serves `9e90df8274883e6cd8243258b5915d75a62175e0`, deployment `411acdf6-e1c0-409c-a4e7-10eb0ee70d57`. Signed cron relay remains `afbbc793-40c8-4b68-bbf6-1d3ad5b33a32`. These IDs prove the existing baseline, not this completion branch.

The owner approved the full protected D1 recovery drill after the sensitive-copy approval gate. The offline restore passed integrity and schema checks, and all 15 financial aggregate checks matched production. Sensitive temporary files were deleted. See [sanitized recovery receipt](production-recovery-drill-2026-10-08.json). Actual Cloudflare rollback, Google archive recovery and device recovery remain separate.

The owner separately approved a temporary QA-only background grant for the existing synthetic workbook and private QA folder. It was enabled using the staged native form. Live acceptance results and final grant revocation/original-selection restoration will be recorded before claiming that QA run complete.

## Release classification and remaining actions

This diff changes frontend assets, server Functions and two non-secret test email variables: `RESEND_TEST_DAILY_LIMIT=40` and `RESEND_TEST_DAILY_LIMIT_UNTIL=2026-10-12T04:00:00.000Z`. The owner explicitly approved this temporary test ceiling. It adds no migration, secret, provider credential, purchase catalog or live-mode switch. Existing base `RESEND_DAILY_LIMIT=20`, `RESEND_MONTHLY_LIMIT=500` and `RESEND_TEST_RECIPIENTS` stay unchanged.

1. GitHub: inspect the committed candidate, pass required CI and obtain explicit owner merge approval under the established release rule.
2. Cloudflare: deploy the approved merged main to the existing `streamlion` Pages project including Functions. Record exact main SHA/deployment ID. Apply only the committed temporary test variables above; preserve other bindings/settings/policies. Confirm the effective 40/day test allowance and automatic expiry, then request a fresh synthetic sign-in link if the earlier 20-minute link expired. Do not reset counters, replay migrations or deploy unrelated Workers. The relay code/configuration is unchanged.
3. Frontend/visitor check: confirm the same release SHA, then open fresh landing/provider/client sessions and exercise the real CTAs, OAuth return, status states, draft recovery, summary and attachments.
4. Owner/device acceptance: actual file/print, installed-phone Google reopening/restore, microphone/camera interruption and optional notification display. Commercial policy/access/spend approval and representative scale/cost measurements remain required before a paid-public/scale-ready claim.

The [current readiness matrix](launch-readiness.md) includes unfinished template/dynamic-intake and cold-restore planning items, commercial gates and the deadline execution order.

Current published-rate/source estimates and the remaining fully loaded cost gate are recorded in [the cost check](production-cost-check-2026-10-08.md). No new AI request or spending approval was introduced.
