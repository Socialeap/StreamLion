# Workspace access recovery

The owner’s recorded two-hour Google workspace QA grant expired at November 2, 2026, 9:12:28 p.m. America/New_York. The supplied screenshots are later. Production was serving reviewed SHA 1137422451a8ee66f4e75acef64f6b66e62e8e36; checkout remained paused and pilot disabled. Read-only enrollment verification found the enabled owner with zero paid orders. Google sign-in succeeds, but licensed workspace operations correctly return 402 after QA expires.

The defect is the recovery UX: workbook restoration called a StreamLion entitlement rejection a Google failure, offered reconnection and a misleading ready/saved-workspace state, and left navigation looking usable behind a closed access gate.

## Change

- Classify persistent-session Sheets 402 as WORKSPACE_ACCESS_REQUIRED, with safe access guidance that preserves the Google session and local drafts.
- The opener labels this as workspace-access review, removes the false ready and saved-workspace promises, and stops futile automatic online retries for entitlement denial.
- A gate-confirmed blocked purchase panel explains that signing in again cannot restore access, offers an explicit access recheck without OAuth, and disables protected navigation while retaining backup/account options. Standalone purchase pages and legitimate paid/pilot/QA access keep their existing navigation behavior.
- In-session owner QA expiry explains the expired window and retains a route to backup options.

Customer copy is shown whether checkout is open or paused. An account with no active purchase gets “Let’s check your account”, a reminder to use the purchasing Google account or check a pending payment, and a support route without requiring another purchase. Only a server-reported succeeded refund gets “Your refund is complete” and an explanation that access from that purchase ended. Both paths preserve backup and Google-file retrieval guidance. No refund is inferred from a generic denial.

Purchased Core access has no age-based expiry. A submitted, pending or failed refund does not itself revoke it; a successful full refund does. Existing reconciliation can also suspend an order for a payment dispute, while a wrong Google account or unconfirmed payment can prevent purchase verification. These are distinct from the owner's temporary QA window. No commercial access rule is changed here.

No server entitlement, authentication, data retention, purchase, pilot or checkout policy is changed. No automatic renewal, paid entitlement or browser bypass is added.

## Verification

The new integration regression reproduces a signed-in remembered workbook returning 402, verifies honest opener guidance, follows access review into the held gate, verifies disabled navigation cannot navigate, and confirms drafts/workbook selection and device backup remain available. Existing tests cover paid recovery, active pilot access, bounded online-only owner QA and expiry. Full npm test: 1,237 passed, zero failures/skips. Build and diff checks passed. Physical Android QA remains separate.

## Release

Review and merge this PR, then separately authorize exact merged frontend deployment to Cloudflare Production streamlion. No migration, server function, secret or provider configuration is needed for the interface correction. Keep checkout paused, pilot disabled and metered holds unchanged. Verify served SHA and health, then test Android/PWA expired-access and restored-access paths. Roll back frontend assets only, preserving customer records and payment/refund processing.

Owner separately authorized one fresh two-hour QA window on November 2. That activation updates only Production STREAMLION_OWNER_CORE_QA_LICENSE and redeploys the currently reviewed 1137422 revision; it does not include this interface change. Record the final deployment receipt in the workspace artifacts, require the original owner identity fingerprint, preserve unrelated configuration, and do not silently extend the new deadline. No public sales or pilot access is authorized.

Backend Activation Required: NO for this source diff. The separately approved QA grant requires its own Production configuration/deployment receipt.

No Lovable action is required.
