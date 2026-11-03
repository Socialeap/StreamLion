# Owner-only intake and text AI QA

This is a disabled-by-default test path, not a purchase or pilot. It preserves
the existing workspace grant and accepts a separately configured coordination
window, plus a separately configured, workbook/project-bound text AI window.
The former lasts at most two hours and the latter at most 30 minutes; both
must expire no later than the existing workspace grant. The AI window permits
one provider attempt, including failure or cancellation. Its reservation is
recorded in the existing legacy pilot ledger, with its existing wallet, daily
and cumulative limits. This is internal reservation accounting, not an OpenAI
billing cap. No voice is authorized by this path.

## Hold for review and merge

After review and merge, use the exact merged SHA. These instructions do not
open checkout or the free pilot. No database migration is required. Do not
alter purchases, wallets, payment/refund processing, provider credentials,
the workspace grant, or global AI/credit flags. Do not replace the workspace
grant with the coordination grant. Stop if the real owner enrollment, current
workspace grant, selected synthetic workbook, project identity, provider
billing visibility, or existing D1 ceilings cannot be verified. If the
workspace window expires before the test can finish, stop; do not extend it.

1. Verify the deployed SHA, production owner identity and active workspace
   window from the existing signed-in session and server records. Confirm
   checkout paused and free pilot disabled. Verify existing coordination
   availability and check the current legacy AI policy, owner wallet, daily
   and cumulative reservation totals. Confirm access to actual OpenAI usage
   reporting before any model call; the owner's total provider allowance is
   $1, not a per-call guarantee. Record current usage, model pricing/limits and
   stop if the planned one-call cost could exceed the remaining allowance.
2. Prepare the existing `scripts/prepare-owner-core-qa.mjs` with verified
   owner identity, `--coordination`, and a duration of at most two hours that
   fits inside the existing workspace window. Store its private output only as
   Cloudflare Production Pages `streamlion` secret
   `STREAMLION_OWNER_COORDINATION_QA`. Deploy the reviewed merged Pages/Functions
   SHA, verify the new served SHA and recheck both holds. Preserve the existing
   `STREAMLION_OWNER_CORE_QA_LICENSE` unchanged.
3. Use a private synthetic workbook and a clearly identified fictional client.
   Create a synthetic intake form and complete the real client wizard, provider
   review and mutual confirmation. Do not send email, invite a real client,
   publish an actual offer or enter customer information. Verify the provider
   can see the completed brief and its exact saved project ID, and verify the
   Google record independently. Confirm no purchase or credit grant was made.
   If any step fails, record it and stop rather than simulating success.
4. With the verified owner-identity and current workspace-grant files stored
   privately, prepare the AI grant offline using the exact synthetic workbook
   and project IDs:

   ```sh
   node scripts/prepare-owner-ai-qa.mjs --identity-file /private/path/owner.json --workspace-file /private/path/workspace-grant.json --workbook-id SYNTHETIC_WORKBOOK_ID --project-id SYNTHETIC_PROJECT_ID --out /private/path/one-use-ai-grant.json --minutes 15
   ```

   This creates a mode-0600 file with a unique server-selected request ID and
   prints only the owner fingerprint and expiry. Set only its content as
   `STREAMLION_OWNER_AI_QA` in Cloudflare Production Pages `streamlion`, then
   deploy the same reviewed SHA. Check holds, grant expiry, workbook/project,
   and owner-only AI availability. Turn read-aloud off. Ask exactly one useful
   question grounded in the saved brief. A failure or cancelled request counts
   as the one attempt; do not create another grant without re-evaluating the
   owner's allowance and recording the reason. Check the response against the
   real workbook, including exclusions and unresolved facts; record provider
   usage when available without exposing keys or private project data.
5. Remove both temporary QA secrets from Production Pages and redeploy the
   same SHA to activate removal. Verify owner AI is unavailable, unpaid
   coordination is closed, workspace access retains its original deadline,
   checkout is paused, pilot is disabled, and normal paid access and payment
   confirmation remain available. Keep the synthetic files clearly labeled.
   Report the exact SHA, timestamps, single-attempt ledger state, actual
   provider usage/availability, screenshots and any unverified behavior.

If a deployment, provider or validation check fails, stop calls, remove the
temporary secrets and redeploy a previously verified Pages revision with
current safe production bindings. Preserve Google files, purchases, webhook
processing, refunds and the existing workspace deadline. A successful local
test or deployment is not evidence of a live model answer.
