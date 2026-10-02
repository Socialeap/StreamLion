# Google sign-in failure diagnosis

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
