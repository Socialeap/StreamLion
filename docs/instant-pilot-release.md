# Immediate Core pilot admission and scheduled reopening — held release

Status: tested implementation for review, not activation. Supersedes manual-only
onboarding only when the owner later selects instant mode. Production currently
has PR124/migration0023 with enrollment disabled. This PR never applies a remote
migration, deploys, changes a live flag, admits a participant or sends a message.
Keep paid checkout paused. StreamLion uses GitHub, Cloudflare, Google and Stripe.

## What changes

A verified Google account can start its free Core pilot while a place is available.
The participant declares professional capture-provider use, supplies minimal fit
and contact information, independently chooses marketing consent, and explicitly
confirms readiness and `free-pilot-v2` terms. The server atomically checks the
displayed duration, and a changed duration requires fresh confirmation. The successful server activation
starts the clock. Identity verification and self-declaration do not independently
verify the person's professional business; there is no AI screening or lookup.

One conditional D1 write consumes both active/reserved capacity and the cumulative
admission budget, then stores the start/end time. Retries reuse the same grant.
An applicant who loses the last-slot race keeps their interest record and receives
no access. Previously admitted expired/revoked users cannot obtain another trial
through a new window, device, Google reconnection or repeated clicks. Existing
manual invitations continue to use their original explicit activation flow.

Paid access remains separate and unchanged. No pilot grant creates a subscription,
wallet, promotional credit, paid license, charge or automatic conversion. Pilot
scope remains manual Core preparation, field records/measurements, Google save,
lookup, exports and handover. Paid AI, brief preparation, hosted speech and client
coordination keep their existing server purchase/cost gates. Cost allowance $0;
no provider calls or email are needed to release this feature. No paid service,
upgrade, auto-recharge or broad deployment is authorized.

## Simple controls — existing `/pilot/` administrator view

Only the existing mode-specific administrator subjects can use these controls.
There is no browser API for adding administrators or changing payment settings.

1. **Maximum active places**: concurrent active trials plus unexpired legacy
   reservations. Reducing the limit blocks new admission until space is available;
   it never removes an existing person's access.
2. **Total admission limit**: all admissions ever released in this pilot, including
   expired/revoked and legacy reserved accounts. It never resets. Raising it
   deliberately releases additional admission capacity. Both limits remain
   bounded by the existing review ceiling of 20, with total limit at least active
   limit and never below recorded admissions. Expansion beyond 20 needs a separate
   implementation/review; no unlimited rolling replacement program.
3. **Add places on a date**: choose N additional admissions and a UTC date/time,
   confirm the schedule, then save. The page shows the stored date/count and
   offers cancellation. Replacing a pending schedule is explicit. Example: total
   budget5 plus a scheduled5 becomes10 once, while an active limit5 still allows
   at most five simultaneous active/reserved accounts.
4. **Pause new trials**: immediately closes admission and cancels pending reopening.
   Interest collection remains independently controlled. **Cancel scheduled
   opening** alone leaves present admission policy unchanged.

Optional notes have useful automatic audit reasons; routine changes require no
SQL or manual reason entry. Advanced duration/mode/window/closing settings are
collapsed after initial configuration and shown for first setup. Dates are UTC,
explicitly labeled, and parsed independently of the device timezone. All changes
are revision-checked: a stale tab must refresh before saving. The complete change
and actor are recorded in the existing D1 service through new policy-audit rows.
Account changes clear the prior account's form, consents and administrator view.

A reopening is a **one-time release of N additional total admissions**, not N
reserved accounts, guaranteed instant places, or automatic waitlist enrollment.
The active cap, existing reservations, full trial duration and approved window
still apply. No notification is sent and no earlier applicant is admitted until
they explicitly start. A due schedule is atomically materialized by the first
server request at/after the UTC time; before that time no participant can consume
those places. No new cron, Worker or background polling service is required.
Requests that pause/cancel do not first apply their own due schedule. Expired or
invalid windows do not reopen. The feature flag and explicit admissions pause
always govern access; dates never enable checkout or reactivate expired grants.

## Landing and participant copy

The selected mint Workflow card appears just after the existing hero, preserving
the sample-job demo. Only fresh, server-validated configuration can show an action.

- Available in instant mode: **Start free pilot**, approved 7/14-day duration,
  Google sign-in, terms and explicit activation. Registration/sign-in alone does
  not start the clock.
- Full only when an otherwise open valid pilot has exhausted active/reserved or
  cumulative capacity: **Update: this pilot group is full.** Then **More pilot
  places are planned. Join the interest list for news of the next opening.**
- Paused, future or closed windows use interest-only copy and do not pretend the
  pilot is full. Disabled/unavailable configuration hides the card. No invented
  countdown, remaining-place count or promise of reopening soon.

The card refreshes on focus and periodically; stale activation links are disabled
while revalidating and removed on an outage. The server always repeats admission
checks. The participant page offers only interest registration when unavailable,
retains separate unchecked contact/marketing choices, and provides the existing
expiry, Google retrieval, backup and optional feedback paths. Existing unadmitted
applicants' current profile/consent choices are saved when starting; an admitted
record is never rewritten by a retry.

## Held release order

