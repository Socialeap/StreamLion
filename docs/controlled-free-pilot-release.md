# Controlled free pilot and open interest list

Status: implementation for review, disabled by default. This is StreamLion's
standalone provider pilot. It is unrelated to the Frontiers|3D affiliate program.
No admission, invitation delivery, migration, pilot deployment or public opening
is authorized by this document. No subscription or Stripe object represents a
pilot. Current Core pricing remains a separate one-time purchase model; a future
subscription model is not implemented or promised here.

## Review of the recommendation

Proceed with an invitation-only **Core workflow** pilot and a separate open
interest list. Use the existing verified Google sign-in, session cookie, Google
API quota controls, workspace/license gate, backups and purchase ledger.

- Recommend **14 days**, configurable to 7 before opening; five simultaneous
  reserved/active places **and five cumulative admissions** initially. Approval
  consumes cumulative admission and reserves a place for at most 48 hours.
  Activation alone starts the clock. Expired reservations release simultaneous
  capacity without admitting replacements. The cumulative limit makes replacement
  a deliberate owner decision. Reviewed expansion can increase both limits up to
  20; runtime administrators cannot change policy or reset admissions.
- Registration uses a verified Google account so no new email-verification
  service or unauthenticated lead database is needed. Signing in reuses the
  existing `openid email drive.file` flow; no expanded Google permissions.
  Capture name, optional business/role, short fit description, verified contact
  email, required pilot-contact permission and independent optional marketing
  permission. No client documents. Both checkboxes start unchecked.
- Applications never grant access. Approval, account invitation, activation,
  derived expiry and revocation are distinct. An invitation is a server-side
  account-bound record visible after sign-in at `/pilot/`, not a bearer URL.
  The owner can manually notify the invited account only after the applicable
  authorization. This implementation sends no invitation, email or marketing.
- Start/end timestamps are durable, server-derived milliseconds. Duration is
  snapshotted at approval. Retries, refresh, reconnect and other devices reuse
  that record. The UI shows UTC. Admissions/activations require the approved
  application/admission window and enough time for the full duration before the
  overall closing date. The 48-hour invitation deadline is shortened if needed
  to preserve the complete advertised duration. No shortened trial is hidden.
- Permit one explicit, reasoned extension while access is still active, up to
  seven extra days total, never beyond the overall closing date. Expired or
  revoked accounts cannot be revived through this UI. Every transition/extension
  records actor, reason, timestamp and resulting access dates. Repeated approval
  cannot consume another admission or restart access.
- Preserve `hasPurchase()` as paid-only. Add Core access only to the existing
  Google workspace gate and frontend gate. Existing paid access survives pilot
  expiry/revocation. No trial modifies orders, wallets, sessions or Google files.

## Cost and workflow scope

Pilot allowance for paid AI, brief preparation, hosted speech, client-portal
notifications and other provider-backed processing: **$0**. The pilot grants no
paid entitlement, starter credit, wallet balance or Stripe subscription.
AI additionally fails closed for unpaid accounts whenever free-pilot mode is on,
even if the old legacy AI mode is configured without license enforcement.
Brief preparation, hosted speech and client coordination retain their existing
paid-purchase checks; pilot accounts cannot use these routes through a forged
frontend or direct request. Keep all existing production cost flags and policies
closed. No real provider calls are needed for activation or QA.

The useful pilot workflow is manual project preparation → Google save → field
notes/measurements → handover/export, plus saved-detail lookup and device backup.
The existing credit-priced client-portal confirmation workflow is excluded.
This avoids granting unfunded processing or silently presenting an incomplete
paid workflow as free. Device/browser voice is optional and may use the browser's
own services; do not claim that it is an offline voice provider.

Reuse existing shared Google quotas (200 project requests/minute, 40/account
per minute), bounded forms and mutation rate limits. Application bodies are
limited to 4 KB, fit to 500 characters, feedback/support to 1,000 characters each;
one application/account/mode, one mutable feedback record, paginated admin lists
of 50. These controls limit ordinary usage; they are not a promise that D1,
Pages or Google traffic is free under arbitrary abuse. No paid infrastructure,
upgrade or automatic recharge is authorized. Check existing Cloudflare usage
before opening, monitor during the first five participants, and close interest
registration/admissions if existing service limits are threatened. Keep retrieval
available for admitted accounts. Separate cost review is required before expanding
feature scope or infrastructure.

