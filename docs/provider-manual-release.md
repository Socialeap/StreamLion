# Provider manual and coordinated-page theme

Client requests and the client-facing coordination pages now use the same light/dark tokens and saved/system preference as Core. Forms, work-order progress, warnings, reference details and payment panels all follow that preference. The existing appearance control is available in the coordination header.

The book button in the Core and provider Client requests headers opens a provider manual over the current page, including from Ask. It preserves the current editor and restores keyboard focus when closed. The guide contains seven chronological stages and 18 nested steps, with icons, practical instructions, benefits, limitations and six labelled examples:

1. Set up your workspace.
2. Receive the request.
3. Clarify and agree the work.
4. Prepare for the visit.
5. Capture and record on site.
6. Check before leaving.
7. Deliver and follow up.

Native disclosures support browsing, Expand all and Collapse all. Start walkthrough and Next move to the appropriate stage. The modal uses the browser's focus containment, Escape handling and background inertness. Opening the manual does not read job data, write records, send invitations or request AI. Guidance lives in `src/provider-manual.js`; update its labels and instructions when the corresponding provider controls change.

Content is grounded in `CoordinationPortal`, `ProjectEditor`, `ProjectHome`, `BriefTaskBuilder`, `Notes`, `MeasurementCapture`, `FocusedAsk` and the existing provider-workflow and intake-template documentation. It distinguishes optional coordination from direct Core entry, draft from verified Google save, estimates from agreement, saved-detail lookup from AI, and delivery from acceptance/payment. It does not claim that StreamLion scans a space, validates scan coverage, sends a downloaded report or collects the customer's fee.

## Validation

- All 521 automated tests passed, including new disclosure/navigation, no-request, focus/scroll restoration and unfinished-editor continuity checks.
- Production app/PWA and self-contained extension builds passed.
- Installed Chrome with the existing synthetic preview: desktop 1440 × 1000, mobile 390 × 844 and narrow mobile 320 × 844. Checked dark tokens, light preference after reload, work-order rendering, stage/substep controls, start/next/expand/collapse, Escape/focus return, Core editor continuity and guide access from Ask. No horizontal overflow or browser errors. No real Google, email, payment or AI calls.
- The session's dedicated Browser runtime was unavailable; browser validation used the already-installed Playwright and Chrome, with temporary evidence outside the repository.

## Release gates

Frontend-only changes. No database migration, server function change, backend activation, secret, provider setting, authorization scope or paid service is required. No Lovable action is required.

Owner approval and current-head CI precede merge. Release the merged revision through the existing Cloudflare Pages frontend path and check its revision receipt. Existing PWA installations should apply Update StreamLion after saving their edits. Owner QA on the actual installed phone and desktop remains separate: open Client requests from Core, check the same dark preference, open the manual from both headers, expand a stage and substep, then close it and confirm the unfinished form remains intact. No merge, production deployment or physical-device acceptance is claimed by this PR.
