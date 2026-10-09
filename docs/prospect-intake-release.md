# Public capture forms and work-order progress

## Behavior

Providers create a **reusable public form link and local QR by default**, without
knowing a prospect's project name or email. The same link can be shared on a
website, social media, ads, messages or business cards. Each submission creates
an independent Google-owned request and private status page; the public link
continues accepting other prospects. Creating the form creates no empty job.
Providers can pause/resume each saved public form and optionally require email
confirmation. These choices persist in D1 and are enforced on the server.

The form opens directly to the estimate and work-order fields. Email is optional
unless the provider enables confirmation. Anonymous submissions receive a
random private status capability, separate from the public form token. The
status URL keeps its secret in the fragment, then exchanges it for a secure,
HttpOnly, SameSite cookie and removes the fragment. Anyone with that private
status link can access that one request; prospects must save it. Public forms
never expose existing jobs, contact details, files or finances. A per-visit
server-sealed timestamp records the form open for the resulting request without
an identity claim or analytics fingerprint.

Optional confirmation uses the existing 20-minute emailed link and cannot be
bypassed by changing client-side fields or a provider's later preference change.
Confirmation and anonymous submission are idempotent and preserve the original
encrypted operation through Google interruptions. Provider/client reads and
scheduled recovery reconcile pending saves before returning the private job.
Transient copies are cleared after the signed append-only Google event completes.
The server recomputes estimates and rejects client-supplied financial fields.
There is no credit charge, work agreement or payment at intake submission.

Private invitations to a known email remain an explicitly selected option.
Legacy one-prospect invitation links from 0012 remain compatible and require
verification; they are distinct from the default reusable public form.
Project naming and other required details remain agreement blockers.

Providers can decline a pre-agreement request with an optional response and an
optional email. The default sends no decline email; the client's status page
shows Declined and the response, or a neutral default when no response was given.
Declined access ends after 30 days, then the existing archive process retains
Google history and the private archive. Anonymous or unverified contact emails
receive no automatic client update mail; only an explicitly selected decline
email can be sent. Existing email budgets and QA recipient restrictions apply.

Unaccepted public requests expire after 30 days and enter the same archive
process. Agreed work is excluded from request expiry. Declined/expired records
are read-only; a provider correction reopen records a fresh 30-day request period.
Pending unconfirmed submissions expire without creating a Google work order.
Open-request limits remain 100 per workspace, with 20 saved reusable forms,
20 submission attempts per IP/hour and 100 per public form/hour. No CAPTCHA,
paid anti-abuse service or infrastructure upgrade is introduced.

The named **Transcendence Media · spatial capture** estimate is explicitly
provider-selected, never the global default. It matches the reviewed Jotform
262396366448167: whole-number square footage × USD $0.15 through 5,000,
$0.12 at 5,001–19,999, $0.10 at 20,000+, plus optional six-hour/$900 Creative
Direction. Blank/invalid area produces no quote. The server recomputes the
estimate from the pinned preset; submitted prices and provider-only financial
fields cannot set it. Estimates do not authorize work, charge a deposit,
set the agreed fee or confirm availability. Jotform remains a reference only.

Both parties see seven independently recorded milestones: opened, submitted,
agreement, work completed, payment, delivery and finalized. Payment can precede
work; amounts remain explicitly provider-reported, not bank-settlement proof.
Completion and delivery are distinct. Newly agreed scope reopens completed
work. Cancellation/archive are explicit, rather than successful finalization.
Help, notifications, templates and recovery disclosures follow the action area.
Core's Client requests link now shares the sidebar controls' layout and styling.

## Diff and activation classification

**HOLD — source review and explicit approval of this PR's merge and activation
are required. Approval of PRs #68–#71 does not approve this new release.**

This changes frontend components, Cloudflare Pages Functions and maintenance
logic, adds D1 migration **0013_public_intake.sql** and depends on the previously
merged **0012_prospect_intake.sql**. It reuses local QR encoding and the
test-only decoder. Google headers, secrets, OAuth scopes, provider grants,
payment modes, credit pricing and email/spend ceilings are unchanged.
No Lovable action is required. StreamLion uses GitHub and Cloudflare.

The existing `streamlion-client-coordination` Worker is an unchanged signed
cron relay. Its source/configuration does not change; recovery logic lives in
Pages Functions, so this diff requires **no relay Worker redeployment**.

1. Record the approved PR head and eventual merged `main` SHA. Inspect only
   D1 schema definitions and version stamps in `streamlion-google-sessions`
   (`f9945b40-00ca-4662-9113-585927e31ec0`, production `GOOGLE_SESSIONS`).
   Preserve prior financial/policy counts and balances using aggregate-only
   read-only queries. Do not export sessions, encryption keys or project data.
2. Build `{ "schema": [...], "stamps": {...} }` from `sqlite_master`
   `name,type,sql` for `streamlion_%` objects and each schema table's actual
   version row. Run **`node scripts/preflight-prospect-intake.mjs <inspection.json>`**
   from the approved source. It verifies all 0001–0011 prerequisites and
   compares the exact committed 0012 definitions.
3. These five new named markers must be **all absent** for `pending`:
   `streamlion_prospect_links_v1`, `streamlion_prospect_challenges_v1`,
   `streamlion_prospect_challenge_expiry_v1`,
   `streamlion_prospect_claim_pending_v1`, `streamlion_prospect_schema_v1`.
   Only then apply the committed migration byte-for-byte through Cloudflare's
   migration facility. Record its SHA-256 and platform receipt. `already_applied`
   means skip. Any partial marker set, mismatched definition or version stamp
   means stop; never synthesize repair SQL or replay previous migrations.
