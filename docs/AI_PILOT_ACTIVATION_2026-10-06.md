# AI pilot setup receipt — 2026-10-06

This is setup evidence, not live-provider or Android acceptance.

- Approved source: merged main `5592edd0c6c7a548957fdc915b89bc6c34b75502`.
- Exact migration: `migrations/0007_streamlion_ai_pilot.sql`, Git blob `215d2293235f5a2cc0431ad6183543eaf5866ace`.
- Existing D1 database: `streamlion-google-sessions`, production `GOOGLE_SESSIONS` binding.
- Preflight: all eight AI objects absent; Google prerequisite schemas 0001–0003 and version markers matched the committed definitions. The historical database has no `d1_migrations` table. Purchase schemas are outside this AI installation and were not changed.
- Applied only the committed 0007 file through Cloudflare D1 execute: success, nine queries, final bookmark `00000047-00000006-000050fc-07d16aad07b28fef6998226754600c78`. No Wrangler migration stamp was created or fabricated.
- Postflight: all eight AI object definitions matched the committed migration; fresh policy inactive, budget zero, no wallets and no paid attempts.
- Separate authorized staging: one verified test account received 187,500 micro-USD of manual test credits (15 completed answers). Policy remains `active=0`, price 12,500 micro-USD, daily attempt cap 30, daily estimated provider reservation budget 180,000 micro-USD. The second account needs a fresh Google connection before an identity-bound grant; no placeholder wallet was created.
- Both required provider keys are encrypted Secrets on Pages project `streamlion`; their values were not retrieved.
- Owner authorized a $1 provider-spend allowance for at most 30 supervised test attempts. Daily limits reset; the operator must track the session total and disable the policy after testing. Manual test credits have no real-money customer value.
- Safe production checks before the activation PR: config reported disabled; answer returned 503 while the feature flag was false; ledger recorded zero paid attempts.

## Remaining gates

1. Review/merge the activation PR and verify its exact Cloudflare production deployment SHA. No merge is implied by this receipt. The PR changes the feature flag and documentation, plus MCP dependency pins for GHSA-6qxp-vccf-f47h (client 2.2.0 and SDK 1.31.0). Provider secrets, migration SQL, application code and customer pricing are unchanged.
2. Verify authenticated config is still disabled with policy inactive after deployment. Do not activate if either key, selected synthetic workbook or schema is invalid.
3. Start the supervised test session by setting policy `active=1`; verify only approved wallets can use the pilot. Reconnect the second account and grant its 15 answers once from its authenticated immutable Google subject.
4. Test real GPT text, Kokoro audio, accuracy, timing, cancellation, failures, isolation and deductions within the approved total allowance. Record results and provider usage; setup/CI alone proves none of these.
5. Set policy `active=0` when the session ends, on errors requiring investigation, or before leaving the pilot unattended. Existing calls may finish. Refresh and test the installed Android PWA separately.

No Lovable action is required. Use the existing GitHub/Cloudflare release path.
