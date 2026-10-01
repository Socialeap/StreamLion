# Google setup and release

## Persistent automatic connection (new production upgrade)

Follow [persistent-google-activation.md](persistent-google-activation.md) for the required migration, Cloudflare vault binding/secrets, Google callback, deployment receipt, and phone acceptance. This adds automatic session renewal and workbook restoration after one initial connection. Until explicitly activated, the browser-token setup below continues to work. The new backend requires an owner activation handoff; a frontend redeployment alone is insufficient.

## Existing browser connection (available until persistent sign-in is activated)

1. In your Google Cloud project, enable Google Sheets API, Google Drive API and Google Picker API.
2. Configure Google Auth Platform Branding, Audience and Data access for StreamLion. Choose External for providers outside your own Google Workspace, keep the app in Testing for the pilot, add each pilot Google account as a test user, and declare only `https://www.googleapis.com/auth/drive.file`. Supply your support contact and appropriate privacy information. Testing authorizations expire after seven days; production availability and branding verification must be checked before selling access.
3. Create an OAuth **Web application** client. Authorized JavaScript origins: `https://streamlion.transcendencemedia.com` and, for local QA, `http://127.0.0.1:4174`. Add an exact stable preview origin only when needed. Do not use wildcard production origins. This implementation uses the Google Identity Services browser token model: no redirect callback, client secret, or refresh-token vault is involved. A small Pages Function supplies only the public Google app settings; it never handles Google sign-in or access tokens.
4. For selecting workbooks created by ChatGPT or other apps, create a **restricted public API key** for Google Picker. Under Website restrictions allow `https://streamlion.transcendencemedia.com/*` and `https://docs.google.com/*` (Picker's iframe); add `http://127.0.0.1:4174/*` only for local QA. Under API restrictions select Google Picker API. Note the numeric Google Cloud project number from IAM & Admin → Settings. The API key, OAuth client and project number must belong to the same Cloud project. Never put a client secret here.
5. In Cloudflare Pages → streamlion → Settings → Variables and Secrets, add these values for the **Production** environment as encrypted variables (Secrets): `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_PICKER_API_KEY`, and `VITE_GOOGLE_PROJECT_NUMBER`. This Pages project uses `wrangler.jsonc` as its configuration source, so the dashboard does not accept ordinary text variables. StreamLion reads the values through `/api/google-config` at runtime. That endpoint intentionally returns them to the browser: these are public Google application identifiers, not credentials that can protect data. Never use a Google client secret or access token. The client ID is required to connect and create a workbook; the Picker key and project number are needed to select an existing workbook. After saving the values, start a new Production deployment. For local testing, copy `.env.example` to `.env.local`. The provider-facing Connections page does not accept Google application credentials.
6. Connect Google and Create workbook (or Choose workbook for an existing compatible template). Read back the two exact tab headers. Grant only the requested selected-file scope `https://www.googleapis.com/auth/drive.file`. Do not widen to all Drive for convenience.
7. The primary Ask flow uses ordinary ChatGPT with an explicit dated snapshot. It needs no plugin installation or separate Google connection. ChatGPT prepares a project file from a brief; the user imports and reviews it in the PWA before saving. Optional live Google tools in ChatGPT require their own authorization, independently of StreamLion.

Tokens stay in memory and expire. Reconnect explicitly when needed. User denial, network failure and revoked access must preserve drafts and must not produce a success confirmation.

Current setup references: [Google Auth Platform audience](https://support.google.com/cloud/answer/15549945), [Google Picker web setup](https://developers.google.com/workspace/drive/picker/guides/web-picker), [Cloudflare Pages Wrangler configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/), and [Cloudflare Pages variables and secrets](https://developers.cloudflare.com/pages/functions/bindings/#secrets).

## Owner acceptance

Use fixtures/project-intake.json and a synthetic source brief first. Import the prepared project file, review its facts, and save to the selected workbook. Verify exact references, blank end appointments, separate amounts, and source notes. Edit one value and verify readback. Prepare requirements, record a typed observation and a small photo/voice memo, and check their Drive links and Sheet records. Disconnect the network after keeping a site copy; reload, capture a note, reconnect, and verify that retry produces one logical observation and one file. Test account switching, denied access, expiry, direct Sheet edits, and physical iPhone/Android recording. Use the current owner checklist in [provider-workflow.md](provider-workflow.md); source tests do not prove live acceptance.

## Release ownership

The owner configures Google Cloud and the three encrypted Cloudflare Pages settings above. Cloudflare Pages builds and publishes the merged GitHub `main` branch; the Pages Function at `/api/google-config` makes only those public identifiers available to the browser. Then the owner performs the Google roundtrip and phone checks above. There is no database migration, model API or DNS change in this release. The owner activates this setup directly through Google Cloud and Cloudflare. The persistent upgrade requires the separate backend activation described above.

## One home in Drive

After connecting, use **Connections → Set up StreamLion folder**, or choose an existing folder. **Create workbook** also sets up the folder and places a new **StreamLion Projects** workbook there. One workbook holds many projects. **Switch workbook** selects another existing workbook through Google Picker.

The selected folder and workbook are restored together by the saved Google session in the same browser. Existing workbooks stay where they are; **Move selected workbook here** is optional and confirms the folder's sharing implications. Changing folders affects new files only.

In a saved Google project, **Open project folder** opens its dedicated folder under **Project files**. Newly retained photos and voice memos go there. Repeat visits get their own folder; project names are labels, while workbook and record IDs prevent files from mixing. Previous file links remain valid. No separate index workbook is needed.

See [central-folder-release.md](central-folder-release.md) for the required migration and live acceptance.
