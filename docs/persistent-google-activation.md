# Persistent Google connection: activation and acceptance

## Release boundary

This release adds a Cloudflare Pages Function (`functions/api/google/[[path]].js`), server authorization logic (`server/google-auth.js`), two D1 migrations and one scheduled cleanup Worker. It requires owner Google settings and server-only Cloudflare secrets. It does not activate itself on merge. The existing browser connection remains available until `ENABLE_PERSISTENT_GOOGLE=true`. Once enabled, missing configuration fails closed instead of falling back to browser sign-in. Merge the persistent-connection release and its launch-hardening follow-up before enabling it.

The owner operates Cloudflare and Google Cloud directly. StreamLion does not use Lovable; it has no development or backend role. Do not generate Lovable handoffs or substitute a backend. No paid upgrades, auto-recharge, LLM calls, or real provider searches are authorized. Activation spend ceiling: $0 incremental; if the account's plan or limits cannot support that, stop and report the required owner decision. Fail closed when configuration or the allowance check cannot be established. No claim of free operation at arbitrary scale is made.

## 1. Google Cloud (owner)

Use the existing StreamLion OAuth **Web application** client and retain the production JavaScript origin. Add this exact authorized redirect URI:

`https://streamlion.transcendencemedia.com/api/google/callback`

Declare `openid`, `email`, and `https://www.googleapis.com/auth/drive.file`. Keep Sheets, Drive and Picker APIs enabled. Do not request all-Drive permission. This is one selected-file connection for both Sheets and Drive. For production use, complete the Google Auth Platform production publishing/branding requirements: External Testing refresh tokens expire after seven days. Do not claim this upgrade alone completes Google's review.

## 2. D1 vault (owner through Cloudflare)

Reuse `streamlion-google-sessions`, database ID `f9945b40-00ca-4662-9113-585927e31ec0`, created on the existing Cloudflare account. It stores encrypted authorization, hashed session identifiers, Google account identifiers, selected workbook identifiers, expiry and request counters; project records stay in Sheets/Drive. It is never exposed as a browser database. Do not create a duplicate vault.

Check these markers before applying anything:

```sql
SELECT name, type FROM sqlite_master
WHERE name IN ('streamlion_google_sessions_v1', 'streamlion_auth_schema_v1', 'streamlion_google_session_expiry');
```

- If **all three are absent**, apply the committed `migrations/0001_google_sessions.sql` byte-for-byte in one transaction. Never generate or substitute SQL.
- If any but not all markers exist, stop and report partial state.
- If all exist, inspect the schema against that migration and confirm `SELECT version FROM streamlion_auth_schema_v1` returns exactly `1`; skip application only when they match. Stop on discrepancies. Do not inspect or print users' credentials.

Then check migration 2 separately:

```sql
SELECT name, type, sql FROM sqlite_master
WHERE name IN ('streamlion_google_request_limits_v1', 'streamlion_google_limit_expiry');
```

- If both objects are absent, apply committed `migrations/0002_google_request_limits.sql` byte-for-byte in one transaction.
- If only one exists, stop and report partial state.
- If both exist, compare their definitions with the committed migration and skip only on an exact match.
- In Cloudflare D1 Studio, use **Run all in transaction**, not **Run current statement**, for a migration file. Do not use a newline-stripping input.

Bind this database to Pages project `streamlion` under **`GOOGLE_SESSIONS`**. The committed `wrangler.jsonc` contains the real binding under `env.production` and an empty preview binding list:

```json
"env": {
  "production": { "d1_databases": [{
    "binding": "GOOGLE_SESSIONS",
    "database_name": "streamlion-google-sessions",
    "database_id": "f9945b40-00ca-4662-9113-585927e31ec0",
    "migrations_dir": "migrations"
  }] },
  "preview": { "d1_databases": [] }
}
```

Deployment from the approved merged main activates this configuration; the Dashboard cannot edit a Wrangler-managed binding. Record the resulting main SHA. Production private secrets/database must not be copied to public previews.

## 2a. Expiry cleanup

Deploy only `ops/session-cleanup.js` with `ops/wrangler-cleanup.jsonc` from the same approved source:

```sh
npx wrangler deploy --config ops/wrangler-cleanup.jsonc
```

This creates `streamlion-session-cleanup`, binds the same `GOOGLE_SESSIONS` database and schedules cleanup at **03:23 UTC daily**. `workers.dev` and preview URLs are disabled; its HTTP handler returns 404. It removes only expired sessions and request counters older than 24 hours. It logs aggregate counts, never account IDs or tokens, and makes no Google/model requests. Confirm the binding, cron and Worker version before enabling persistent sign-in. Do not delete active sessions or rotate the encryption key during activation.