## Expiry, data and operations

Expired and revoked participants keep their files in their Google account and
the existing device-backup download via `/api/purchase`. Previously activated
accounts retain authenticated read-only Sheets/Drive retrieval through the
existing narrow server proxy, while mutation and picker-token routes require
active Core or paid access. Quotas still apply. Disabling the entire feature flag
also disables this optional proxy exception; direct Google ownership and local
backup remain. Revocation is an access action, not a file deletion/disconnect.
Already issued Google tokens and Google file ownership are controlled by Google;
local/offline copies are not remotely erased. A cached frontend pilot receipt
cannot outlive its server expiry. The server checks every workspace request;
local storage is never an API authorization credential.

`/pilot/` reuses application headers/styles for participant and administrator
views. Only subjects in the mode-specific D1 administrator table can list or
change admissions. The view separates applications, cumulative admissions,
reserved places and active accounts. Feedback records onboarding and useful
workflow completion **as participant reports**, support/errors, optional feedback
and willingness to pay. It does not invent verified usage, measured infrastructure
cost or purchases. Actual purchases remain in the existing Stripe/D1 ledger.
No testimonial or purchase commitment is required. The UI explains operational
retention and consent withdrawal via existing support. Before opening, approve
a concrete application/feedback retention period; recommend a review 90 days
after closing, with minimal identity/admission tombstones retained as needed to
prevent trial resets. No automatic deletion is implemented by this change.

## Existing release evidence and launch holds

Inspected `README.md`, `docs/checkout-tax-release.md`,
`docs/chatgpt-retirement-release.md`, current main and local release records.
The application checkout was clean on an older completed feature branch;
`codex/controlled-free-pilot` starts at current `origin/main`
`39792e5d0338c220f0d4a11f69dc02a6cbafecc2`. Top-level local artifacts were preserved.

October 24 public checks showed Core and credit checkout unexpectedly open in
live mode. The owner explicitly authorized **only** pausing checkout and the
minimum matching release. That separate operation changed only
`STREAMLION_CHECKOUT_MODE=paused` and redeployed the same main SHA, without pilot
code, schema changes, admissions, provider calls or paid transactions. The public
Core/credit configurations then returned `enabled=false, checkoutMode=paused`;
health was ready and AI/import/speech stayed disabled. Local receipt:
`../artifacts/checkout-pause-2026-10-24/receipt.json`. Existing confirmation,
signed webhooks and paid-access paths were unchanged; no real paid-customer
session was exercised during this pause. This is not paid-sales approval.

The October 21 release receipt still lists physical Android acceptance and real
paid settlement/refund acceptance as pending, and a test-mode maintenance warning.
Do not repeat already completed ChatGPT retirement or restore retired endpoints.
Run a fresh real-Google workflow/backup acceptance before admitting anyone; local
fixtures do not prove Google project ownership, OAuth consent or a physical device.
The owner reported the NY certificate still pending on October 24. Calendar dates,
trial expiry and Stripe scheduling can never authorize checkout automatically.

## Held, reversible release sequence

1. **Owner review/merge.** Review the exact PR SHA and checks. Merge only with
   explicit authorization. Approve participant copy/terms, 7 or 14 days, five
   initial reserved/active places, five cumulative admissions, application/start
   window, overall closing timestamp, first administrators, $0 metered-feature
   allowance, retention period and Core-only scope. If changing these choices,
   amend/review the artifacts first. Expansion is a later decision, maximum 20.
