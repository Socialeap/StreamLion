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

## Refresh-status repair and release

During a failed refresh, the previous success label remained visible beside the error. The frontend now shows refresh progress, replaces that label with `Google refresh failed · records were not updated` on failure, and restores success only after verified readback. Previously loaded records and recoverable drafts are retained. A regression exercises failure, record preservation and successful retry.

Classification: frontend state wording, regression test and readiness documentation only. No Lovable action is required. After owner-approved PR merge, deploy the frontend through the existing Cloudflare Pages main pipeline and verify the failed-refresh and retry labels live. No function/Worker deployment, migration, secret, OAuth change, paid service or payment activation is required by this diff. Live deployment and owner QA remain separate from source verification.

Source validation: 247 tests passed, production/extension builds and Pages Functions compilation passed, synthetic capacity verification passed without provider calls, and the all-dependency audit reported zero vulnerabilities. The existing shared quote-budget test now fixes its clock so crossing a wall-clock minute cannot reset its synthetic bucket during the assertion.
