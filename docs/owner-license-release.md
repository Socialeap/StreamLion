# Permanent StreamLion owner license

The owner can sign in with `shakoure@transcendencemedia.com` and use Core without purchasing. Production ties the license to the verified Google subject already enrolled as the live owner. The enrollment has no expiration. Removing the license's enabled state or disabling the corresponding owner enrollment removes server access on subsequent checks. Core uses the usual seven-day offline cache. An offline device learns about revocation on its next online check.

The product license applies to enabled workspace, coordination, brief preparation, AI, speech and extension routes. Existing feature switches, paid-provider approvals, provider budgets, Google permissions, and credit holds still govern those features. Complimentary credits share the existing wallet and can pay for enabled AI, speech, and other eligible shared-credit charges such as coordination. They are audit-logged goodwill, so they create no sale, Stripe order, paid customer count, or customer starter credits. The proposed lifetime cap is 800 credits (10,000,000 credit micros). It counts all complimentary credits previously granted to this Google subject, including reversed or spent credits. There is no reset or automatic refill. This credit denomination is distinct from actual provider cost.

## Release sequence

1. Review the PR, the 800-credit lifetime cap, and the shared wallet behavior. Verify required GitHub checks before authorizing merge. The draft grants no access and ships no migration.
2. After separately authorized merge, verify the exact merged SQL and source. Confirm the Cloudflare Pages Production project and its existing `GOOGLE_SESSIONS` D1 binding. Capture the recovery bookmark, exact schema definitions, version stamps, and counts of purchase, credit order, entitlement and grant records. Review the recorded verified Google subject privately and require an exact match across the account and enabled live owner enrollment. Stop on identity ambiguity, deployment drift, partial schema, or conflicting history.
3. For separately authorized Cloudflare backend activation, pass the private schema-only snapshot to the preflight below. With `pending`, apply the merged `migrations/0028_owner_license.sql` exactly once through the existing Cloudflare D1 operator connection. With `already_applied`, skip replay. Any error requires stopping for review. Repeat preflight and verify an exact schema stamp and trigger definitions, no enrollment created by the migration, and unchanged payment and credit records. Use a D1 SQL transport and record its migration history accurately. A direct SQL execution is distinct from native Wrangler migration history.

   ```sh
   node scripts/preflight-owner-license.mjs PRIVATE_SCHEMA_JSON
   ```

4. Under the authorized server deployment, ship the merged Cloudflare Pages Functions. Under the separately authorized frontend release, ship the matching assets. Cloudflare Pages may package them together. Verify the exact served revision and default denial before enabling the owner license. Coordination maintenance runs through Pages Functions. No separate scheduler, new binding, secret or Stripe action is required for this release.
5. Only after explicit production entitlement approval, pass the verified subject and approved lifetime cap as parameters to the following D1 statement. Require a successful insert and verify the single active license and its effective subject and cap. Stop if the subject already has a license record, the statement returns zero changes, or any result differs from the approved scope.

   ```sql
   INSERT INTO streamlion_owner_licenses_v1
     (mode, google_subject, enabled, granted_at, credit_cap_micros)
   VALUES ('live', ?1, 1, CAST(unixepoch('subsec') * 1000 AS INTEGER), ?2);
   ```

6. After verifying the live entitlement and separately approving the grant amount, use the current Admin Portal's **Add free credits** for this owner account with recent verified owner authentication and its single-use confirmation. Use at most the lesser of remaining lifetime and existing grant-policy limits. If live grants are paused or recent verification is unavailable, stop before issuing credits. Verify the goodwill audit receipt, restricted credit policies and unchanged paid balances and order counts. The allowance does not activate providers or authorize paid provider testing.
7. After Codex verifies the live deployment and account binding, sign in with the owner account on desktop and phone and verify the workspace opens without checkout. Verify another unpaid account remains denied and review the complimentary balance in admin. Exercise only enabled features under the existing provider policies. Review any real provider use separately.

To revoke only the product license, set `enabled=0` on the exact matching license row through the authorized D1 operator connection. Keep the enrollment and grant history. Restore unused credits from failed requests through the existing reservation settlement path. Verify online denial unless an independent entitlement exists and verify the license is no longer visible in the purchase status response.