## 3. Production secrets (owner through Cloudflare)

Keep the existing public settings `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_PICKER_API_KEY`, and `VITE_GOOGLE_PROJECT_NUMBER`. Add these **Production encrypted variables**:

| Name                          | Value                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_SECRET`        | Secret belonging to that same OAuth web client; server only                  |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Fresh cryptographically random 32-byte key encoded as base64url; server only |
| `GOOGLE_AUTH_ORIGIN`          | `https://streamlion.transcendencemedia.com` (no trailing slash)              |
| `ENABLE_PERSISTENT_GOOGLE`    | `true`, only after migration, binding and remaining secrets are ready        |

Generate the key securely on the owner's machine, store it directly in Cloudflare, and never paste it into chat, a PR, a repository, or a VITE variable. Do not rotate it blindly: existing encrypted sessions would stop decrypting. Disabling the flag returns to the legacy connection; it does not destroy the vault. A planned key change requires invalidating sessions and reconnecting users.

## 4. Deploy and safe receipt

After both PRs are approved and merged and configuration is complete, deploy only Pages project `streamlion` from the current merged main, including its frontend and Pages Functions, plus the named cleanup Worker above. No unrelated functions, providers, secrets, DNS, Google records or Supabase changes. Record main SHA, both D1 migration results and schema stamp `1`, production binding and preview isolation, named secret presence (never values), Pages deployment ID, Function result, cleanup Worker version and cron.

Run the safe configuration/revision receipt:

```sh
node scripts/verify-release.mjs https://streamlion.transcendencemedia.com APPROVED_FULL_MAIN_SHA
```

It reads only `/release.json`, `/api/health`, `/api/google/session` and `/api/google-config` without cookies. Require exact revision match, persistent configuration ready, unauthenticated session `{"enabled":true,"connected":false}`, `Cache-Control: no-store`, and no authorization material. It never prints API keys or tokens, calls Google, or consumes search/model credit. This is configuration evidence; it does not prove D1 availability/migrations or an authenticated Google roundtrip. Share the complete receipt and separate live acceptance results before calling activation complete.

## 5. Separate owner acceptance

Use a synthetic workbook/project first. The first connection after upgrading requires one Google approval and explicit workbook choice; legacy device-wide workbook IDs are not silently adopted across accounts.

1. Connect Google, choose or create a compatible workbook, save a synthetic project, verify the Sheet and a small field file in Drive.
2. Close the app completely and reopen in the same browser/PWA. Confirm no consent dialog, automatic workbook loading, and restoration of the last selected Google project.
3. Wait for access-token expiry (or use controlled test credentials), reopen, and verify renewal without another account chooser. Source tests mock this behavior; they do not prove Google live renewal.
4. Disconnect the network and reopen an already-kept site copy. Preserve drafts. Restore connectivity: startup failures retry on the browser's online event or through **Connections → Retry saved connection**. Do not show a failed refresh as current Google data.
5. Switch Google accounts. The former account's workbook is not adopted; select a workbook explicitly. Another tab with stale account state must fail before reading/writing through the new account.
6. Disconnect this device; reopen and confirm automatic restoration stops. Disconnect deletes that device's server session and encrypted tokens, but does not revoke other devices or Google's overall grant. Users may revoke the app separately in their Google account.
7. Revoke Google access, clear cookies, and test on physical iPhone/Android. These cases can require a new connection; local drafts remain. Sessions last up to 90 days, with server-enforced expiry. Offline copies remain on the device until the user removes them.

Persistent cookies require opening StreamLion on its own production origin. Third-party embedded ChatGPT frames may block cookies; use **Open in browser** there. Preview deployments and Vite-only dev do not use production sessions. The backend proxy streams authorized Sheets/Drive responses, never stores project content in D1, and does not automatically replay uncertain writes. Picker alone receives a short-lived access token in memory. The local site copy remains optional.

Deploy and review `/privacy.html` before using its public URL on Google Branding. It describes encrypted Google authorization stored on Cloudflare, 90-day session retention, disconnect, daily expiry cleanup and device backups. The confirmed support contact is `info@transcendencemedia.com`. Budget monitoring, live mobile acceptance and Google publishing remain production gates; see [launch-readiness.md](launch-readiness.md).

References: [Google authorization models](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model), [Google token security](https://developers.google.com/identity/protocols/oauth2/resources/best-practices), [Google token expiry](https://developers.google.com/identity/protocols/oauth2), [Cloudflare D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases), [Cloudflare D1 allowances](https://developers.cloudflare.com/d1/platform/pricing/).