2. **Cloudflare Production D1 migration — after merge and separate activation
   authorization.** Target existing Pages project `streamlion`, D1
   `streamlion-google-sessions` (`f9945b40-00ca-4662-9113-585927e31ec0`), binding
   `GOOGLE_SESSIONS`. Sync to exact current merged `main`; record its full SHA.
   Take the existing D1 recovery bookmark and protected-record counts. Export
   only schema definitions and verified stamp values (no sessions/project rows)
   as `{schema:[{name,type,sql}],stamps:{...}}`, then run:

   ```sh
   node scripts/preflight-free-pilot.mjs schema-state.json
   ```

   The exact new marker set is every `streamlion_free_pilot_*` table, index and
   trigger in `migrations/0023_controlled_free_pilot.sql`, including
   `streamlion_free_pilot_schema_v1` with exactly version 1. Only when **every**
   marker is absent and existing Google-session/quota/purchase prerequisites are
   present, apply **that committed file byte-for-byte** through the existing D1
   migration procedure. If all shapes/stamp match, verify and skip. Stop on any
   partial state, extra object or mismatch. Never regenerate/substitute SQL,
   replay a partially applied migration or apply unrelated pending migrations.
   Re-run preflight, read back both policies closed, and confirm protected
   purchase/wallet/project/identity histories unchanged.
3. **Backend deployment — separate authorization.** Deploy only the reviewed
   merged SHA to existing Cloudflare Production Pages/Functions. First keep
   `ENABLE_FREE_PILOT` absent/false and both policy rows closed. No cleanup or
   coordination Worker deployment is required. No Stripe/Google credential,
   provider, permission, AI, tax, credit, saved-card or email setting changes.
   Keep `STREAMLION_CHECKOUT_MODE=paused` and license enforcement true. Capture
   merged SHA, migration result/stamp, authorization checks, exact deployment
   ID and revision, and safe GET `/api/health`, `/api/free-pilot/config`, commercial
   configurations and retired-route 410 checks. Stop on revision/config drift.
4. **Frontend release — separate verification.** Confirm `/release.json` matches
   that SHA, `/pilot/` has no enrollment when disabled, and `/api/welcome` has no
   pilot entry. Verify PWA update and retrieval links. Publishing assets alone
   does not open interest registration or grant access.
5. **Closed QA — explicit authorization, isolated test mode/data.** After policy
   and copy approval, use the existing local/staging route with synthetic data,
   no production bindings. Exercise the matrix below and real Google/physical
   device acceptance under the owner's normal QA process. No email, AI, charges
   or sales tests under this pilot authorization. Share receipts before opening.
6. **Pilot opening — separate explicit owner authorization.** Confirm production
   main still matches review and all prior receipts. Through a separately
   reviewed D1 configuration update set only the approved live policy row and
   verified administrator subjects; keep admissions closed initially. Set the
   existing server-only configuration mechanism `ENABLE_FREE_PILOT=true` and
   perform its separately authorized matching deployment. Check the 64-binding
   runtime limit first; do not buy capacity or remove unrelated bindings. Open
   only `interest_open` when approved, verify honest interest-list copy, then
   separately set `admissions_open` after capacity/dates are confirmed. Approve
   up to five accounts manually; prepare invitations only when notification is
   authorized, then let each participant explicitly activate. No automatic
   replacement. Inspect feedback and costs before any expansion.
7. **Pause/rollback.** Close `interest_open` and/or `admissions_open` to stop new
   registrations/admissions without revoking current access. Individually revoke
   active access if required, with a reason. Use the feature flag only as a full
   pilot-access stop; retain additive records and migrations. Roll back assets
   and Functions together to the prior verified SHA if needed, while retaining
   `STREAMLION_CHECKOUT_MODE=paused`. No DROP, deletion, Google disconnect or
   wallet/order rewrite. Paid access continues through the unchanged paid gate.
8. **Paid sales — independent future approval.** The certificate must actually
   be issued/effective and the existing legal, Stripe tax/cost, paid settlement,
   release and owner/device gates satisfied. This pilot makes no automatic
   checkout change, charge, conversion or promise of purchasing on day 15.

## Validation and limits

- Unit/SQLite handlers: default off/no database touch; separate applications and
  access; duplicate registration; reservation/cumulative caps; invitation binding,
  expiry and CSRF/account/admin checks; explicit activation and durable dates;
  expiry boundaries; reconnect; paid preservation; bounded/audited extension;
  read-only retrieval after expiry; missing/partial schema; $0 legacy AI gate.
- Actual local Workers/D1: five concurrent final-slot approvals produce one
  reservation; five concurrent activations share one durable start/end and one
  audit event. This catches D1's audit-trigger `meta.changes` behavior: use the
  changed row's `RETURNING` result, not an assumed change count.
