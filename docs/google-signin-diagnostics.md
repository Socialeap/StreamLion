# Google sign-in failure diagnosis

## Confirmed Workers runtime failure (October 2, 2026)

A fresh production sign-in reported `token_exchange`. Reproduction with the installed workerd runtime and the deployed compatibility date confirmed that Request rejects `redirect: "error"` before sending Google's token request. Node's Request accepts that value, so the Node-only tests missed this failure.

The shared `googleFetch` helper now uses `redirect: "manual"` and rejects all 3xx responses itself. This also fixes account verification, token renewal, and Google API proxy operations that previously supplied the unsupported value. Credentials must never follow a redirect. A synthetic workerd regression executes the production helper with real Workers Request construction, verifies successful request construction, and verifies rejection without a follow-up request.

After merge, deploy Cloudflare Pages Functions and the frontend from the same revision. No secret rotation, migration, or Google OAuth audience change is required for this runtime fix. Verify a fresh production sign-in and remembered workbook restoration separately before claiming live recovery. No Lovable action is required.

Deploy the Pages frontend and Functions together after merging this change. No migration, new secret, or Google Cloud setting change is required by this diff.

On the next sign-in, Connections displays a fixed message for the failure category. Callback redirects include only an allowlisted `reason`; never include Google's error description, authorization code, account identity, credentials, or database error text. Do not ask users to share full callback URLs.

| Code | Check |
| --- | --- |
| `client_rejected` | The owner checks that Cloudflare `VITE_GOOGLE_CLIENT_ID` identifies the intended web client and `GOOGLE_CLIENT_SECRET` is an enabled secret of that same client. Secret entry or rotation must be completed by the owner. Redeploy after changing deployment secrets. |
| `grant_rejected` | Begin a fresh sign-in, finish in the same tab, and do not replay the callback. If repeatable, verify the exact callback URL and PKCE exchange. |
| `state_mismatch` | A newer tab owns the active flow. Its cookie remains intact. Finish there or start a fresh flow. |
| `offline_access` | Google did not return a refresh token. Retry the consent flow; do not report a persistent connection as established. |
| `token_response` | Google returned incomplete tokens or omitted required Drive access. Verify the consented scope and response validation. |
| `token_exchange` | Token exchange failed, timed out, returned malformed data, or returned another provider error. Check server/provider availability. This code does not prove a bad client secret. |
| `account_check` | Google account verification failed. Check identity endpoint availability and the requested identity scopes. |
| `session_save` | Account verification succeeded but retaining the connection failed. Check D1 binding, committed schema, and vault configuration. |

Launch remains blocked until a fresh production sign-in completes, restores the selected workbook after reopening, and passes a Google read/write roundtrip. A successful build or diagnostic message alone is not proof of a working connection.
