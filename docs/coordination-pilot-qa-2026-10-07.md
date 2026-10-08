# Coordination pilot acceptance — October 7, 2026

Paid public rollout remains on hold. These checks used one purchased **test-mode**
account, a new private Google workbook/folder, synthetic job details, and only the
approved `info@transcendencemedia.com` email sink. No real purchase, client payment
or AI request was made. Local tests, live acceptance and physical-device proof
remain separate.

## Verified deployment and acceptance

- Merged source and the served Pages release were
  `dd2be7ccd97bc497c780dceb1da121b71b5b1909`; Pages deployment
  `3f702807-9f17-47f3-8208-71ab91c70f1d`.
- The dedicated signed relay was deployed from that source as Worker version
  `afbbc793-40c8-4b68-bbf6-1d3ad5b33a32`. Its signed callback returned 200 with
  bounded maintenance counts. Unsigned callbacks returned 401. Cron jitter can
  produce a second call in one minute; the minute-slot guard rejects it with 409.
- Exact `0009`, `0010` and `0011` preflights reported `already_applied`.
  No migration was repeated. Only the test coordination policy was activated.
  The live policy remained inactive.
- An invitation arrived in the approved Gmail inbox. The signed Resend webhook
  independently recorded `delivered`. A consumed one-time link rejected reuse.
  Reloading the authenticated client portal restored its authorized job.
- Client intake, submission, mutual approval, Google-backed save/readback,
  material scope proposal/acceptance, an operational-change acknowledgement,
  clarification/answer and delivery/acknowledgement worked through the live UI.
  A stale provider write was rejected. The UI disabled delivery while an access
  update needed acknowledgement.
- First activation reserved and completed one 3,000,000-micro promotional spend
  (240 credits). Purchased allocation was zero. The purchased balance remained
  10,000,000 micros; the promotional balance became 4,500,000 micros. These are
  sandbox balances, not a real monetary charge.
- A synthetic PNG was uploaded into the QA Drive folder. Metadata showed only
  an owner permission; both roles saw the authenticated shared-file route.
  Browser automation did not capture a completed download, so downloaded-byte
  verification is still pending.
- Clarification and delivery acknowledgement worked at a measured 390 CSS-pixel
  viewport without horizontal overflow. This does not prove installed mobile
  PWA behavior or notification display.
- Closure made the client brief read-only and recorded the exact 90-day
  retention deadline. Reasoned reopening returned the job to work without a
  second spend. The reopened synthetic job was then cancelled with an audit
  reason. All 19 coordination operations completed; none remained pending.
- The QA Google background connection and client grant were revoked. Reloading
  the previous client session no longer exposed the job. The provider's original
  `StreamLion Projects` workbook and `StreamLion` folder were restored and
  verified while the ordinary Google connection remained connected. QA files
  remain private audit records. Both test and live coordination policies are
  now inactive.
- The final outbox contained five delivered and fourteen skipped notices, with
  no queued work. The recorded daily allowance was 20 attempts and was preserved.
  Blocked recipient retries account for the gap between attempts and delivery;
  the source fix below prevents those future budget claims.

## Notification fix and optional push preparation

The live test exposed a budget issue: non-allowlisted provider notices never
reached Resend but consumed attempt capacity and retried. The dispatcher now
checks recipient eligibility before claiming the daily/monthly budget. Blocked
notices become terminal `skipped` receipts with their contact payload removed.
The final send still enforces the allowlist. Previous attempt/budget history is
preserved. Atomic limits, retry identities and the approved ceilings stay intact.

The regression tests place a blocked notice ahead of allowed mail with a one-send
budget, verify that allowed mail still sends, test direct-send rejection and prove
that previously attempted blocked notices stop retrying. The focused notification
and actual Workers-runtime checks passed 18/18.
The frontend build, Pages Functions compilation and synthetic capacity check
also passed. The capacity check made no real provider calls; it does not establish
production concurrency or device performance.

This PR also prepares the Wrangler-managed `ENABLE_WEB_PUSH=true` flag for the
selected optional PWA workflow. Push still fails closed without a valid matching
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` in Pages. It never
subscribes a device automatically. The owner approved a new matching P-256 pair
and `VAPID_SUBJECT=mailto:info@transcendencemedia.com`. All three names were saved
as encrypted Pages production settings and read back by name; temporary local
key material was removed. No keys are committed or copied to the relay.

The currently served baseline still has push disabled. The saved settings and
prepared flag need the next reviewed, merged Pages deployment. Device permission
and actual notification display remain separate acceptance steps.

## HOLD — after this PR merges

1. Verify the merged main SHA in the automatic Cloudflare Pages deployment and
   `/release.json`. This change requires the updated Pages Functions; it needs
   no migration or relay redeployment. Verify the frontend release separately.
2. Preserve the test-only modes, exact recipient allowlist, 20/day and 500/month
   attempt ceilings, existing signing/encryption keys and historical counters.
   Do not reset the exhausted QA allowance or enable the live policy.
3. Verify the three already-saved VAPID setting names in Pages production and
   deploy the merged Pages release with those settings. Do not regenerate or
   rotate the pair. Preserve Google, Resend and scheduler secrets.
4. Reactivate the restricted test policy and enroll an isolated QA workspace only
   when the next bounded acceptance run is authorized. Verify blocked notices
   are skipped without new budget increments and allowed notifications send
   when the existing daily/monthly allowance permits.
5. Test explicit device opt-in, denied permission, updated service-worker
   capability, a neutral alert opening the correct authenticated job, routine
   email fallback, unsubscribe and revocation. Use real iPhone and Android
   installations for device proof. Do not accept a push-service response as
   evidence that a notification appeared on the device.

Remaining acceptance includes two purchased test-account isolation, independent
client grants, actual Google access-token renewal, appointment entry/readback on
the target devices, completed attachment download, natural retention/reminder/
Drive archive recovery and commercial cancellation/refund/retention terms.
Fake-clock tests cover expiry/archival paths; the live 90-day archival deadline
must not be shortened or database records edited to manufacture a live result.
Original Google records are retained; cold restoration after deletion and
automatic compaction are subsequent work.
