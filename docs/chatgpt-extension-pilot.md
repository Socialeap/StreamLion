# StreamLion ChatGPT extension pilot

## Release boundary

This is an optional prototype alongside the standalone PWA, its two-button ChatGPT handoff, the existing `plugin/` package and `/mcp` endpoint. Those routes and workflows remain available. The pilot uses a separate `/mcp-extension` endpoint and `plugin-extension/` package. The original PR #37 left activation disabled. The owner approved activation on October 3, 2026; this activation revision enables the production flag in Pages and scheduled cleanup. Private tools still fail closed unless the existing persistent Google configuration is ready and migration 0006 is present.

**No Lovable action is required.** GitHub owns source; the owner operates Cloudflare, Google and the owned ChatGPT plugin. Hold production activation and the account-plugin update until this PR is merged and the owner authorizes pilot activation. Record the exact merged main SHA in the receipt. Do not publish a public plugin release as part of pilot setup.

Incremental activation spend ceiling: **$0**. No LLM API calls, paid upgrades, new services, auto-recharge, production customer writes or paid searches are required. The extension uses the user's ChatGPT conversation and the existing Cloudflare infrastructure. Stop if account allowances or configuration cannot support the pilot; ordinary hosting and Google quotas still apply.

## What the prototype does

- Sidebar entry **StreamLion**, thread entry **Current project**, and a synthetic example. The UI is one self-contained MCP resource, without a nested PWA iframe, remote assets or a third-party browser-cookie dependency.
- Link a StreamLion account to one selected workbook. The grant is pinned to that workbook; changing the PWA selection does not silently redirect extension writes. Reconnect the extension to change its destination.
- List and open projects; explicitly attach the selected job to the conversation; send a question to the active thread.
- Prepare project, field-note, exact room-reading and checklist changes. The model can prepare a review copy. Only the app's confirmation tool can save, using a grant-bound, hidden confirmation key.
- Save an append-only Google revision and reread it before showing success. Retry uncertain writes with the same revision and save choice. Stale or conflicting history stops the write. Project saves retain the editor and use normalized saved fields as the next baseline.
- Derive proposed tasks from source wording, check them, record exceptions, and preview a handover. Payment and unchecked evidence are omitted by default. Unsaved checklist changes are labelled as a working copy.
- Retain raw dictation and prior source wording. Ambiguous readings can be saved as drafts; they cannot be marked tape-checked. Device keyboard dictation works in text fields; the PWA retains its existing audio recorder and offline drafts.

Google Sheets/Drive remain authoritative. Cloudflare stores OAuth grants and **encrypted, temporary review copies**, not an independent project database. This is disclosed in both public privacy URLs. Review copies expire after 24 hours, with daily expiry cleanup; up to 30 copies per grant. Access tokens last one hour, rotating refresh tokens are bounded by a maximum 30-day grant and the underlying Google session. Revoking the extension or disconnecting Google ends access. Already-sent ChatGPT messages are not erased by revocation.

This pilot reads the standard Projects and Observations tabs, each limited to 10,000 rows. It does not import arbitrary Drive files, record microphone audio, create folders, archive projects, process payments inside ChatGPT, or synchronize device-only PWA drafts. Those workflows continue in the browser workspace. Independent PWA/external Sheets writers can still create revision forks; the pilot detects and refuses conflicting history rather than claiming an atomic lock across all clients.

## Local validation and package

For a browser-testable prototype before account activation, run `npm run preview:extension` and open **http://127.0.0.1:8792**. The loopback host uses the real MCP Apps bridge and a synthetic workbook. You can try project editing, reviewed note/measurement/checklist saves and handover messages; its conversation panel records prompts without calling an AI. Reset demo restores the sample. This development harness is not deployed and does not connect to Google.

```sh
npm ci
npm test
npm run build
npx wrangler pages functions build --outdir=/tmp/streamlion-extension-functions --compatibility-flags=nodejs_compat
npx wrangler pages dev dist --port 8788 --ip 127.0.0.1
```

In another terminal:

```sh
npm run smoke:mcp
npm run smoke:extension
```

The extension smoke checks both OAuth descriptor locations, sidebar/thread registration, app-only save visibility, protected reads and the native resource. The legacy smoke checks that `/mcp` still returns its existing tools and microphone delegation.

