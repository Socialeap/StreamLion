# Admin portal — review and activation gates

Owner approved implementation only: 800 credits per grant and account/month, 4,000 global/month, admin-goodwill speech funding. Existing access rules remain; unused manual goodwill survives Core refunds. No merge, deployment, live credit grants, provider attempts, new credential, or backup identity is authorized by this PR.

## Review artifact

Read `docs/superpowers/specs/2026-10-24-admin-portal.md` and the PR's exact head SHA. Review the single migration `migrations/0025_admin_portal.sql`, source-allocation invariants and tests, owner OIDC assurance, online-only admin cache boundary, and synthetic desktop/mobile preview. Both policy rows are disabled, there are no enrolled owners, and all existing provider/payment policies and runtime flags are preserved.

## After explicit merge authorization

Merge the reviewed PR to main only when separately approved. Record exact merged main SHA and compare the migration/server/frontend tree to the reviewed PR. The `[CF-Pages-Skip]` commit marker is not an instruction to deploy. No branch preview may bind production D1 or load production accounts. Local previews use synthetic data only.

## Scoped database activation — HOLD until authorization

Use the existing Cloudflare operator access; verify account, `streamlion-google-sessions` database, production binding and test/live mode. Capture the D1 recovery bookmark/backup. Obtain a protected local JSON containing `sqlite_master` `name,type,sql` (no customer rows) and verified version values from every `*schema_v1` table, under `{schema:[...],stamps:{...}}`.

```sh
node scripts/preflight-admin.mjs /private/tmp/streamlion-admin-schema.json
```

A `pending` result requires every new marker absent and the exact committed predecessor through 0024, with the independently held optional saved-card schema (0017) either wholly absent or exact and complete. Any saved-card object or version stamp makes the entire committed 0017 schema mandatory for that comparison; partial or altered state requires STOP. Do not apply 0017 to activate this portal. Apply **only** the approved merged main's `0025_admin_portal.sql` byte-for-byte. A full exact result returns `already_applied`; skip replay. Missing, partial, mutated, unknown protected-table triggers or conflicting stamps require STOP. Never generate replacement SQL, bulk-apply pending migrations, edit wallets or reset provider budgets to obtain a passing result.

The migration creates new operational metadata and backfills a first-known directory from retained records. It changes existing reservation/debit/restoration triggers to allocate goodwill without changing balances, current policies, prices, historical charges, or entitlement records. Existing reserved shared/speech charges are mapped before debit triggers exist so they are never charged twice. Historical completed shared/speech rows remain canonical. Unmatched older AI turns remain explicitly unreconciled rather than guessed into totals. Before applying, reconcile any pre-existing commercial promotional wallet that lacks consistent starter-grant evidence; do not silently classify undocumented manual adjustments as starter credit.

Capture pre/post fingerprints and counts for purchases, credit orders, original wallets, active reservations, sessions, provider policies and flags. Original values must be unchanged; new source rows describe existing reservations only. Verify schema/stamps with the same classifier after application. A failed/partial application needs recovery review, not replay.

## Backend and owner enrollment — separate HOLD

Deploy only the reviewed merged SHA after schema verification and authorization. No auxiliary Worker deployment, new secret, environment binding, checkout change, provider activation or credit-consuming check is required. Configuration uses closed D1 policy rows, avoiding additional runtime bindings.

Bind only the Google subject obtained from the owner's real verified Google sign-in as `shakoure@transcendencemedia.com`. Never enroll by browser-supplied email or copy every pilot admin. The preparation command below emits a proposed parameterized operator bundle; it performs **no** network call or write:

```sh
node scripts/admin-operator.mjs bootstrap live VERIFIED_OWNER_SUBJECT APPROVED_MERGED_MAIN_SHA
```

The bundle contains one insertion whose database triggers check the verified identity and prior-owner preconditions, bind the exact subject, invalidate prior access, record an audit event and open read access with `grants_enabled=0` atomically. Apply this reviewed insertion through the existing authorized operator connection, then verify its exact immutable audit receipt using the supplied query. Any failure or missing/mismatched receipt requires STOP. Save and retry the same bundle if the response is lost; only an identical prior request may return zero inserted rows. Recheck that exactly one owner is enabled for the selected mode.

