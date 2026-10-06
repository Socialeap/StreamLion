# Google onboarding acceptance — October 5, 2026

Live checks used the production app at main `570140c300a26289491ac54b771f2a10b5d4727c`, the Codex in-app browser, and two owner-provided external Google accounts. Only synthetic test projects, workbooks, notes and a 209-byte checkerboard PNG were created. OAuth remained External / In production with the existing selected-file scope. No customer file, payment, secret, provider setting or scope was changed.

## Executed cases

| Case                                     | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account A connection and destination     | PASS   | Correct account; new workbook in the selected StreamLion folder; positive Google Picker workbook selection.                                                                                                                                                                                                                                                                                            |
| Exact records and original media         | PASS   | Independent Sheets export retained the original measurement wording and rational dimensions `99/8` and `21/2`. Drive download matched the original image byte-for-byte and SHA-256.                                                                                                                                                                                                                    |
| Close and reopen                         | PASS   | A new app tab in the same browser profile restored Account A, its folder/workbook, selected project and saved records without repeated consent. This does not prove a full browser/device restart.                                                                                                                                                                                                     |
| Account B and stale-tab isolation        | PASS   | B began empty with separate destinations. The older A session was rejected on refresh. A synthetic stale-tab save stayed on the device with Google send disabled; exports contained no cross-account project or stale-note writes.                                                                                                                                                                     |
| Cancellation, draft and network recovery | PASS   | Cancelling folder selection preserved A's destinations. An unsaved exact note survived reload. Confirmed `ERR_INTERNET_DISCONNECTED` requests preserved a queued record; retry after restoring connectivity produced one matching Google row.                                                                                                                                                          |
| Disconnect, revoke and reconnect         | PASS   | Disconnect persisted after app-tab reopen. Same-permission reconnect and explicit selection of B's existing workbook worked. Google confirmed B's StreamLion grant removal; active app refresh required reconnect and preserved the draft. Owner regrant restored the remembered B workbook; sending the queued note produced exactly one B row with the original record ID and wording, and no A row. |

Detailed exports, screenshots and the progressive JSON receipt are retained in the owner's local `launch-hardening-qa` directory. The device backup retained both A's unsent isolation-test note and B's revocation-test note. A's isolation-test note remains deliberately unsent; recovery testing did not reroute it to B.

Google Drive's viewer could not preview the tiny synthetic PNG, although the downloaded bytes matched exactly and StreamLion rendered the image. This is recorded as a viewer observation, not evidence of file corruption.

## Remaining gates

- Actual access-token expiry followed by successful reuse/renewal without consent. Reopening, revocation and regrant do not establish this result.
- Physical Android/iPhone installation, restart, capture permissions/interruption, backgrounding and recovery cases in the readiness matrix.
- Full device-backup restore and operational recovery/rollback drills. Download and payload inspection alone are not restore proof.
- Scheduled cleanup invocation receipt and separate owner acceptance.
- Payment activation/test acceptance and representative staging scale/SLO/cost evidence remain separate.

## Android partial acceptance and backup repair

After PR #42 deployed at main `08a46630323d1fc017f02099ba3bb172e98471bd`, independent Google exports found exactly one Android QA note in Account B and none in Account A. The owner's entered text, `Android QA -001 - clearance 6 7/16 inches.`, matched its stored source text. The owner reported that reopening the installed Android app showed Connect Google; persistent restoration remains unresolved pending device diagnostics and a repeat test.

The owner also reported `Unrecognized backup draft` from Download device backup. A component regression reproduced that exact error by entering a Fieldnotes draft with no project selected: the app retains a valid note under a key ending in `note:`, while backup validation previously required a nonempty project ID. Backup validation now accepts this specific known note key, preserves its exact content, and restores it without assigning it to a project. Invalid note content and other unknown or malformed draft keys still fail validation. This source reproduction does not establish which draft caused the owner's phone failure.

Classification: frontend backup validation and tests only, with acceptance documentation. No Lovable action is required. Owner-approved merge, the existing Cloudflare Pages frontend deployment, and a repeated phone backup download/restore check remain separate gates. No backend function, migration, secret, OAuth configuration or storage reset is required. Download support details under Help & privacy is independent of device-backup validation and remains the next diagnostic action for the reopen failure.

The owner subsequently confirmed both downloads worked after PR #43 merged and production revision `242f2e715ae64a7fd2050bb2b9430d6bb003ff98` passed release/health/session/config checks. This establishes phone download success, not a phone restore or successful persistent sign-in. The owner reported inadequate visual download feedback.

## Download feedback and visual refresh

Both Connections downloads now show preparation, a disabled button while working, and an adjacent, announced success panel with the filename and Downloads/file-manager guidance. The panel scrolls into view above mobile navigation. It reports that the browser download started; the app cannot verify the operating system's final save. Failures show an alert and no success panel, retaining existing drafts. Support details also report theme and standalone/browser display mode without project text, Google file IDs or credentials.

Light/Dark controls follow the device preference initially and persist an explicit choice on that device. A storage failure still changes the current view and explains that it could not be remembered. Shared semantic colours cover cards, inputs, status, errors and controls; printing retains a light palette. Icon-led cards identify Connections, field-note capture/saved notes, measurements, project records, project-editor sections, visit preparation/checklists and Ask.

Source validation: 253 tests passed, followed by 26 focused checks after the final heading adjustments; production/extension builds passed. Local browser QA used synthetic connection/payment fixtures, not provider requests: desktop 1400×1100, phones 390×844 and 320×844; both themes, reload persistence, both download notices, and exact unsaved-note preservation through theme changes passed. There was no horizontal overflow or relevant console error. These checks do not establish physical-phone acceptance of this new visual release.

Classification: frontend presentation, device theme preference, download feedback and diagnostic metadata only. No Lovable action is required. After owner-approved merge, deploy through the existing Cloudflare Pages main pipeline, verify the release SHA, update the installed app, and confirm both download notices and theme/card usability on Android. The prior reopen/sign-in diagnosis remains open pending the device's support details. No backend deployment, migration, secret, OAuth setting, purchase activation or paid provider change is required.

## Refresh-status repair and release

During a failed refresh, the previous success label remained visible beside the error. The frontend now shows refresh progress, replaces that label with `Google refresh failed · records were not updated` on failure, and restores success only after verified readback. Previously loaded records and recoverable drafts are retained. A regression exercises failure, record preservation and successful retry.

Classification: frontend state wording, regression test and readiness documentation only. No Lovable action is required. After owner-approved PR merge, deploy the frontend through the existing Cloudflare Pages main pipeline and verify the failed-refresh and retry labels live. No function/Worker deployment, migration, secret, OAuth change, paid service or payment activation is required by this diff. Live deployment and owner QA remain separate from source verification.

Source validation: 247 tests passed, production/extension builds and Pages Functions compilation passed, synthetic capacity verification passed without provider calls, and the all-dependency audit reported zero vulnerabilities. The existing shared quote-budget test now fixes its clock so crossing a wall-clock minute cannot reset its synthetic bucket during the assertion.