The build creates ignored `server/generated/extension-ui.js` before Functions compilation. `dist/extension.html` is a local UI fixture, excluded from PWA navigation and offline precaching. It is not a replacement PWA route.

Package the **contents** of `plugin-extension/`, including dotfiles, with `plugin.json` at the ZIP root:

```sh
cd plugin-extension
zip -qr /tmp/streamlion-extension-0.75.1.zip . -x '*.DS_Store'
```

The package preserves the owned identity `gpt-11b52f5bcfe3bd414f9586be746198d8` and version `0.75.1`. Keep the unchanged `plugin/` package for rollback. A source ZIP is not proof of successful account publication or host compatibility.

## Activation after merge and owner approval

### 1. Cloudflare D1 preflight

Reuse `streamlion-google-sessions`, ID `f9945b40-00ca-4662-9113-585927e31ec0`, bound as `GOOGLE_SESSIONS`. Do not create another database or rotate existing keys. Inspect definitions only, never credential or draft contents:

```sql
SELECT name, type, sql FROM sqlite_master WHERE name IN (
  'streamlion_extension_schema_v1', 'streamlion_extension_codes_v1',
  'streamlion_extension_grants_v1', 'streamlion_extension_tokens_v1',
  'streamlion_extension_drafts_v1', 'streamlion_extension_locks_v1',
  'streamlion_extension_token_grant', 'streamlion_extension_draft_grant'
);
```

- If all eight objects are absent, apply the committed `migrations/0006_chatgpt_extension.sql` **byte-for-byte in one transaction**.
- If only some are present, stop and report partial state. Do not generate or substitute a migration.
- If all are present, compare their definitions with that committed file and verify `SELECT version FROM streamlion_extension_schema_v1` returns exactly one row with `1`. Skip application only when all match. Stop on discrepancies.

### 2. Cloudflare pilot configuration and deployments

After successful preflight, use the owner-approved activation revision containing `ENABLE_CHATGPT_EXTENSION: "true"` in **production-only vars** in `wrangler.jsonc` and in the cleanup Worker's vars in `ops/wrangler-cleanup.jsonc`. Preview remains without the production database or secrets. Wrangler-managed variables are configured in source, not in the Dashboard variable form. Do not redeploy the original disabled PR #37 configuration over an activated pilot.

Deploy the approved merged source to the existing `streamlion` Pages project. Then deploy only `ops/session-cleanup.js` using its existing configuration:

```sh
npx wrangler deploy --config ops/wrangler-cleanup.jsonc
```

Verify the existing 03:23 UTC daily schedule and shared database binding. Both deployments must include the flag; otherwise daily cleanup will not purge pilot review copies and grants. Existing session cleanup remains active. Run the cleanup against **synthetic expired rows only** before accepting real pilot review copies; do not expire or delete active owner sessions.

Reuse the existing `GOOGLE_AUTH_ORIGIN`, Google client settings, `GOOGLE_TOKEN_ENCRYPTION_KEY`, D1 binding and purchase-entitlement settings. No new secret, Google API scope or Google callback is introduced. Retain the existing `/api/google/callback` configuration. Confirm production `STREAMLION_REQUIRE_LICENSE` matches the intended paid access policy; do not disable it to bypass a pilot account's entitlement.

### 3. Owned ChatGPT plugin connection

Update the existing owned StreamLion plugin with the pilot ZIP and MCP endpoint after activation; preserve its identity and audience. Refresh tool discovery. This update is a separate account action from deployment, and remains unperformed until approval.

OAuth settings for a **predefined public client**:

| Setting | Value |
| --- | --- |
| MCP resource | `https://streamlion.transcendencemedia.com/mcp-extension` |
| Client ID | `https://chatgpt.com/oauth/client.json` |
| Client secret | None; public client with PKCE S256 |
| Exact callback | `https://chatgpt.com/connector_platform_oauth_redirect` |
| Authorization endpoint | `https://streamlion.transcendencemedia.com/api/extension/authorize` |
| Token endpoint | `https://streamlion.transcendencemedia.com/api/extension/token` |
| Revocation endpoint | `https://streamlion.transcendencemedia.com/api/extension/revoke` |
| Scopes | `records.read records.write` |
| Resource metadata | `https://streamlion.transcendencemedia.com/.well-known/oauth-protected-resource/mcp-extension` |
| Authorization metadata | `https://streamlion.transcendencemedia.com/.well-known/oauth-authorization-server` |

