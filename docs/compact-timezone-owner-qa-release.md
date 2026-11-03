# Compact time-zone controls and approved 72-hour owner QA

Manual time-zone search/selection and its help are inside a closed-by-default “Choose a different time zone” disclosure. The project-location suggestion stays visible and the current saved/manual zone remains visible outside the disclosure. Suggestion copy is shortened; visible GeoNames/CC BY attribution is preserved. No fields or selected zones are reset by opening or closing the disclosure.

Workspace-only owner QA now permits an explicitly configured maximum of 72 hours, enforced on the server and recognized by LicenseGate. The offline preparer accepts --hours 72; default remains two hours. The separate coordination scope retains its two-hour maximum. Existing owner enrollment/account binding, online-only access, role revocation, exact expiry, paused-checkout requirement and paid-feature restrictions remain unchanged. There is no automatic renewal or purchased-access grant.

The owner explicitly approved one 72-hour workspace-only QA window on November 3, 2026. No additional generic activation approval is needed for that scope. Source review/merge remains required before deploying the updated guard; the current live code rejects windows above 24 hours.

## Activation after merge

1. Verify this PR is merged, CI passes and the exact merged SHA is built. Confirm Production checkout paused and pilot disabled; record the existing deployment and configuration fingerprint.
2. Read the single verified enabled Production owner enrollment through the established operator query in docs/owner-core-qa-license.md. Require its subject fingerprint to match the prior trusted receipt (00b368ed5efc0b28). Stop on absence, mismatch, duplicates or disabled owner/policy. Do not print or commit identity/grant values.
3. Immediately before activation, run the merged preparer with --identity-file <private mode-0600 operator input> --out <new private grant path> --hours 72. Verify scope google-workspace, duration exactly 259200000 milliseconds, live mode and canonical origin.
4. Update only encrypted Production STREAMLION_OWNER_CORE_QA_LICENSE on Cloudflare Pages project streamlion. Preserve all unrelated settings; do not change Preview, checkout, pilot, admin roles, metered controls, Workers or Stripe. Deploy that exact merged SHA's Pages/Functions and frontend to Production. No migrations are required.
5. Record provider deployment receipt, served SHA, unchanged unrelated configuration, health and paused/disabled gates. Verify owner-only QA status where an authenticated route is available; retain owner Android confirmation as a separate gate. Report the exact 72-hour deadline in America/New_York. Delete private temporary files. Do not silently renew at expiry.

Rollback: previous frontend can display 72-hour access incorrectly, so prefer fixing forward while preserving the approved grant. If server code is rolled back to the old cap, the 72-hour grant will be denied; report that loss of QA access rather than weakening guards. Preserve all purchased entitlements, Google files and payment/refund processing. Removing only the QA binding revokes this grant; it does not remove a purchase.

Backend Activation Required: YES — after reviewed merge, update Production STREAMLION_OWNER_CORE_QA_LICENSE and deploy the exact merged SHA to Cloudflare Production Pages/Functions streamlion. Owner authorization for this bounded activation is already recorded; merge remains the prerequisite.

No Lovable action is required.
