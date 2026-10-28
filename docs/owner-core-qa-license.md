# Temporary owner-only Google workspace QA licence

Purpose: permit the verified enrolled owner to perform a bounded Google-backed
Core workspace test while production checkout remains paused. This is not a
purchase, pilot admission, credit grant or permission to test paid client
coordination, AI, speech, email or push. Those existing eligibility and spend
checks remain unchanged.

## Behaviour and constraints

- Default closed. The optional server-only encrypted Cloudflare binding
  `STREAMLION_OWNER_CORE_QA_LICENSE` must contain a valid version-1 grant.
- Only the canonical production origin, live payment mode and paused checkout
  qualify. The grant binds one exact Google subject; the authenticated session
  must have the established owner email. A fresh database read must also confirm
  the same owner remains enabled under the live admin policy. No authorization
  result is cached. Missing configuration, malformed grants and DB errors deny QA.
- The offline preparer issues two hours of access from generation. The server
  rejects any interval longer than 24 hours, future starts and expired grants.
- The scope is `google-workspace`: existing guarded Sheets/Drive/Picker operations
  behind the Core Google proxy. All ordinary upstream restrictions, quotas,
  mutation validation and managed-project protections remain enforced.
- Purchase status stays `purchased:false` and reports only the QA scope/deadline
  to the qualifying account. No payment, tax, wallet or entitlement row is written.
- The workspace displays the QA deadline, closes at expiry and rechecks on focus
  and every minute. QA creates no offline licence and removes an old device
  purchase-cache entry. Server Google access is independently checked per request.
- Existing Google OAuth approval is separate. Expiring this licence does not
  revoke the owner's Google account authorization or delete any Google files.

## Review and activation — HOLD until explicitly approved

1. Review/merge the exact PR. Its `[CF-Pages-Skip]` marker prevents automatic
   Cloudflare deployment. No live licence or access change is made by the PR.
2. Deploy the selected merged SHA's Pages Functions and frontend assets, initially
   without the optional grant. Verify the exact `/release.json`, anonymous denial,
   existing purchased access, and paused checkout. No migration is required;
   neither scheduled Worker requires deployment.
3. Obtain explicit owner approval to activate **two hours**, for the existing
   verified production owner only, covering Google workspace QA. Preparation or
   merge approval is not activation approval.
4. Codex obtains a private read-only operator receipt from the existing production
   owner enrollment, requiring exactly one result. Use this query, without printing
   or committing the returned Google subject:

   ```sql
   SELECT o.mode,o.google_subject,o.email,o.enabled,p.enabled AS policy_enabled
   FROM streamlion_admin_owners_v1 o
   JOIN streamlion_admin_policy_v1 p ON p.mode=o.mode
   WHERE o.mode='live' AND o.enabled=1 AND p.enabled=1
     AND o.email='shakoure@transcendencemedia.com';
   ```

   Extract that single result as an object in a private mode-0600 identity file.
   Compare its subject to the owner's verified current production identity using
   the existing trusted operator evidence. Never choose a subject supplied by a
   form or inferred from an email alone. Stop on missing, duplicate or mismatching
   evidence. Generate the grant only immediately before approved activation:

   ```sh
   node scripts/prepare-owner-core-qa.mjs --identity-file /private/tmp/streamlion-owner-identity.json --out /private/tmp/streamlion-owner-core-qa.json
   ```

   The preparer is offline, refuses wrong/disabled enrollments and existing output
   files, writes mode 0600, and reports only a subject fingerprint and expiry.
   It performs no Cloudflare call and grants no access.

5. Through the existing Cloudflare project controls, add/update **only** the
   encrypted binding `STREAMLION_OWNER_CORE_QA_LICENSE` under **Production**, using
   the prepared JSON. Do not change Preview, secrets unrelated to this grant,
   the licence-required flag, payment mode, pilot policy, checkout, admin grants
   or the Cloudflare plan. Do not use a CLI command that affects both environments.
   Redeploy that same approved SHA to activate the binding. Record the deployment,
   served SHA, grant fingerprint and deadline without exposing the subject/value.
6. Verify the chosen owner's purchase status is still unpaid with the correct QA
   deadline; the online workspace opens; anonymous/other-account QA is absent;
   paid-only AI/credit/client-coordination access and checkout remain denied.
   Use a new explicitly synthetic private workbook for save/readback; preserve
   the owner's previous selection and existing records. No client messages,
   purchases, credit use or real AI requests are part of this acceptance.
7. At completion, remove **only** this Production binding and redeploy the same
   approved SHA. Confirm QA disappears, Core is denied unless independently
   eligible, and checkout stays paused. Preserve the test receipt and review
   any synthetic Google files through ordinary recoverable cleanup controls.
   Independently verify automatic expiry. Delete the task-generated private
   identity/grant files after revocation; never commit their contents.

Automatic expiry works without redeployment. Early configuration revocation
requires removal and redeployment; disabling an existing owner role also stops
QA on the next request, but is **not** the routine revocation method because it
would affect the owner's separate admin access.

## Separate acceptance gates

This optional licence enables the remaining live Google integration check. It
cannot clear the CPU/scale hold, substitute for a representative production
observation window, grant paid coordination privileges, or establish certificate
and physical-device acceptance. Checkout activation remains separately held.

StreamLion uses GitHub, Cloudflare, Google and Stripe. No Lovable action is required.
