# Core job workflow — 2026-10-03

## Delivered in the one-time purchase

### Brief → reviewed tasks

Open a saved project → **Prepare → Build from project details**, or expand **Paste or choose a brief**. A readable PDF or text file is read locally. Review editable suggestions beside the exact source passage, choose the tasks to include, then **Add reviewed tasks to checklist → Save checklist**.

- Explicit requests produce separate capture spaces and tape-reading requirements. Conditional/unclear wording stays a review request, never an inferred positive capture instruction. Exclusions remain visible for the source review.
- Each task keeps its source passage, source field/file name, and PDF page when available. Importing a file does not upload the original file; saved passages use the existing Google checklist record.
- Suggestions never automatically become completed work. Identical additions preserve prior status/evidence. A matching task with changed source wording is rejected for explicit review.
- Corrections and source-review drafts survive navigation and are included in the existing device backup. Before leaving shows unfinished brief reviews.
- PDF limits: 5 MB, 20 readable pages, 6,000 characters per review; 40 requirements per checklist. Protected, image-only, mixed unreadable, or oversize files produce a clear fallback to pasting relevant wording. There is no OCR or hosted AI. No content is silently truncated into a partial checklist.
- Tape task labels match the existing Measurements input: Length, Width, Height, Ceiling, Depth, Segment, Diagonal. Other requests remain manually reviewed work; no unsupported geometry is invented.

### On-site exceptions and actual reading checks

**On site → Record a site exception** keeps the area, condition/request, information source, and next action together. Check the wording and save once. Linking to a task also links the durable field-record ID. Access problems block the selected task; changed requests and follow-ups add pending work. Changed requests do not alter the agreed scope automatically.

The exception operation ID is saved in the checklist draft before the local journal write. A retry reuses it, including after reopening the project. Different wording/project ownership on an existing ID fails visibly. The app update/navigation gate stays locked while saving. Field notes/photos/voice memos retain the existing device journal and Google outbox.

Checked tape tasks still require a reviewed structured reading for the same project, space and dimension. Ambiguous spaces/floors, damaged payloads, unreviewed readings, pending Google writes and unavailable linked evidence remain departure warnings. Exact units and fractions are preserved. This verifies the record's organization/review, not a physical tape reading or scan alignment.

Delivery tasks belong in **Delivery**, not the pre-departure checklist. Recorded next actions on every blocked item satisfy the follow-up requirement after the provider explicitly acknowledges them; missing readings or unexplained omissions still need recorded follow-up.

### Professional handover

**Delivery → Preview job handover** shows provider branding from the project's capture-provider name, job/site/visit, source-linked tasks, states and exceptions, exact room readings, field evidence, delivery links and recorded acceptance.

- **Print / save PDF** uses the browser's print dialog. **Download shareable report** produces a self-contained HTML report; the existing text summary remains available.
- Payment fields and unchecked field-record details are omitted by default. The preview provides explicit controls to include them. Source passages and notes retain their wording, including any amounts stated there; review the preview before sharing. Outstanding work and omitted unchecked records remain visible as warnings.
- Photo previews can be loaded from this device or, when connected, explicitly from Google. Up to 10 field files are checked, sequentially, to bound memory/network work; original file links remain. Preview resizing never modifies the original. Check the preview for missing/unavailable photos before sharing.
- The report states whether it uses a device record, saved workbook copy, live Google record or unsaved checklist edits. Recorded customer acceptance is a provider entry, not a customer-authenticated signature.
- User text is escaped, links accept only HTTP(S) without embedded credentials, and photo data accepts only raster images. Downloaded reports allow no scripts or network subresources.

## Release classification

Frontend/browser code, a lazy PDF reader dependency, and optional fields inside the existing version-1 Observations checklist payload. Existing Projects/Observations headers, server routes, Google scopes, Cloudflare secrets and database schemas are unchanged. **No Lovable action is required.** No paid AI, new hosting service, agency subscription, dispatch, or shared client portal is activated.

After PR review and merge, Cloudflare Pages must build the merged `main`. Confirm the production revision, load the new PWA update, and perform owner acceptance below. A source/build receipt does not prove live Google or a physical Android flow.

## Required owner acceptance after deployment

Use a synthetic job and personal Android device:

1. Import a readable brief, correct a suggestion, leave/reopen the project, then add/save tasks. Reconnect Google and confirm the saved source passages and the same checklist ID in Sheets.
2. Record two spaces with similar names/floors, including an exact fractional tape reading. Confirm a task cannot appear fully checked using the wrong space or an unreviewed reading. Attach the correct record and verify the departure result.
3. Keep the workbook copy, go offline, capture an exception and photo, close/reopen the installed app, then reconnect/send. Verify one logical record/file, preserved wording and the correct workbook/folder destination.
4. Download a device backup while both a brief review and exception draft are unfinished. Restore in an isolated browser and confirm their wording and reserved exception ID remain intact.
5. Preview the report, add available photos, confirm fees and unchecked records are handled as intended, save/share a PDF from Android, and open the HTML report on another device. Verify no pending or missing evidence is presented as completed work.

## Deferred Agency plan

Team dispatch, permissions, supervisor review, hosted client approval, scheduled processing and managed retention require separate validated demand, account/tenant design and recurring-cost pricing. They are not prerequisites for these Core improvements or included as hidden ongoing services.

## Local validation receipt

- Full test suite: **193 passed, 0 failed**. Includes source exclusions/conditions, exact readings, same-name spaces with different floors and dimensions, interrupted exception retry, stale checklist safety, and backup round-trip of unfinished reviews and reserved save IDs.
- Production build and PWA generation passed. The PDF reader and handover load on demand; the same-origin PDF worker is included in the offline cache. Production dependency audit: **0 vulnerabilities**.
- Chromium UI with synthetic records: project-derived tasks, actual readable PDF import with page references, navigation/resume, exception creation, reviewed fractional measurement, task matching, departure acknowledgement, local photo review and portable HTML download passed.
- Handover preview checked at 1440 px and 390 px. No horizontal overflow at phone width; native dialog keeps focus inside and returns it to the opener on Escape. A three-page A4 print export preserved readings and the photo and omitted app controls/payment fields. Rendered print pages were visually inspected.
- Google read/write, deployed PWA revision, physical Android dictation/camera/share and offline reconnection remain owner acceptance gates; the local checks do not claim live or device proof.
