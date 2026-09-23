# Google setup and release

## Owner setup (required before connected PWA testing)

1. In your Google Cloud project, enable Google Sheets API, Google Drive API and Google Picker API.
2. Configure Google Auth Platform branding/audience/consent for StreamLion. Supply your support contact and appropriate privacy information. During testing, add pilot Google accounts as test users. Production availability/verification must be checked before selling access.
3. Create an OAuth **Web application** client. Authorized JavaScript origins: `https://streamlion.transcendencemedia.com` and, for local QA, `http://127.0.0.1:4174`. Add an exact stable preview origin only when needed. Do not use wildcard production origins. This implementation uses the Google Identity Services browser token model: no redirect callback, client secret, refresh-token vault or backend deployment is involved.
4. For selecting workbooks created by ChatGPT or other apps, create a **restricted public API key** for Google Picker, restrict it to the authorized website referrers and Google Picker API, and note the numeric Google Cloud project number. Never put a secret key here. Ensure the key and OAuth client are in the same Cloud project.
5. In Cloudflare Pages → streamlion → Settings → Variables and Secrets, configure the **public build variables** `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_PICKER_API_KEY`, and `VITE_GOOGLE_PROJECT_NUMBER` using the values above, then rebuild. They are intentionally exposed to the browser; never substitute a client secret or access token. This configures the app once so providers only need to connect their own Google accounts. For local testing copy `.env.example` to `.env.local`. The public client ID alone permits creating a workbook; selecting an existing workbook additionally requires Picker. The provider-facing Connections page does not accept Google application credentials.
6. Connect Google and Create workbook (or Choose workbook for an existing compatible template). Read back the two exact tab headers. Grant only the requested selected-file scope `https://www.googleapis.com/auth/drive.file`. Do not widen to all Drive for convenience.
7. Connect Google separately in ChatGPT; install the updated StreamLion plugin. Supply the exact workbook URL. A plugin skill does not itself attach or authorize the user's Google integration.

Tokens stay in memory and expire. Reconnect explicitly when needed. User denial, network failure and revoked access must preserve drafts and must not produce a success confirmation.

## Owner acceptance

Use fixtures/project-intake.json and a synthetic source brief first. In ChatGPT, create a draft in the selected workbook, then choose/refresh that workbook in the PWA. Verify every field, original ID, blank end appointment, separate paid amount and source notes. Edit one value in the PWA, retrieve it from ChatGPT, append a room-specific annotation, then refresh the PWA. Simulate a retry and confirm there is only one logical revision. Test account switching, deny access, reconnect and direct Sheet edits. On actual iPhone/Android verify voice tool calls, project/area assignment, fractional values, corrections and spoken save receipt.

## Release classification

Frontend source + plugin instructions + owner-managed Google provider setup. No StreamLion-hosted backend, migrations, database tables, server functions, secret values, paid model calls or DNS changes. Existing Cloudflare Pages publishes after approved PR merge. Google setup and owner-QA remain separate from a successful build.

Google provider configuration is an owner action; Lovable has no access to this Cloudflare/Google deployment. If using the project's mandatory handoff protocol, the constrained prompt below serves only as a review/receipt checklist. It does not authorize a Lovable backend or a new paid service.

## PASTE INTO LOVABLE

HOLD — PASTE ONLY AFTER PR MERGE. Sync/read the current merged Socialeap/StreamLion main and report its full SHA. Use committed docs/google-setup.md, docs/google-owned-plan.md, src/google.js and plugin/plugin.json as the complete scope.

Preflight: verify no server functions or migrations are included and that Google access is the browser token model with drive.file. If those markers differ or configuration is partially present/inconsistent, stop and report. Do not invent or run migrations, deploy functions, provision a database, alter code, publish a frontend, change DNS, create secrets, modify providers or make paid calls. There are no migration/function/secret names to activate for this increment. Model/provider spend ceiling is $0.

Owner performs Google Cloud setup in docs/google-setup.md: enable the named APIs, configure the OAuth web client and exact origins, and provide restricted public Picker configuration. Owner sets Cloudflare Pages public build variables VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_PICKER_API_KEY, VITE_GOOGLE_PROJECT_NUMBER and rebuilds after merge. Check existing settings before adding anything; do not create duplicate clients or keys. If unavailable, report pending owner setup. Do not ask for secret values.

Return a concise receipt: merged main SHA; migrations not applicable; server functions not applicable; backend security/RLS not applicable; Google setup complete/pending from owner evidence; and one safe static page health check. Do not read real project records or run real AI calls for the check. Owner must share the receipt before activation is declared complete. Frontend publication is through the existing Cloudflare Pages Git integration after merge. Real-device owner QA is separate.
