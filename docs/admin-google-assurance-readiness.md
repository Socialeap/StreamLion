# Google authentication readiness for admin credit changes

Read-only inspection on 2026-10-25 UTC matched the deployed StreamLion OAuth client to its Google project. The project is In production and Google reports the app verified. In Google Auth Platform → Settings → Advanced Settings, **Session age claims** and **Authentication strength claims** were both unchecked. No Google setting, grant policy, role, limit, provider budget or access rule was changed during inspection.

The owner’s open live admin page recognized the enrolled owner, loaded reporting, displayed Credit changes paused and showed the untouched 4,000-credit monthly allowance with 800 per grant/user-month. Live metadata had no validated recent-authentication result. The metadata does not distinguish every historical failure reason; disabled claim settings are a confirmed configuration blocker, not proof of a particular past token's contents. No raw Google token was inspected, stored or logged.

## App-side compatibility correction

Google documents `swk` for software keys such as passkeys. The deployed verifier accepted `pwd`, `mfa` and `hwk`, but rejected a validly signed, fresh synthetic token carrying only the documented `swk` method. This correction adds only `swk` to that method list. It does **not** create a StreamLion passkey, enroll a credential or accept an unsigned browser assertion.

Signature, RS256 algorithm, issuer, audience, expiry, exact owner subject, nonce and actual Google authentication-time checks remain unchanged. Authentication evidence must still be under five minutes old; token issue time is not a substitute. SMS alone, stale evidence, wrong nonce/subject and altered signatures remain rejected.

Google’s documented setup and semantics: https://developers.google.com/identity/siwg/security-bundle . `auth_time` represents the Google-account session, not merely returning to StreamLion, and Google does not support app-requested Google Account reauthentication. Enabling claims therefore does not by itself prove a future admin login is fresh enough.

## Validation

The fresh signed `swk` regression failed with `admin_assurance` before the correction and passed after it. Negative cases cover stale authentication, wrong nonce, wrong subject, unsupported SMS-only/empty methods and an altered signature. All **1,127 tests passed**, zero failed/skipped, and Pages Functions compilation and diff checks passed. Tests use synthetic signing keys; no live grants, purchases or paid provider requests were made.

## Ordered activation gates — held

1. Review and explicitly approve merge of the compatibility correction. Deploy the exact approved merged SHA through the existing Pages project; preserve environment, bindings, owner role and `grants_enabled=0` in both modes. This code fix requires a Functions deployment, but no migration, secret, scope, Google-client or new credential change.
2. Obtain explicit owner authorization before changing Google settings. In the verified StreamLion project, enable only Session age claims and Authentication strength claims, save and retain a receipt. No publishing-status, scope, client-secret, redirect-URI, provider, budget or grant-policy change is part of that action.
3. Owner completes actual recent Google authentication and the normal admin sign-in in the same browser, then Codex verifies a current owner window with validated `verified_at` and fresh mutation evidence. Merely reusing a long-lived Google session may leave evidence stale. If the evidence remains unavailable, keep mutations closed and investigate without logging credentials or substituting issued-at timestamps. A separately approved app-side passkey factor remains a possible future alternative, not part of this patch.
4. Only after recent-authentication proof, independent operator recovery and explicit grant-enablement authorization are satisfied may the live grant flag be enabled. Keep test mode off. A live test additionally needs an eligible paid Core recipient and an explicitly approved amount; the readiness check found zero eligible live recipients. Never fabricate a purchase or widen pilot access to pass QA.

Approved limits and source rules remain: 800 credits/grant, 800/user/month, 4,000 live credits/month in America/New_York; original positive issuance counts even after reversal. Grants do not activate access or bypass holds/provider gates. Manual goodwill supports otherwise-enabled speech and survives Core refunds unused, remaining locked until access is valid again. Starter credits retain existing revocation and speech exclusions.
