# Admin portal source validation — 2026-10-24

Implementation is review-only. No merge, remote migration, owner enrollment, deployment, live grant, purchase, provider attempt or credential creation was performed.

## Verified source

Base: `474dca0acf3d9022ef21cae329393fe3fb8ac3fb` (main includes delivery-workflow PR #126). Implementation commit: `5bcc006` plus this documentation-only validation update. Approved limits: 800 credits/grant, 800/account/month and 4,000/mode/month in America/New_York; admin goodwill funds speech. Retained goodwill never activates access, bypasses a purchased-credit hold or enables a provider.

## Completed checks

- Full `npm test`: **1,115 passed**, zero failed/skipped, including local Workers/Miniflare D1 integration. Earlier implementation-base run: 1,103 passed.
- `npm run build`: passed; separate admin entry is about 29.36 kB / 8.98 kB gzip. Admin HTML is outside PWA precache/offline navigation.
- Wrangler Pages Functions build with `nodejs_compat`: passed.
- Coordination and cleanup Worker `deploy --dry-run`: passed; no upload/deployment.
- `npm run verify:capacity`: passed with synthetic data and zero provider calls.
- `npm audit --audit-level=high`: passed its threshold; zero high/critical, three moderate and one low advisory in pre-existing transitive dependencies (fast-uri, hono, ip-address, serialize-javascript). No unrelated dependency repair included.
- `git diff --check`: passed.
- Desktop and 390 px phone browser checks: charts/table/cards, navigation, account details, explicit grant review, synthetic grant receipt and unused-credit reversal; monthly issuance stayed consumed after reversal. Final preview had no warning/error console entries. Screenshots are synthetic owner-review artifacts, not live customer data.

The new ledger tests cover individual/account/global ceilings, source restoration, Core refund/re-purchase, starter exclusion from speech, locked/held access, reserved/consumed reversals, audit-failure rollback and test/live isolation. Actual local D1 covers competing grants at a shared ceiling, duplicate operations, failed-audit atomicity and reversal versus speech reservation. The migration preserves already-reserved charges without a second debit and returns failures to their original sources.

The directory scale checks seed 1,000 and 10,000 accounts, verify activity-index use, three SQL statements per page and cursor identity. Local SQLite timings are not production D1 latency, row-read budgets, concurrency guarantees or service SLOs.

## Independent review corrections

1. Uncertain mutation responses retain only an opaque operation UUID/mode in tab-scoped session storage. Visibility changes, reload or sign-in cannot create a new change until the original operation is reconciled; the recovery marker contains no recipient, amount, reason or credential.
2. Exact schema preflight rejects all unknown triggers, including quoted/bracketed/commented table-name variants. Legacy classifiers recognize only the complete exact admin successor and cannot invite old charging-trigger replay.
3. Visible idle/absolute expiry clears private reports without waiting for another request. The database checks current time as well as issuance time so a delayed request cannot commit after authorization expires.
4. Bootstrap/recovery is a single guarded insertion with atomic enrollment, invalidation and audit. Synthetic tests verify wrong identity rejection, audit rollback and exact-payload replay.

## Remaining live gates

All are **HOLD** pending separate owner authorization: approved PR merge; exact predecessor/schema fingerprint and D1 recovery bookmark; byte-for-byte migration 0025; owner subject enrollment/read enablement; real Google claim-assurance/configuration and independent operator recovery verification; mutation policy enablement; exact SHA deployment/frontend receipt; actual owner/device acceptance. A remote D1 acceptance receipt is still required; local Miniflare is not proof of the current production platform or data.

Google OIDC assurance uses the documented auth_time/amr claims and nonce, with signature/issuer/audience/expiry/subject validation. Their availability and recent authentication must be verified against the actual Google project before writes can open. Missing proof remains read-only; no fallback passkey is enrolled. Reference: https://developers.google.com/identity/siwg/security-bundle

See `docs/admin-portal-release.md` for ordered preflight, activation, rollback and receipt requirements. The initial reporting scope and follow-on UI refinements are explicit in the implementation plan.