4. Reinspect and require `already_applied`, schema stamp `1`, and preserved
   prior policy/financial aggregates. The schema is additive and creates no
   invitation, Google grant or spending by itself. It may be staged from the
   approved PR head before automatic production deployment; activation still
   waits for approved merge and all required CI.
5. After 0012 is complete, inspect again and run
   **`node scripts/preflight-public-intake.mjs <inspection.json>`**. It verifies
   exact 0001–0012 prerequisites. The four 0013 markers are
   `streamlion_public_forms_v1`, `streamlion_public_submissions_v1`,
   `streamlion_public_pending_v1`, `streamlion_public_intake_schema_v1`.
   Apply committed **0013_public_intake.sql** byte-for-byte only when all four
   are absent and the result is `pending`. Skip `already_applied`; stop on
   partial state, definition or stamp mismatch. Record SHA-256/platform receipt,
   then reinspect and require `already_applied`, schema stamp `1`, and unchanged
   financial/policy aggregates. No secret or Google grant change is needed.
6. Deploy only Pages project `streamlion`, including its frontend and existing
   Pages Functions, from that exact approved merged `main`. No secret rotation,
   provider setting, broader function/Worker deployment or unrelated data
   change is required. The old email invitation path remains compatible; new
   share invitations fail closed while 0012 is unavailable; default public forms fail closed while 0013 is unavailable.
7. Record main SHA, migration/preflight/hash/platform result, Pages deployment
   ID/SHA and separate frontend revision. Perform no-send health checks: public
   availability, malformed/unknown prospect token rejection, and authenticated
   provider status `shareLinks: true` and `publicForms: true`. Existing unauthenticated release checks
   must pass. Preserve test-only purchases and live-payment/AI-cost approval
   flags as false.
8. Independently verify a fresh synthetic invitation and first-open status,
   estimate boundary, email verification, exact Google history readback,
   provider/client milestone agreement, revocation and QR scanning after deploy.
   Use only the already-authorized QA workbook/folder/grant and approved inbox
   `info@transcendencemedia.com`; otherwise require the owner's specific approval.
   Keep the existing 500/month cap and temporary **test-only** 40/day allowance
   through `2026-10-12T04:00:00.000Z`, automatically reverting to 20/day.
   No new paid service, live payment, AI call, automatic recharge or extra spend.
   The app must continue to fail closed on missing authorization/configuration.

Rollback: restore the previous approved Pages revision while retaining additive
0012 schema and Google history. The old app cannot consume new unclaimed links;
pause their distribution and preserve pending submissions for recovery. Do not
delete Google history, drop schema or rotate the token encryption key.

## Acceptance evidence and limits

Final source validation: **500 tests passed**. The app/extension build and
Cloudflare Functions compilation passed. Earlier 0012 validation passed 486 tests, the unchanged relay dry-run and
synthetic quota/history exercise; that dependency audit reported zero vulnerabilities.
The new PR repeats those CI checks against its exact head. The quota/history
exercise makes no external provider calls and does not establish live capacity.

Local synthetic browser QA exercised an unnamed/email-free invitation with
retained contact/company, no premature editor, a rendered QR, unverified first
open, USD $1,650 for 5,000 sq ft with Creative Direction, email verification,
and provider/client submitted readback retaining the exact `12 7/16 in` scope.
The real rendered SVG QR is decoded in the UI test and must equal the full
invitation URL, including its fragment. Desktop viewport was verified at
1280px; provider mobile at 390px and Core navigation at 360px had no horizontal
overflow. Four disclosures remain below the action area. Core's navigation
control matches adjacent controls without an underline.

Security tests use SQLite transactional batches and mocked Google/email only:
concurrent competing claims/replays; revoked/expired/closed/disconnected/refunded
denial; pre-addressed email restriction; forged finance/price rejection; isolated
provider creation/list/revoke; unchanged request-mode retries; exact migration
preflight; interrupted durable Google recovery and maintained retry backoff.
Work-state tests distinguish completion/delivery and reopened scope.

PR #72 review regressions also verify that a provider-prepared request can be
claimed after submission, clarification or provider approval. Verified claims
reset both approvals while preserving identity, role and accepted-work guards;
repeated synchronization writes only one claim event and spends no credits.
Reopening corrections clears completion and delivery timestamps, so completing
and delivering the corrected work records the new cycle's times. These fixes
add no migration or configuration beyond the existing 0012 release plan.

These are source/local-browser checks, **not live activation, real email,
physical-phone QR/device acceptance, production capacity or launch readiness**.
The prior physical-device/download and operator/capacity acceptance gates
remain separate. Obtain the deployment receipt and deployed synthetic readback
before calling this feature live.

Public-intake acceptance adds anonymous independent submissions and isolated
private status capabilities; optional confirmation and preference changes;
interrupted original-operation recovery; paused/refunded-provider denial;
workspace limits; silent/emailed decline and 30-day expiry; exact 0013 preflight.
Local synthetic browser QA confirms direct form opening without login or email,
the named USD $750 / 5,000 sq ft estimate, no-email submission, retained exact
`12 7/16 in` scope and private status opening. Desktop 1280px and phone 390px
layouts remain separate from real device and deployed Google/email acceptance.