- Frontend: separate unchecked consents, honest interest-list wording, terms
  confirmation, timezone, expiry/backup/Google retrieval and expiring license
  gate. Desktop/mobile local Chrome fixtures test registration → applied,
  invited → explicit activation, expired retrieval and admin counts. No physical
  device, real identity or actual Google write is implied by fixture acceptance.
- Required repository suite, frontend build, Functions compilation, both unchanged
  auxiliary Worker dry builds, capacity exercise and dependency audit are run
  before the review PR. Record exact results in the PR and task closeout.

Before admission: perform on a physical Android device with a verified second
provider account: sign in, activate, create/save a synthetic project, attach and
retrieve a field record, reload on a second device, reconnect Google, export,
backup/restore, and exercise post-expiry retrieval with writes blocked. Confirm
no existing customer workflow failures. Any failure holds admissions until fixed;
feedback and signups cannot substitute for this proof.

## Review validation receipt — October 24, 2026

Final local result: **1,028/1,028 tests passed**, including the actual local
Workers/D1 concurrency test and offline cold-start expiry regression. Frontend
production build, Pages Functions compilation, both auxiliary Worker dry builds,
capacity exercise and `git diff --check` passed. The first sandboxed full-suite
attempt could not bind the local runtime's sockets; the complete suite was then
rerun with loopback access and passed. No production load/capacity claim follows.

Required `npm audit --audit-level=high` now passes: **0 high, 0 critical**;
3 moderate and 1 low finding remain. Required high findings were already in the
base lockfile. Targeted repair only: Zod 4.6.6, body-parser 2.4.0 and its required
qs patch, Undici 7.30.1/8.12.2 on their existing major versions. No Wrangler or
other broad dependency upgrade. Advisory references:
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[Undici](https://github.com/advisories/GHSA-xjj6-f33q-929c).

Local Chrome synthetic fixtures passed at 390×844 and 1280×900: correct page
identity, meaningful rendering, no framework overlay, no relevant console
errors, registration with marketing unchecked, explicit terms/activation,
expired retrieval guidance and admin counts. No horizontal overflow. Browser
plugin unavailable; used bundled Playwright with installed Chrome. Physical
Android, real second-account OAuth, actual Google roundtrip and post-expiry
retrieval remain the pre-admission gates above. Independent code review found
three issues (offline expiry timer, stale participant status, missing schema
prerequisites); all were fixed with regressions, then re-reviewed with no
unresolved substantive findings.

Changed-file inventory:

| Purpose | Files |
| --- | --- |
| Durable policy, account access and audit | `migrations/0023_controlled_free_pilot.sql`, `server/free-pilot.js`, `server/pilot-access.js`, `functions/api/free-pilot/[[path]].js` |
| Existing access integration | `server/google-auth.js`, `server/ai-pilot.js`, `src/LicenseGate.jsx` |
| Participant/admin UI and disabled landing entry | `pilot/index.html`, `src/FreePilot.jsx`, `src/pilot-main.jsx`, `src/pilot-api.js`, `src/free-pilot.css`, `src/landing.js`, `src/main.jsx`, `vite.config.js` |
| Migration preflight and regressions | `scripts/preflight-free-pilot.mjs`, `functions/api/free-pilot.test.js`, `functions/api/free-pilot-runtime.test.js`, `src/FreePilot.test.jsx`, `src/pilot-api.test.js`, `src/Purchase.test.jsx` |
| Held release, tax-status correction and required security patches | `docs/controlled-free-pilot-release.md`, `docs/checkout-tax-release.md`, `README.md`, `package.json`, `package-lock.json` |

Backend Activation Required: YES — after merge and explicit authorization,
apply/verify migration `0023_controlled_free_pilot.sql` on Cloudflare Production
D1 `streamlion-google-sessions`, deploy the reviewed merged SHA to Production
Pages/Functions project `streamlion`, then separately configure approved policy,
administrators and `ENABLE_FREE_PILOT`. Frontend release, closed QA, pilot opening
and future paid-sales approval remain separate. No pilot backend activation has
been performed during this implementation task.
