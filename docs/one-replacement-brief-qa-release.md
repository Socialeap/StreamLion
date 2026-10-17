# One replacement brief QA attempt — review only, activation held

This amendment prepares **one** replacement attempt using existing test credits:
8 credits (100000 microUSD) per completed brief, USD 0.10 API reservation, and the
original expiry **2026-10-18T00:46:02.266Z** (October 17, 2026, 8:46:02 PM EDT).
It does not authorize merge, deployment, activation or a real AI call.

The private owner and original start **2026-10-17T00:46:02.266Z** stay unchanged.
The separate replacement approval defaults false. Missing approval retains the
original behavior; invalid approval, shifted dates, or an invalid failed-job
baseline closes replacement access. This grant cannot renew into another window.

All three original failed jobs remain intact and counted. The exact test policy
for an approved amendment is price/reserve **100000**, daily/total reservation
ceilings **400000**, daily request ceiling **4**. The USD 0.40 journal ceiling
includes the original USD 0.30 of failed reservations plus exactly USD 0.10 for
one fourth job; it is not USD 0.40 of new API permission. Live policy and wallets,
starter grants, Google records, project drafts and other pilots stay unchanged.

Both preflight and the atomic INSERT require the original three test jobs to be
failed, have no result, belong to the same approved owner, use only purchased
test credits at the original price/reserve, and fall in the original window.
All test-mode history counts toward the four-job/USD 0.40 lifetime ceiling.
Concurrent new IDs cannot reserve a fifth job. Failure refunds the replacement
credits once but consumes the single attempt; successful replay/recovery never
invokes the model again. Expiry/revocation and existing scope/license checks are
rechecked immediately before inference. No model, tier, input/output limit or
automatic retry changes are included.

## Separate release checkpoints

1. **Code review/merge — HOLD.** Review this PR, its exact SHA and required
   `verify` check. No merge is authorized by preparation of this amendment.
2. **D1 migration — none.** Do not replay 0016 or alter any table/trigger. The
   existing schema permits the exact policy values above.
3. **Configuration/policy — HOLD for explicit activation authorization.**
   Verify the private owner, existing original window, three failed/refunded
   jobs, unchanged test balance and inactive live policy. Keep replacement
   approval false. If policy is exactly the original active 3/300000 policy,
   execute committed `ops/approve-brief-qa-replacement.sql` byte-for-byte via D1
   with bound parameters `[verified_private_google_subject, operator_Date_now_ms]`.
   Never interpolate an email, client input or credential. Exactly one policy
   row should change. If already exactly 4/400000, verify history and the existing
   receipt instead of applying again. Stop on unexpected or partial state.
   Do not delete/rewrite jobs, replenish balances, reset usage or change dates.
4. **Functions deployment — HOLD for merge and explicit authorization.** Release
   only the merged amendment SHA with replacement approval false. Preserve the
   existing two owner-QA runtime switches and all other settings. Git/Wrangler
   has false defaults: use only an explicitly authorized runtime override when
   retaining the original window; never duplicate plain flags as Secret bindings.
   Verify closed anonymous access and authenticated no-spend configuration.
5. **Frontend release — HOLD for explicit authorization.** Release matching
   assets, verify `/release.json`, accept the ordinary PWA update and preserve
   storage. Keep a copy of unsubmitted source text before updating.
6. **Replacement activation/owner QA — HOLD.** Only after checkpoints 1–5 and
   explicit activation approval, set the plain runtime switch
   `STREAMLION_BRIEF_IMPORT_QA_REPLACEMENT_APPROVED=true` for Production and
   release the same merged Functions with that approved switch. Preserve the
   original private subject/start/until and existing public importer flags false.
   Check owner config: 8 credits, **1 of 1** replacement attempt, original expiry.
   Anonymous/non-owner access must remain closed; sales and conversational Ask AI
   stay closed. Do not invoke AI during activation checks. The owner may then
   prepare the synthetic brief once, review/fill empty fields and save the mock
   project explicitly. A failure or timeout uses recovery, never a fresh paid ID.
7. **Closeout.** Verify history, credits/refunds and at most one new reservation.
   The grant ends at exhaustion or the original expiry. Disabling the replacement
   switch closes new work and keeps authenticated recovery. No reset, extension,
   recurring grant, upgrade, checkout, new credential or email is part of this work.

## Validation

Mocked Responses and real local D1 cover one additional preparation, competing
request IDs, idempotent replay/recovery, exactly-once failure refunds, unchanged
old history, fixed expiry, approval revocation, policy/baseline races, malformed
settings and owner isolation. The held policy SQL is exercised with bound params,
including wrong owner, expiry and repeat application. UI tests show one attempt
and the original expiry. No production activation or inference is used.
