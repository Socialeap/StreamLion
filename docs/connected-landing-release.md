# Connected landing demo

## Scope

Frontend only: `api/welcome.html`, landing CSS/JS, and an in-memory synthetic job adapter. The page reuses the shipped brief-task parser, workflow validation/evidence checks, measurement parser, exception model and handover renderer. Report code loads on demand. No customer project data, Google account, server route, schema, secret, payment setting or paid AI service is changed. No Lovable action is required.

## Visitor experience

- Approved headline: “See all that’s required. Show all that was done.” Bold audience line: “All-in-One Dashboard for spatial capture providers on the go.”
- Stable three-view hero: brief → tasks, field records, client handover.
- One Harbor House sample carries reviewed brief tasks, exact fractional room readings, and access exceptions into a provider-branded handover.
- Suggested tasks show original passages. Editing is secondary; changes require a new review. Rebuilding replaces sample requirements, retaining recorded room readings. A pre-reviewed default lets visitors explore stages in any order.
- A checked measurement task still warns until a matching reviewed reading exists. Ambiguous input cannot be checked or kept. Exceptions remain visible with their next action.
- Actual report preview in a dialog, print / save PDF entry, optional local photo (up to 5 MB, thumbnail resized to 900 px), provider name, and explicit payment/unchecked-record inclusion controls. Photos stay in browser memory and are not uploaded.
- Voice answers follow the same sample project. The value calculator uses editable example timings for brief preparation, field organization and client handover. These are planning assumptions, not measured savings.
- Included features and FAQ reflect readable PDF briefs, report controls, field evidence, recovery and Google ownership. Standard-price fallback remains until a valid live quote confirms a launch reservation.

## Source QA

29 scoped tests passed: connected demo, landing pricing/value, original demo calculations, task extraction, and report privacy. Production Vite build passed. Browser plugin was not available; isolated Chromium used the Playwright CLI at `http://127.0.0.1:5184/api/welcome.html`, desktop 1440 × 1000 and phone 390 × 844. Page identity, nonblank render, no framework overlay, no relevant console warnings/errors, and target interactions checked.

Browser interactions: explicit brief-review gate; checked-task warning without a matching tape reading; exact 12′ 4 1/2″ preserved; reviewed readings clear only matching requirements; locked-room next action reaches the report; provider name and local photo inclusion; payment omitted by default and shown on opt-in; unchanged hero geometry across all views (desktop 672 × 522.765625, phone 350 × 543.265625); no horizontal phone overflow; malformed input keeps review/save disabled. Print entry invokes the printable report; physical printer/PDF-save dialogs remain owner QA.

Screenshots and logs are temporary QA artifacts, outside the source tree.

## Release gates

After PR merge, deploy the approved merged frontend through the existing Cloudflare Pages build. No backend migration, secret change or provider setup is required by this diff. Verify `/api/welcome` on the deployed revision, try the three stages and report preview, then verify print / PDF saving and optional local-photo selection on a physical Android device. Source/browser QA does not establish a production deployment or device acceptance.
