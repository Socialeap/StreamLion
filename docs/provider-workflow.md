# Provider workflow increment

## Customer path

1. Create from a brief, the basic details, or explicitly approved client defaults. A named draft is resumable. Save stays in the editor.
2. Open the project home: **Prepare → On site → Before leaving → Delivery**. Directions, phone contacts, access, scope, exclusions, and requested outputs stay with the project.
3. Convert the customer's requested outputs into a working checklist. Add requirements and site areas; explicitly check, block, or exclude each item. Exceptions require explanations. Link individual field records as evidence.
4. Type or dictate using the phone keyboard, record a short voice memo, or add a field photo. Listen/review originals in the PWA. A Google project first journals the record and file atomically on the device, then sends automatically if authorized. Failed requests leave a visible waiting list with explicit retry.
5. Before leaving, inspect unchecked/blocked items, changed briefs, unreviewed/pending records, and unavailable evidence. Capture completion is the provider's recorded decision, never an automatic scan-quality certification.
6. Download a delivery summary, record delivery and acceptance independently, and view agreed/invoiced/received/outstanding amounts. Unknown received amounts do not mean zero. Payment fields remain summaries, not an accounting ledger.
7. Reuse approved client work defaults or start a repeat visit. Repeat drafts copy site/contact/access context; customer references, appointments and transaction amounts are cleared. Review against the new instructions before saving.
8. Ask shows common facts without an LLM request. Deeper discussion opens ordinary ChatGPT and explicitly copies a dated selected-project snapshot. The user pastes it once. Desktop requests a proportionate browser window; mobile uses a new tab. Browser policy controls the final window behavior. Clipboard failure offers a file backup. The URL contains instructions, not customer project data. ChatGPT does not receive live Google authorization or automatically submit a message.

## Compatible storage

Projects and Observations keep the existing exact headers. No schema migration, server function, secret, provider setting, scope expansion, paid LLM, or hosted customer database is introduced.

- One Observations record per project with area `StreamLion project checklist`, text containing `kind: streamlion.workflow`, `version: 1`. It stores requirement IDs/labels/areas/status/reasons/evidence record IDs, visit and delivery state, delivery/acceptance recording timestamps, brief signature, approved template name and site lessons. Existing revision conflict/readback rules apply. The metadata row is omitted from ordinary field-record counts and ChatGPT's field-note list. Unsupported or duplicate metadata fails visibly; no arbitrary record is selected. Checklist drafts are kept by workbook/project until confirmed. Checklist limit: 40 items, 11,500 serialized characters; oversize saves fail without truncating.
- An explicitly requested workbook site copy uses an additional key in the existing IndexedDB workspace store. It contains validated record heads and a verified timestamp, no token or unrelated response data. It is read-only after authorization expires. It is not a backup of arbitrary Drive attachments. Opting out removes the workbook copy; waiting records and originals are retained for recovery. Browser storage is unencrypted and can be cleared/evicted. Use a personal device and download important originals.
- New Google field records carry `pendingBookId` and stable record IDs in the local journal, partitioned by workbook. Switching workbooks does not send them elsewhere. The existing media store accepts audio and photos with the journal in one transaction. They are never acknowledged before verified Sheets readback. Pending uncertain writes must be verified before editing their record. Originals remain available locally after upload; export of the workspace JSON does not bundle them.
- Google Drive uploads use the already-enabled Drive API and `drive.file` authorization. Files remain private under the user's Google account, in My Drive; the app does not assume permission to an arbitrary project folder. A generated Drive ID is persisted before upload. The file is verified by note ID, workbook ID, size and SHA-256 before saving its URL to the existing `audioUrl` column (also used for photos). An unknown upload outcome is retried with the same ID and verified content. Files are capped at 5 MB; voice memos retain the existing 60-second cap. This is a field-evidence feature, not scan/raw-capture storage. See [Google multipart uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads#multipart) and [generated IDs](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds).
- Save destination safeguards still prevent a remembered or cached Google workbook from silently receiving a device-only project save. Connect and verify Google first. Draft edits can remain on the device until then. Existing arbitrary Sheet edits still have no transactional compare-and-swap; use one active editor per project.

## Release classification

Frontend and browser-side workflow changes only. Existing Cloudflare `/api/google-config` and `/mcp` handlers, Wrangler configuration, Google scope, and headers are unchanged. No Lovable action is required. The optional private plugin stays an experimental compatibility path; it does not need republishing for this release.

After owner PR approval/merge, Cloudflare Pages builds the merged main branch. Verify the deployed revision and a fresh browser/PWA load. Do not treat a successful build or redeployment as proof of Google, offline, or microphone acceptance.

## Implementation validation (2026-09-30)

- 55 automated tests: draft/editor continuity, checklist exceptions and retry recovery, exact source text, payment arithmetic, workbook-partitioned offline records, media identity reuse after interrupted uploads, Google revision readback, and existing recorder permission/recovery cases.
- Production Vite/PWA build and clean diff checks.
- Local Chrome at desktop and phone widths: imported synthetic brief, saved without leaving the editor, resumed the named project, jumped directly to Finish and Start, opened the project home, checked an item, preserved a fraction in a field note, reviewed departure gaps, downloaded the handover, and displayed the local payment answer.
- Clipboard/popup handoff contained the actual selected project and exact measurement. The ChatGPT page request was intercepted locally for this check; no account session or message was submitted. Authenticated ChatGPT behavior, live Drive/Sheets writes, and physical microphone/camera/offline installation remain owner acceptance checks below.

## Owner acceptance before selling this increment

Use synthetic records first:

- Import a ChatGPT project file, save a draft, continue editing, reopen, verify exact source facts and the same record ID in Google.
- Prepare a requirement with an area, attach a note/photo/voice memo, and mark an exception with its reason. Reopen from another device and confirm checklist state and Drive-file access. Inspect the labelled metadata row without changing Sheet headers or IDs.
- Deny microphone access, record on physical iPhone/Android, background during recording, listen and correct wording. Verify originals and exact fractions; no automatic transcription is promised.
- Keep a site copy, switch offline, reload the installed PWA, record a note and file, restore connectivity, reconnect the same Google account and send the queue. Interrupt upload/Sheet acknowledgment and confirm one logical file/observation, no lost original. Switch workbooks and accounts and verify destination/access checks.
- Edit the brief and confirm its checklist needs review. Resolve before-leaving issues, download handover, record delivery/acceptance separately, and verify unknown payment amounts remain unknown. Reuse client defaults and a repeat visit without old dates, references or payments.
- Test Ask on desktop and mobile with ordinary ChatGPT: quick facts need no external chat; snapshot clipboard/paste or file attachment works; brief extraction returns a compatible project file. Test missing account access/clipboard and browser popup fallback separately. The private plugin is never required.

## Remaining commercial launch gates

This increment is not a claim of production/scaling completion. Before taking payments: public Google OAuth/privacy/consent readiness; reliable purchase receipt, license/entitlement delivery and restore/support/refund path; accessibility and physical-device acceptance; local-storage eviction/export recovery; concurrent-edit conflict recovery; operational support/diagnostics; and large-workbook performance/quota testing. The current 10,000 grid-row-per-tab history cap remains. Increasing rows or introducing an index requires a separate measured design; no semantic index service has been provisioned. Calendar automation, scan-platform integration, geometry validation, full restore packages and accounting are outside this increment.

One-time purchase remains the business model. There are no owner-funded AI requests in this path; customers use their own ChatGPT access. Public ChatGPT app registration and any future plan-authenticated API are optional future work, not prerequisites or assumed entitlements.
