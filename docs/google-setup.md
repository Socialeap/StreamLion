# Google setup and release

## Owner setup (required before connected PWA testing)

1. In your Google Cloud project, enable Google Sheets API, Google Drive API and Google Picker API.
2. Configure Google Auth Platform Branding, Audience and Data access for StreamLion. Choose External for providers outside your own Google Workspace, keep the app in Testing for the pilot, add each pilot Google account as a test user, and declare only `https://www.googleapis.com/auth/drive.file`. Supply your support contact and appropriate privacy information. Testing authorizations expire after seven days; production availability and branding verification must be checked before selling access.
3. Create an OAuth **Web application** client. Authorized JavaScript origins: `https://streamlion.transcendencemedia.com` and, for local QA, `http://127.0.0.1:4174`. Add an exact stable preview origin only when needed. Do not use wildcard production origins. This implementation uses the Google Identity Services browser token model: no redirect callback, client secret, refresh-token vault or backend deployment is involved.
4. For selecting workbooks created by ChatGPT or other apps, create a **restricted public API key** for Google Picker. Under Website restrictions allow `https://streamlion.transcendencemedia.com/*` and `https://docs.google.com/*` (Picker's iframe); add `http://127.0.0.1:4174/*` only for local QA. Under API restrictions select Google Picker API. Note the numeric Google Cloud project number from IAM & Admin → Settings. The API key, OAuth client and project number must belong to the same Cloud project. Never put a client secret here.
5. In Cloudflare Pages → streamlion → Settings → Variables and Secrets, configure the **public build variables** `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_PICKER_API_KEY`, and `VITE_GOOGLE_PROJECT_NUMBER` using the values above, then rebuild. They are intentionally exposed to the browser; never substitute a client secret or access token. This configures the app once so providers only need to connect their own Google accounts. For local testing copy `.env.example` to `.env.local`, or use StreamLion → Connections → Google application setup to save device-specific overrides. The public client ID alone permits creating a workbook; selecting an existing workbook additionally requires Picker.
6. Connect Google and Create workbook (or Choose workbook for an existing compatible template). Read back the two exact tab headers. Grant only the requested selected-file scope `https://www.googleapis.com/auth/drive.file`. Do not widen to all Drive for convenience.
7. Connect Google separately in ChatGPT; install the updated StreamLion plugin. Supply the exact workbook URL. A plugin skill does not itself attach or authorize the user's Google integration.

Tokens stay in memory and expire. Reconnect explicitly when needed. User denial, network failure and revoked access must preserve drafts and must not produce a success confirmation.

Current setup references: [Google Auth Platform audience](https://support.google.com/cloud/answer/15549945), [Google Picker web setup](https://developers.google.com/workspace/drive/picker/guides/web-picker), and [Cloudflare Pages build variables](https://developers.cloudflare.com/pages/configuration/build-configuration/#environment-variables).

## Owner acceptance

Use fixtures/project-intake.json and a synthetic source brief first. In ChatGPT, create a draft in the selected workbook, then choose/refresh that workbook in the PWA. Verify every field, original ID, blank end appointment, separate paid amount and source notes. Edit one value in the PWA, retrieve it from ChatGPT, append a room-specific annotation, then refresh the PWA. Simulate a retry and confirm there is only one logical revision. Test account switching, deny access, reconnect and direct Sheet edits. On actual iPhone/Android verify voice tool calls, project/area assignment, fractional values, corrections and spoken save receipt.

## Release ownership

The owner configures Google Cloud and the public Cloudflare Pages build variables above. Cloudflare Pages builds and publishes the merged GitHub `main` branch. Then the owner performs the Google roundtrip and phone checks above. There is no StreamLion-hosted backend, database migration, server function, model API or DNS change in this release. No Lovable action is required.
