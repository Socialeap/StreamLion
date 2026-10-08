# Restricted coordination and email pilot

The owner authorized setup and an email pilot to `info@transcendencemedia.com`
on October 7, 2026. Use `notifications@streamlion.transcendencemedia.com` as
the sender; it is a sending identity, not an inbox. A mailbox is not required
for sending. The pilot ceiling is 20 attempts per UTC day and 500 per calendar
month, counting retries. Web Push remains disabled pending separate keys and
physical-device acceptance. No live payment mode, AI call, paid upgrade or
automatic recharge is approved by this activation.

## Recorded baseline

Setup used merged main `bf17ab945cf23d914bbb3d0a4610cf5c7ba9e348` (PR #60).
Cloudflare Pages deployed that SHA. Exact preflights classified 0009, 0010
and 0011 as pending; each committed migration was imported separately and
then verified before proceeding. All schema stamps are 1, both policy rows
remain inactive, and purchase/order/wallet/turn counts and purchased-wallet
aggregates matched before and after. The old in-flight AI allocation count
was zero. This records database preparation, not pilot acceptance.

| Migration                             | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `0009_client_coordination.sql`        | `9ac7b5803962d24f9bf985d3bfd7386939ba87bf20bf78d61a06b466b9db1ee5` |
| `0010_coordination_notifications.sql` | `216d41372bf3cccd3149be5e862199a040fc07cb417e7b6fa7a5d9a2b8ab2622` |
| `0011_coordination_efficiency.sql`    | `d796404dbd8c6ecc1aba29875dd95ea6c0d7f54639a54ef8167d845dd3665543` |

Resend verified the sending domain. Its approved webhook listens only for
`email.delivered`, `email.bounced`, `email.complained` and `email.failed` at
`https://streamlion.transcendencemedia.com/api/resend-webhook`. Pages stores
`RESEND_FROM_EMAIL`, `RESEND_TEST_RECIPIENTS` and `RESEND_WEBHOOK_SECRET` as
encrypted settings, alongside the existing `RESEND_API_KEY`. The missing
web CNAME was restored to `streamlion.pages.dev`; existing mail records were
preserved. The dedicated Worker was deployed disabled with the same D1
binding and a one-minute cron, then configured with matching test modes and
public Google settings.

## HOLD — merge and configure the scheduler signing key first

This activation change prepares the Wrangler-managed coordination/email
flags in Pages and replaces direct Worker maintenance with a signed request
to Pages. Google, Resend and optional VAPID credentials remain only in Pages.
The relay requires no D1 binding or copies of those credentials. An active
D1 policy, complete configuration and successful deployment remain separate
requirements. Push remains disabled; payment/credit modes stay unchanged.

1. With explicit owner approval for this new credential, generate one random
   32-byte hexadecimal `COORDINATION_SCHEDULER_KEY` and store it as an
   encrypted secret in Pages production and `streamlion-client-coordination`.
   It authorizes only the fixed maintenance callback. Preserve all existing
   Google/Resend credentials in Pages; do not retrieve, duplicate or rotate
   them. Do not expose the scheduler key in source, chat, logs, receipts or
   preview builds. This procedure is not credential-creation authorization.
2. Merge the activation PR, sync current merged main and record its SHA.
   Check the exact schema/stamps with the three committed preflight scripts.
   All must report `already_applied`; stop on missing or partial state and
   use the original migration procedures rather than inventing repair SQL.
3. Verify both running modes in Pages are still `test` and all required
   notification/Google settings are present. Pages' sender and sole test
   recipient must match the identities above. Confirm click/open tracking
   is not enabled. Keep both D1 policies inactive during configuration checks.
4. Verify the automatic Pages production deployment and its separately
   published frontend identify the new merged SHA. Deploy only the dedicated
   relay Worker from that same checkout with
   `npx wrangler deploy --config ops/wrangler-coordination.jsonc`.
   Its source configuration removes the old D1 binding and obsolete public
   Google/mail settings. Preserve encrypted secrets, unrelated workers,
   payment settings and source records.
   Record the exact Pages deployment and Worker version.
5. Check `/release.json` for that SHA. GET `/api/resend-webhook` and
   `/api/coordination-maintenance` must return 405. An unsigned JSON POST
   with `{}` to either must return 401 after its signing secret is active,
   without sending mail or accepting work. Inactive-policy coordination
   reads must still return 503. These checks consume no AI or email credits.
6. After those prerequisites pass, enable only the test policy with
   `UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='test'
AND active=0;`. Re-read both rows: test must be 1, live must remain 0.
   Do not change project/starter pricing, existing AI policy or any balance.
7. The provider explicitly enrolls a synthetic workbook/folder through the
   authenticated portal's Google consent flow. Use the purchased test account
   and only the approved inbox for invitations. Prove arrival, single-use
   verification, signed delivery receipts, duplicate confirmation without a
   second debit, revoked/expired access and two-account/client isolation.
   Do not use real project content, purchases or AI questions for QA.

Keep configuration, merge, backend activation, frontend release and live
acceptance separate in the receipt. Mail API acceptance is not inbox arrival
or client approval. Existing Google key copies are not needed for this relay.
Keep the test policy inactive until the prerequisites pass. Pause this
pilot by setting the test policy to 0; preserve queued notices and records.
Push installation, permission and correct-job opening on iPhone/Android are
a subsequent acceptance gate.

## Scheduler authorization

The relay sends one HTTPS request per minute to the fixed production Pages
origin and `/api/coordination-maintenance` path. It signs the exact URL,
method, timestamp, random nonce and raw JSON mode with a purpose-specific
HMAC-SHA256 context. Pages rejects altered, unsigned, wrong-mode or more
than 120-second-skewed requests before database or provider work.

After normal coordination readiness checks, atomic claims in the existing
`streamlion_coordination_rates_v1` table reject reused nonces and limit work
to one batch per mode per minute. Its existing cleanup retains metadata for
at least 24 hours, longer than the signature window. No migration is added.
The callback accepts no job IDs, arbitrary commands or client-selected files.
Existing durable recovery, notification ceilings and delivery locks still
govern the work. Relay logs contain only status and allowed aggregate counts.
It follows no redirects and waits at most 55 seconds; a failed or uncertain
batch waits for a new signed request on the next cron run.