1. **Owner review/merge.** Review exact PR SHA/checks, participant copy/terms and
   controls. No merge under the current authorization. Approve initial duration,
   window/closing dates, active limit, total admissions, administrators and the
   existing retention decision before opening. No real admission, migration or
   deployment is needed to review the PR.
2. **Production D1 migration — after merge and separate authorization.** Sync to
   the exact reviewed merged main. Target existing D1 `streamlion-google-sessions`
   (`f9945b40-00ca-4662-9113-585927e31ec0`), Pages binding `GOOGLE_SESSIONS`.
   Capture recovery bookmark, schema/stamps, protected counts and financial
   summaries; do not export customer/session contents. Run:

   ```sh
   node scripts/preflight-instant-pilot.mjs schema-state.json
   ```

   Preflight requires exact 0023 and existing session/quota/purchase prerequisites.
   New markers are all seven added policy columns, policy-audit table, policy
   guard/log triggers and `streamlion_free_pilot_instant_schema_v1` at version 1.
   If every new marker is absent, apply committed
   `migrations/0024_instant_pilot.sql` byte-for-byte only. If every shape/stamp
   matches, verify/skip. Stop on partial/mismatching/extra state. Never regenerate
   SQL, replay partial ALTERs, or apply unrelated migrations. Read back legacy
   policies/grants unchanged, defaults manual/revision 0/no schedule, closed
   opening flags and protected financial histories preserved.
3. **Pages/Functions backend release — separately authorized.** Deploy exact
   merged SHA to Production project `streamlion`. Preserve all runtime settings;
   `ENABLE_FREE_PILOT` remains absent/false, checkout remains paused and existing
   AI/import/speech/cost/credit/provider settings stay closed. No cleanup or
   coordination Worker release, new secret, provider, permission or email change.
   Receipt: full main SHA, migration result/platform stamp, admin authorization
   result, deployment ID/revision, safe `/api/health`, `/api/free-pilot/config`
   disabled response, closed commercial gates and retired-route 410 checks.
4. **Frontend release verification.** Separately verify served `/release.json`,
   hidden landing offer/disabled pilot, PWA update behavior and existing sample
   navigation. Automated fixture screenshots are not real user/device proof.
5. **Closed owner QA.** Exercise verified second-account Google save/retrieval,
   project export/backup, physical Android, expiry and account switching, and
   administrator settings/schedule/pause against authorized synthetic test data.
   No AI, charge, email or real customer workflow writes under release checks.
6. **Pilot opening — separate explicit authorization.** Through the established
   initial administrator/bootstrap process and approved Cloudflare configuration,
   enable the pilot in a controlled state. Configure approved policy/admin subjects
   only, verify schema and role checks, then select instant mode and approved
   limits/dates. Open interest and admissions only after the preceding receipts.
   These controls are safe to review before opening; their existence is not an
   authorization to use Production. Check actual Cloudflare usage before opening.
7. **Rollback/pause.** Use Pause new trials to close admission/cancel schedule;
   preserve current expiries, paid access and Google-owned records. Interest can
   remain open or close independently. Revert matching Pages/Functions assets if
   needed, keeping checkout paused. Retain additive schema/audits and old grant
   history; no DROP, account disconnect, file deletion or wallet/order rewrite.
   Manual mode remains available for controlled invitations. Existing 0023-only
   compatibility applies to manual routes; instant routes require0024's stamp.
8. **Future paid sales** remain independently gated by actual certificate issuance,
   commercial/tax/cost approval, settlement/refund acceptance and explicit opening.

Backend Activation Required: YES — after merge/authorization, apply/verify
`0024_instant_pilot.sql` on Cloudflare Production D1 `streamlion-google-sessions`
and deploy the reviewed merged SHA to Production Pages/Functions `streamlion`.
Instant-mode configuration, frontend verification, owner/device QA and pilot
opening are distinct subsequent gates. No Production change was made here.

## Review validation receipt

- Final full repository suite: **1,071 passed, 0 failed**. New cases cover immediate
  final-slot races, last-slot interest preservation, consent/profile updates,
  stale durations, account switching and delayed replies, paused/future/full
  states, manual compatibility, settings revisions, exact migration preflight,
  one-time scheduled release, pause-at-deadline and paid-access preservation.
- Real local Workers/D1: competing starts yield one last-slot grant and one start
  audit; competing due requests apply the scheduled addition once; active cap
  remains enforced after reopening. External provider calls blocked.
- Production frontend build, Functions compile, both unchanged auxiliary Worker
  dry builds, capacity exercise and diff checks passed. No dependency changes.
  Required audit passes with 0 high/critical; 3 moderate and 1 low remain from base.
- Local Chrome fixtures at 1280×900 and 390×844: available/full landing card,
  checkbox-gated instant start, unchecked optional marketing, saved limits,
  exact UTC scheduled date/N, pause canceling schedule, no page errors or
  horizontal overflow. This does not prove live Google or physical Android.
- Independent review found profile/marketing persistence, applied-migration
  prerequisite and account-switch issues. All were fixed with regressions and
  re-reviewed clean. A later displayed-duration consent safeguard was separately
  reviewed and tested.
- Final read-only Production check still served baseline `dfff752`, with Core
  and credit checkout paused and pilot disabled. This branch has not changed
  Production migration/configuration, deployed code, admissions or messages.
