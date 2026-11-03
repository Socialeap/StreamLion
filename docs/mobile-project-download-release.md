# Mobile project details download

Owner TO-DOs

1. Check Android Files → Downloads for a recent `streamlion-project.json` from the original tap. The report establishes missing feedback; this device check distinguishes a silent download from a blocked file handoff.
2. Review the focused PR before merge. Keep `[CF-Pages-Skip]`; no automatic Production deployment.
3. After merge, Codex deploys matching frontend assets while preserving checkout/pilot/metered holds. Retest step nine in the installed Android Chrome PWA: confirm the requested filename/status, locate and open the JSON file, and try the explicit save link/copy fallback if Android does not accept the automatic download. Saving/retrieving the project must still work.

## Findings and change

The reported device is Android Chrome, installed as a PWA; the project saved successfully. The old project export handler did not display any success/request feedback. Validation/download exceptions were placed near the top of the editor, away from the Finish button. Those are confirmed code defects. The generic helper clicked a detached anchor; it now temporarily attaches the anchor and removes it even if activation throws. Detached-anchor behavior is not asserted to be the confirmed Android-specific cause.

The Finish action now displays **download requested**, the filename, an explicit native download link to the prepared local Blob, and a copyable JSON fallback. It does not claim the browser saved the file. Errors appear beside the action. Prepared files remain available while displayed and are invalidated when fields change; URLs are released after replacement/unmount with a short grace period for browser handoff. Existing field validation and import format are preserved. Copying the export is an explicit user action; no project data is sent to another service.

The existing DownloadNotice component is reused; other download notices keep their existing wording. The shared helper cleanup is hardened for other current callers. No storage schema, authentication/access grant, server route, paid operation or customer record is changed by this diff.

## Verification

- `npm test`: 1,228 passed, zero failures/skips.
- `npm run build`: passed.
- Focused editor/download tests cover connected anchor activation, filename, valid JSON fallback, failure feedback beside Finish, retained edits, invalid-field rejection, and removal of stale prepared links after editing. Existing backup/support download tests pass.
- Isolated real Chrome at 390×844 displayed the requested status, filename, native file link and valid synthetic JSON copy. The browser download-event probe timed out for automatic and direct links; no file-completion proof is claimed. Browser policy blocked Chrome's internal Downloads page. No physical Android PWA test was performed by Codex. Local fixture files were removed.

## Release and rollback

Frontend-only change. After reviewed merge, deploy the exact merged frontend through Cloudflare `streamlion`, preserve existing Functions/configuration, and verify the served SHA plus installed-PWA update. Keep checkout paused and pilot/metered operations disabled. An already-open PWA may need its normal update/reopen to load the new bundle. Rollback the frontend to the prior reviewed artifact; preserve customer records and all payment/refund processing.

Backend Activation Required: NO — this diff needs no migration, server-function change, secret or provider setting. Frontend deployment and Android owner QA remain separate gates.

No Lovable action is required.