Only the exact client and callback are accepted. This prototype does not implement arbitrary client metadata retrieval, dynamic registration or signed client assertions. If the selected host cannot use this predefined public-client flow, stop and report its actual requirements; do not weaken redirect, account, workbook or token checks.

The first connection uses the existing StreamLion Google session when available. Otherwise the owner signs in through Google, then returns to the connection page. If a workbook has not been selected, select it once in PWA Connections and return. The consent page identifies the account and links the selected workbook before granting access. A workbook link is already provided to ChatGPT by the tool; users should not repeatedly paste workbook IDs or authorize Rube.

### 4. Live acceptance and receipt

Use a fresh **synthetic** workbook selected through the existing Google Picker. No production customer records or chargeable checkout tests are authorized by this prototype.

1. In the intended ChatGPT Work host, confirm StreamLion appears as a direct sidebar entry and Current project as a thread tab. Confirm the native UI opens without a nested PWA iframe.
2. Connect, inspect the consent destination, list/open a synthetic project, and reopen the host to confirm refresh works without repeatedly selecting the workbook. Verify wrong-account, revoked and expired access fail closed.
3. Ask about the selected project, switch projects, and confirm old attached context clears. The conversation must cite actual fields/observations. Opening a project alone does not silently share its private context.
4. Prepare and save a draft project, continue editing, and check actual appended rows in Google. Save a note, correct it without losing original wording, save exact readings, and check unclear readings cannot be marked reviewed.
5. Review brief-derived tasks, save their checklist, and generate a handover. Unchecked evidence, linked private area names and payment stay omitted unless selected. Unsaved checklist previews identify themselves as working copies.
6. Interrupt a synthetic write, retry the same save and verify one revision. Try a stale edit and concurrent save; conflicts must be reported without silent overwrites.
7. Test on the owner's physical Android device in a supported host: entrypoint, keyboard dictation, review/save, conversation question and return to the PWA. Android deep-link routing is not assumed. Classic ChatGPT browser chat is not claimed to support the new extension entrypoints; the existing browser handoff remains available.
8. Retest PWA reconnect, offline/device drafts, two-button ChatGPT handoff, legacy `/mcp` and purchase restoration. Neither a plugin install nor a deploy receipt replaces these checks.

Receipt: exact merged SHA; all eight migration markers and version result; Pages deployment/revision; cleanup Worker version, cron and aggregate expiry result; pilot and purchase flags (no secrets); metadata and both MCP smoke results; owned plugin version/endpoint and first OAuth round-trip; synthetic Google row checks; Android result; unresolved host limitations. Public promotion remains a later release decision.

## Evidence from implementation

Focused backend/UI tests cover account/workbook/grant boundaries, single-use PKCE codes, refresh rotation, entitlement and expiry, temporary encrypted drafts, stale revisions, save retries, ambiguous readings, correction originals, explicit context, preserved edits and handover privacy. The full suite, PWA/UI build, Functions compilation and local HTTP MCP smoke are separate checks.

Rendered UI checks used the real MCP Apps SDK bridge with a **simulated ChatGPT host and synthetic Google responses**, at 1360 × 1000 and 390 × 844. They exercised project context, active-thread messaging, note/measurement/checklist review saves, handover privacy, no nested iframe and no horizontal phone overflow. The uncached Playwright CLI could not be fetched; the already installed Chrome and bundled Playwright library were used without adding a dependency. This proves local rendering and bridge behavior, **not live ChatGPT entrypoints, OAuth linking, production Sheets writes or physical-device voice**.

## Rollback

Disable the pilot flag in Pages first to deny private access, then in the cleanup Worker after revoking/removing pilot-only retained state under owner authorization. Keep normal expiry cleanup running until that state is gone. Restore the unchanged `plugin/` package and `/mcp` endpoint in the owned plugin if needed. Leave the standalone PWA, its handoff, Google records, encryption key, purchase settings and existing sessions intact. Do not drop production tables or delete Google revisions as a rollback shortcut.

## Framework references

- [MCP Extensions specification, pinned node-v0.1.0](https://github.com/openai/mcp-extensions/blob/node-v0.1.0/docs/spec.md)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [Tool, resource and authentication metadata](https://developers.openai.com/plugins/reference)

Host support and account connection behavior require current-host verification during activation.
