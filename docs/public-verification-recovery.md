# Public request email-verification recovery

A public work-order request can be stored while its confirmation email is
skipped by the test-recipient allowlist. It then remains outside the provider's
submitted-request list. Previously, after its 20-minute challenge expired, the
only supported public-form instruction was to start over, creating another
request. The generic client sign-in action did not verify or synchronize this
pending public submission.

## Recovery behavior

- The existing same-origin `client/request` action checks the supplied email
  against the encrypted recipient for the existing job. Existing IP and job
  rate limits still apply. A mismatching email queues nothing. Expected recovery
  eligibility denials return the same generic HTTP 200 response and queue nothing;
  unexpected infrastructure/programming errors still surface as failures.
- An already verified request awaiting Google synchronization uses normal one-use
  sign-in when its cookie was lost. Validate the provider, request lifetime and
  recipient before queuing; a subsequently paused form does not revoke access to
  this verified request. Preserve its original answers and operation.
- For an unverified public request, renew only its email challenge. Retain the
  original job, operation, fingerprint, access hash, encrypted answers, created
  time and 30-day request deadline. Do not create a generic sign-in challenge,
  client session, Google project or credit charge at this stage.
- Require an active form, valid provider grant and paid test/live entitlement,
  an open request with saved answers, available email quota and an approved
  test recipient. Never extend the request's lifetime or bypass verification.
- Use a conditional update to prevent concurrent renewals from generating
  independent challenges. Reuse an unexpired queued/accepted/delivered
  challenge; preserve skipped or failed outbox rows and enqueue a fresh notice
  when an explicit recovery request requires it. A retry after an interrupted
  enqueue uses the same newly stored challenge.
- The client follows the one-use email link and presses Verify. The existing
  verification and coordination engine then synchronize the original answers.
  The original writer lock, idempotent append checks and credit policies apply.
- New verification receipts expose a recovery link containing only the opaque
  job ID, not a project-access capability. Opening it still requires the same
  email and successful email verification. No automatic resend runs on load.
- Reject unapproved recipients before creating a new verification-required
  submission. The browser retains the entered answers and displays the error.

## Validation

Offline tests cover full field preservation through renewal, email verification
and Google synchronization; mismatched email; concurrent renewals; expired-token
invalidation; skipped-notice history; revoked/refunded providers; inactive forms;
closed/expired requests; blocked recipients; indistinguishable eligibility-denial
responses; lost-cookie sign-in before synchronization (including a paused form);
one resulting request/event and no
credit spend. UI coverage checks the recovery receipt, retained answers and no
second form submission. Providers and email delivery are synthetic in tests.

## Separate release checkpoints

1. **Code review and merge — HOLD.** This branch is a review candidate, separate
   from the brief-import fix. No merge is authorized by the email QA request.
2. **D1 migration — not required.** Existing public-submission, outbox and
   challenge schemas are sufficient. Do not edit production submission state,
   fingerprint, payload, token expiry or verification flags manually.
3. **Configuration.** The owner confirmed privately saving the complete prior
   `RESEND_TEST_RECIPIENTS` list plus the authorized QA recipient on October 17.
   Cloudflare cannot return its encrypted value, so recipient preservation is
   based on that confirmation. Keep it a Production Secret. Do not replace it
   from a guessed list; do not change any other setting or quota. Saving project
   configuration is not proof that the running deployment uses it.
4. **Functions deployment — HOLD for merged main and release authorization.**
   Deploy the merged coordination handler and notification helper. Retain every
   effective pilot/QA switch and encrypted binding; do not replace runtime
   settings with repository defaults. No auxiliary Worker release is required.
5. **Frontend release — HOLD separately.** Release the matching public-form
   receipt UI. A Pages upload carries Functions and assets together, so both
   checkpoints must be cleared before that upload.
6. **Zero-spend post-release checks.** Verify the served revision, closed sales,
   unchanged pilot/AI/importer gates, request count, original saved payload and
   free email quota before initiating a resend. No checkout, AI call, quota
   increase, plan upgrade or load test.
7. **Authorized email QA and readback.** Use the existing request's recovery URL
   and its original email. Queue one fresh verification notice within the free
   quota, confirm actual inbox delivery and signed webhook reconciliation, then
   verify through the ordinary client control. Compare every saved field with
   the client portal/provider readback, including exact long-text contents.
   Require one Google job/event lineage and one completed submission; retain
   the historical skipped notice. Stop on any mismatch or uncertain write.

The production QA request was still awaiting verification, with one stored
encrypted payload and no duplicates at the investigation checkpoint. Its
printed PDF clips long text fields, so it cannot independently establish every
character. Full production field readback and actual delivery remain release
QA evidence, not claims made by the mocked tests or this review PR.
