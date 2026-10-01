# Central StreamLion folder: release and acceptance

## Scope

This change adds one `folder_id` selection to the encrypted-session database's metadata, a folder selection endpoint in the existing Google Pages Function, narrowly validated Drive folder creation / parent-only moves, and frontend controls. Project content stays in Google; folder IDs are metadata, not project data. No Lovable action is required. No new secrets, providers, OAuth scopes, paid services, public routes, or cleanup-Worker deployments are required.

## Activation — stage schema before automatic deployment

1. With the approved folder implementation committed, stage the additive migration from that exact PR commit before merging if automatic production deployment is enabled. Record its full SHA. Keep production and preview bindings isolated. Deploy frontend and Functions only after approved merge.
2. Before deploying that release, inspect **both** markers in production database `streamlion-google-sessions` (`f9945b40-00ca-4662-9113-585927e31ec0`):

```sql
PRAGMA table_info(streamlion_google_sessions_v1);
SELECT name, sql FROM sqlite_master WHERE name = 'streamlion_google_folder_schema_v1';
```

If `folder_id` and `streamlion_google_folder_schema_v1` are both absent, apply committed `migrations/0003_google_workspace_folder.sql` byte-for-byte in one transaction. If only one is present, stop: do not generate or substitute SQL. If both are present, verify the column is `TEXT NOT NULL DEFAULT ''`, the marker table matches the migration, and `SELECT version FROM streamlion_google_folder_schema_v1` returns exactly `1`; skip only on a match. Preserve active sessions, workbooks, files and the encryption key. Never print credential columns.

3. Deploy only Pages project `streamlion` from that same approved main, including frontend and existing Pages Functions. Apply migration before production deployment; do not merge with automatic deployment enabled until the schema is staged. Do not enable this code against the old schema. The additive column is compatible with the previously deployed code's explicit-column inserts, so a staged migration does not require disconnecting users.
4. Record main SHA, migration result/marker, Pages deployment ID and the unauthenticated `scripts/verify-release.mjs` receipt. Production folder functionality requires the authenticated acceptance below; build and unauthenticated health alone are insufficient.

## User workflow

- Connect Google once; returning users continue with their selected workbook.
- In Connections, set up the StreamLion folder once, or select an existing folder. Creating a new workbook sets it up automatically.
- Keep one default workbook for many projects. New workbooks go in the selected folder. Existing workbook moves are optional, explicit and inherit the destination folder's sharing.
- Saved Google projects expose **Open project folder**. New field photos and voice memos are retained under `StreamLion / Project files / <project name and record ID>`; workbook and record IDs disambiguate jobs. Old attachments remain where they were.
- Reopen the same browser/PWA: the folder and workbook restore from the account's saved session. Other accounts cannot inherit that selection. Disconnect removes the remembered server selection on that device; it does not delete Google files.
- Choose each existing workbook through Picker even if it is in the central folder. Folder selection is not consent to every child file. No broad Drive scope or hidden ChatGPT connection is added.

## Acceptance

Use synthetic records, not an existing customer's evidence.

1. Set up a folder; create a workbook. Verify the actual workbook is inside it and has both Projects and Observations headers.
2. Create two projects with the same name, plus a repeat visit. Add a small photo/recording to each. Verify separate folders and correct links in the workbook.
3. Reload / close and reopen: same workbook, same folder, no repeated setup or consent within a valid session. Verify access-token renewal separately.
4. Select an existing writable folder with Picker. Verify selection persistence; explicitly move a synthetic workbook and inspect its parent in Drive. Cancel selection and move confirmation; neither should change the destination.
5. Revoke folder access or trash the synthetic folder. A new file operation must show recovery guidance and keep the original on the device; it must not silently create a replacement folder. Select a writable replacement explicitly.
6. Switch accounts and test a stale tab; prior-account folder/workbook selections must not transfer. Disconnect stops restore. Folder requests share the existing request quotas.
7. Physical iPhone/Android: folder Picker, popup fallback link, microphone/photo, reopen and queued-file retry. Desktop viewport simulation does not prove physical permission behavior.

Folder creation reconciles a failed acknowledgement using a reserved Drive ID, and same-browser calls share a lock. Google does not enforce uniqueness of application properties across different devices; simultaneous first-time setup on separate devices can create duplicate marked folders. Search detects ambiguity and stops rather than guessing or mixing evidence. Initial release uses one active editor per project; cross-device provisioning is not claimed as transactional. Changing folders does not consolidate previous project folders.

Source tests and synthetic browser QA cover routing, account isolation, restoration, reserved-ID retry and narrow mutation validation. Live Google acceptance remains a separate launch gate.

Rollback: deploy the previous approved Pages revision while leaving the additive column and marker intact. Do not rotate credentials or delete Google records as rollback steps.
