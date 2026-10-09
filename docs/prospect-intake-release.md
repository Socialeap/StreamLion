# Prospect invitations and work-order progress

## Behavior

Providers can create a one-prospect link without a project name or known email,
add contact/company details, and share its URL or locally generated QR through
their usual messaging app. An optional starting email restricts the invitation
to that address. Starting details remain associated with the selected request;
only **Start another invitation** clears them. Selecting or reloading a request
shows its current identity and the service version pinned to that request.

An unclaimed request initially shows invitation guidance and progress instead
of an empty editor. Providers can explicitly prepare its brief themselves.
The public link exposes only branding and pinned service wording/questions,
never the existing private brief, contact details, files or financial records.
It expires after 30 days and can be revoked before claim. A rendered form open
is recorded once and labelled unverified until email verification. An ordinary
GET/unfurl does not record an open. This is an observable form-open signal,
not proof of the intended person's identity or an analytics fingerprint.

Prospects request an estimate, describe capture/access/scheduling/handoff,
and verify the emailed 20-minute link. Verification atomically assigns one
client and queues the original submitted fields into the existing signed,
append-only Google history. Competing/replayed challenges cannot create a
second client session. Google interruptions retain the original operation;
private reads/mutations reconcile it first, and scheduled recovery backs off.
Temporary claim payloads are erased after verified durable completion.
Project naming and other required details remain agreement blockers.

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
logic, adds D1 migration **0012_prospect_intake.sql**, and adds local QR encoding
plus a test-only decoder. Google headers, secrets, OAuth scopes, provider grants,
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
5. Deploy only Pages project `streamlion`, including its frontend and existing
   Pages Functions, from that exact approved merged `main`. No secret rotation,
   provider setting, broader function/Worker deployment or unrelated data
   change is required. The old email invitation path remains compatible; new
   share invitations fail closed while 0012 is unavailable.
6. Record main SHA, migration/preflight/hash/platform result, Pages deployment
   ID/SHA and separate frontend revision. Perform no-send health checks: public
   availability, malformed/unknown prospect token rejection, and authenticated
   provider status `shareLinks: true`. Existing unauthenticated release checks
   must pass. Preserve test-only purchases and live-payment/AI-cost approval
   flags as false.
7. Independently verify a fresh synthetic invitation and first-open status,
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

Final source validation: **483 tests passed**, including **75 focused intake,
workflow and rendered-portal checks**. App/extension build, Cloudflare Functions
compilation, unchanged relay dry-run and synthetic quota/history exercise passed;
the dependency audit reported **zero vulnerabilities**. The quota/history
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

These are source/local-browser checks, **not live activation, real email,
physical-phone QR/device acceptance, production capacity or launch readiness**.
The prior physical-device/download and operator/capacity acceptance gates
remain separate. Obtain the deployment receipt and deployed synthetic readback
before calling this feature live.
