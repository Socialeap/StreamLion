# Core refund wording: 14 days, before first delivery — held release

Owner TO-DOs

1. Review this PR and its tests. All commits and the PR title carry `[CF-Pages-Skip]`; preserve that marker in the merge commit so review/merge does not deploy this offer.
2. After review/merge, separately authorize the exact Production configuration and deployment below. Until then leave Cloudflare settings, deployment and checkout unchanged.
3. After an authorized rollout, review the configuration/content receipt before any separately authorized opening of checkout. No real purchase, refund, email or paid-provider test is authorized by this wording task.

## Scope and current baseline

Owner requested: “Please implement the coordinated 14-day refund wording, including the first-delivery exception, and open a PR. Keep checkout paused and leave Cloudflare settings and deployment unchanged pending review.”

This is staged source only. The October 25 read-only Production review observed deployed SHA `a872c25d317d0b06cf8b9de0c484f73e934c35e8`, `STREAMLION_REFUND_DAYS=7`, `STREAMLION_REQUIRE_LICENSE=true`, `STREAMLION_CHECKOUT_MODE=paused`. These are dated observations; re-read them before any later activation. Neither configuration nor deployment is changed by this PR. StreamLion does not use Lovable.

The proposed offer is a full Core app refund requested within 14 days of purchase **and before the provider's first successful project delivery through StreamLion**, including delivery of a Completion Brief. Drafting, editing and agreeing scope are not delivery; client opening or acknowledgment is not required. Earlier buyers retain the terms shown when they purchased, including any longer period and any absence of a first-delivery condition. Mandatory consumer rights are preserved.

Refund requests remain manual via info@transcendencemedia.com. This change neither automates refund approval/denial nor adds a delivery-history entitlement gate. The reviewer must check the purchase receipt/terms and reliable delivery evidence; a failed or pending delivery is not proof of a first successful delivery. Record the policy effective date and the reason for each decision in the existing support process. Do not retrospectively apply the new condition to older purchases. Stripe's resulting full-refund events continue to reconcile access through the existing webhook.

## Changes for review

- `src/refund-policy.js` supplies the same request condition to the React purchase page and hosted Stripe Checkout message.
- `api/welcome.html` updates both static guarantee/FAQ locations to 14 days and the delivery limit. Existing dynamic period updates in `src/landing.js` remain; the exception is visible without JavaScript too.
- `public/api/terms.html` defines first delivery, manual review, earlier-buyer protection and credit-refund separation; `public/api/support.html` links the same condition.
- Existing activation/landing/credit docs describe the new offer and keep activation held. No unrelated seven-day pilot, invitation, draft, session or offline-receipt lifetime changes.
- `scripts/verify-purchases.mjs` defaults to the new 14-day offer with checkout paused; explicit 7/30-day and open checks remain available for earlier offers or a separately authorized launch. The script is a read-only public endpoint probe; normal server throttling/catalog reads may occur, but it creates no checkout.

## Future configuration and deployment — NOT AUTHORIZED by this PR

1. Reconfirm the exact reviewed merged SHA and current serving baseline. Confirm checkout is paused and licence enforcement is true; do not disable either control to test this offer.
2. With separate owner approval, Cloudflare Dashboard → Workers & Pages → **streamlion** → Settings → Variables and Secrets → **Production** → edit the EXISTING encrypted `STREAMLION_REFUND_DAYS` to `14`. Preserve `STREAMLION_REQUIRE_LICENSE=true`, `STREAMLION_CHECKOUT_MODE=paused`, payments mode, webhooks and all other bindings. Do not add duplicate or public `VITE_` settings.
3. Under separate deployment approval, deploy only the reviewed merged SHA with the matching assets/Pages Functions and the updated binding. Setting a Pages secret is not evidence that the serving deployment has it. No D1 migration, auxiliary Worker deployment, new service or upgrade is needed.
4. Record canonical deployment ID/SHA, `/release.json`, `/api/health` ready, and the read-only probe below. Expect `refundDays:14`, `required:true`, `checkoutMode:paused`, `enabled:false`. No checkout should be created.

   ```sh
   node scripts/verify-purchases.mjs https://streamlion.transcendencemedia.com live 14 paused
   ```

5. Check `/api/welcome` (both guarantee locations), `/api/purchase`, `/api/terms`, `/api/support`, JavaScript-disabled/fallback content and phone layout. The first-delivery condition must appear beside the guarantee, and earlier-buyer/mandatory-rights protection must remain in terms. Mocked Checkout tests verify Stripe submit wording without creating a real Checkout session. Only a separately authorized payment test can prove real Stripe rendering/settlement.
6. Keep sales paused until the owner separately approves opening checkout. This PR does not change F3D Publish status or its existing release gates.

## Rollback — requires separate approval

If the coordinated rollout fails, keep checkout paused, restore the exact pre-change refund setting (`7` for the observed baseline) and previously approved copy/source, then redeploy the approved rollback revision. Verify configuration, release and displayed terms together. Restore project settings as well as the serving deployment so a later build cannot silently reintroduce the mismatch. Do not delete purchases, alter refund statuses, disable webhooks or change licence enforcement. Honour every 14-day or more favourable promise already given; rollback changes only future offers.

## Validation

Focused tests exercise the 14-day purchase disclosure, first-delivery language in both landing fallbacks/terms/support, and quoted/hosted Checkout messages for 7/14/30 days. The read-only readiness checker is tested with mocked fetch responses for paused 14-day success, stale 7-day rejection, unexpected checkout opening, and explicitly selected older offers. Full-suite/build/Functions results are recorded in the PR; no live configuration/deployment test is performed during implementation.

The readiness checker requires matching boolean `required` values from purchase config and status. In `live` mode both must be `true`; a missing value, a string, disagreement or disabled enforcement fails the check. Deliberately disabled enforcement remains verifiable in `test` mode. This check supports the configuration receipt; it does not replace authenticated paid/unpaid account QA or the separate exact-SHA release check.