Owner opens `/admin/` and completes the exact admin OAuth continuation. Ordinary Google OAuth scopes do not change. Only this continuation requests OIDC `auth_time`/`amr` and a unique nonce. `jose` verifies the Google signature, issuer, audience, nonce, subject, expiration and actual authentication time; issued-at, a consent screen or refreshed access token is insufficient. Claims must be available/enabled in the project's actual Google settings and must show supported recent authentication. Google identity/configuration verification is not inferred from the local signed-token fixture.

If valid evidence is missing/stale, the dashboard may be read-only but **credit changes stay locked**. Do not enable grants to bypass this. A separately approved passkey implementation/enrollment is a possible follow-up if Google cannot provide reliable assurance; no passkey is installed by this PR. A live owner sign-in receipt and mode-specific policy authorization are prerequisites to setting `grants_enabled=1`. Do not insert a fabricated `verified_at` or authorization row into production.

Admin idle/absolute windows are 15/60 minutes; mutation evidence is at most five minutes old. Each grant/reversal additionally has a payload-bound, single-use 60-second confirmation. Owner access does not require a Core purchase. Positive recipient grants and feature spending retain current paid eligibility and purchased-credit holds. Corrections may reverse unused locked goodwill without activating the recipient.

## Frontend release and owner/device acceptance — separate HOLD

After backend/owner verification and explicit frontend release authorization, confirm the served `/release.json` SHA and `/admin/` assets. Cloudflare Pages may ship Functions/assets together; backend, frontend and device acceptance still have separate receipts.

Verify real owner sign-in and wrong-account denial, all direct admin API paths, expired/revoked windows, account switching/sign-out, search/sort/page/filter totals, charts and coverage labels, phone cards and account details, keyboard/zoom, and installed-PWA refresh. Admin HTML is excluded from service-worker precache/offline navigation; reporting APIs are no-store and private reports, identities and balances are never persisted by the browser. An opaque operation UUID and mode remain in tab-scoped session storage until an uncertain credit change is reconciled; this marker contains no recipient, amount, reason or credential and cannot authorize a change. Activity metadata contains account ID/time/day only; foreground records are observational and never authorize billing. Queued events older than seven days or for another account are discarded. Daily usage metadata is retained for 90 days; the known account directory and financial/audit records remain subject to the owner's operational retention policy.

Do not use production accounts as public preview fixtures. An owner-approved recipient/amount is required before any live grant QA. Grant/reversal validation itself makes no Stripe/Google-file/AI/speech/email call. Real provider attempts require separate approval, existing provider enablement and cost reserves/budgets; a grant does not approve provider spending. Speech keeps its one-credit/1,200-character quote/confirmation contract and its paid/provider gates; it uses manual goodwill, then purchased funds, never starter credit. Loaded-clip replay remains free. Test declined policies, restored failures, audit rollback and exact-once receipts before any activation claim.

## Recovery and rollback

Verify that existing Cloudflare/GitHub operator access can be recovered independently of the affected Workspace account. If it shares the same failed Google login, recovery remains unproven and must be resolved through a separately authorized arrangement before live mutations. No fallback account or credential is created automatically.

For a compromised/lost Google identity, distinguish provider configuration repair from ownership change. After explicit owner authorization and a new verified subject at the **same authorized email**, prepare:

```sh
node scripts/admin-operator.mjs recover live NEW_VERIFIED_OWNER_SUBJECT APPROVED_MERGED_MAIN_SHA EXPECTED_PRIOR_SUBJECT
```

Review preconditions, exact mode/SHA and independent proof of owner control. Apply only the approved guarded insertion; its triggers revoke the old role/windows/authorizations and keep grants disabled atomically. Verify and retain its exact audit receipt. Another email requires an explicit reviewed identity-policy change. The preparation script is not an autonomous recovery executor. Test recovery on synthetic data first.

Rollback disables `grants_enabled` first, then `enabled` if needed, and rolls application code back to an approved compatible version. Preserve this source-aware migration, audit events, grants and allocations. Do not restore old charging triggers against new goodwill balances or use negative paid balances as a rollback. No automatic data deletion, broad function deployment, budget increase or financial compensation occurs.

## Activation receipt required before completion

Main SHA; recovery bookmark; preflight phase and migration/platform stamp; unchanged protected balances/policies/flags; exact backend/frontend deployment IDs and served SHA; enrolled owner subject confirmation without session/token contents; Google claim-assurance and wrong-account tests; independent recovery status; mode-specific read/write policy state; approved grant/reversal receipts if tested; separate desktop/phone acceptance. A safe health check makes no provider, checkout or mail request.
