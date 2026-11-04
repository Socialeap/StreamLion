# Temporary profile-panel QA access

The existing owner workspace QA grant remains owner-only. Do not enroll the second account as an administrator or create a fake purchase.

This change adds a separate, optional Cloudflare production secret `STREAMLION_PROFILE_PANEL_QA`. It admits only the existing production ProfileConnection component, never App children/workspaces, payments, coordination, AI, enrollment, or public Directory access. Existing profile API checks still authenticate and scope all reads/writes to the Google session. No migrations or durable entitlement writes.

## Activation after owner review and merge

1. Release only the reviewed merged revision using the existing StreamLion Cloudflare deployment path. Preserve all existing secrets, public key and bridge flags.
2. Prepare an exclusive-create mode0600 JSON file using the second account's Google subject/email verified from its authenticated production status. Never use a browser-entered identifier or a wildcard. Shape: `{"version":1,"scope":"profile-panel","subject":"VERIFIED_SECOND_SUBJECT","email":"VERIFIED_SECOND_EMAIL","issuedAt":ACTIVATION_TIME_MS,"expiresAt":ACTIVATION_TIME_MS_PLUS_3600000}`. Start the clock at activation, not PR creation.
3. Configure only `STREAMLION_PROFILE_PANEL_QA` in Cloudflare Pages production with that JSON and deploy the same reviewed revision. Required runtime: live payment mode, paused checkout, exact canonical origin. Grant duration at most one hour. Do not alter the primary owner's QA grant, admin policy, purchases, or other settings.
4. In the signed-in second account, verify Profile connection QA shows the same complete ProfileConnection component and no first-account snapshot before/after reload. Profile refresh/connection controls operate only on that account's own cache. Do not approve linking the first provider's F3D identity into the second Google account merely to test isolation. Keep its snapshot empty.
5. Remove the temporary secret and redeploy the same reviewed source after QA. Expiry independently closes the panel and offline access is denied. Confirm the second account returns to normal purchase gating while the first account's snapshot remains intact. No paid calls/searches/AI, new paid services, enrollment, or public Directory opening. No Lovable action is required.

Review/merge, configuration, Cloudflare deployment and live account/device acceptance remain separate gates. This increment prepares the grant mechanism; no temporary access is active from source changes alone.
