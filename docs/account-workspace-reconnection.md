# Account workbook reconnection — deployment HOLD

After a verified workbook selection, StreamLion remembers the default workbook for
the verified Google subject, not the email address or a browser-supplied identity.
Another signed-in browser with an empty selection checks Google access and opens
that workbook. An already-selected workbook remains unchanged. Sign-out preserves
the preference; explicit Google disconnect removes it for future reconnection.

The preference grants no access. Existing purchase/pilot/owner-QA checks, Google
credentials, quotas and Google file permissions remain in force. Restoration only
uses fixed Google API hosts, never follows redirects, and cannot resurrect a
signed-out session or replace a concurrent explicit selection. Missing/revoked
access opens selection guidance; temporary failures preserve the preference for
retry. No project, note, measurement, credential or purchase is stored in this table.

The additive migration seeds only accounts whose unexpired sessions agree on one
nonempty workbook. Ambiguous historical choices require one explicit selection.
After that selection, subsequent new browsers reconnect automatically. A missing
migration preserves legacy operation; it does not count as an activated fix.

## Required live changes — not authorized by implementation approval

1. Owner reviews and merges the PR. Its `[CF-Pages-Skip]` title keeps automatic
   release held. Record the actual merged main SHA; stop on unexpected runtime
   changes. No Lovable action is required.
2. Only after explicit Cloudflare activation authorization, inspect production D1:

   ```sql
   SELECT name,sql FROM sqlite_master
   WHERE name='streamlion_account_workspace_v1';
   PRAGMA table_info(streamlion_account_workspace_v1);
   ```

   Preflight prerequisites: existing `streamlion_google_sessions_v1` has
   `google_subject`, `workbook_id`, `folder_id`, `session_hash`, `expires_at`.
   The sole new marker is `streamlion_account_workspace_v1`. When absent, apply
   **only** committed `migrations/0027_account_workspace.sql` byte-for-byte using
   the existing Cloudflare D1 controls. Record its SHA-256, D1 execution receipt
   and platform migration stamp if the project uses migration tracking. Do not
   run unrelated pending migrations or invent substitute SQL.

   Reviewed migration SHA-256:
   `bc3a893c7d938114f413dee6704f301571b0cfa65c8c81c7672a68e5ce2b73c5`.

   If the table exists, compare its exact committed schema: subject TEXT primary
   key NOT NULL; workbook/folder TEXT NOT NULL DEFAULT ''; updated_at INTEGER NOT
   NULL. Exact state means skip reapplication and backfill. Partial/mismatched
   state means STOP. Never drop a preference table to replay migration/backfill.
3. After schema verification, deploy the reviewed merged SHA's Pages Functions
   through Cloudflare. Preserve the current encrypted owner-QA grant and every
   unrelated binding, payment/catalog setting, Preview setting and scheduled
   Worker. The migration is backward compatible with the old app. No new secret,
   owner role, Google scope, Stripe write or provider activation is required.
4. Frontend release is a **separate held gate**, requiring explicit authorization.
   Cloudflare Pages commonly uploads functions and frontend together: if a
   combined deployment is proposed, obtain approval for that exact scope first.
   Never treat PR merge or database migration as public-release approval.
5. After approved activation/release, verify the exact served SHA and provider
   deployment receipt, healthy database, and paused Core/credit checkout with
   pilot/AI unchanged. Use the existing valid owner-QA window or another explicitly
   authorized eligible identity; this change never extends a QA deadline.
6. Owner/device QA: select a private synthetic workbook on device A; sign in with
   the same verified account in a clean device B browser (no selection cookie).
   Confirm automatic reconnection and exact project/note/measurement readback.
   Sign out/in on B and confirm the default survives. Test another account and
   revoked-file recovery with isolated fixtures; do not revoke business-file
   permissions. Preserve pre-existing selections, records and drafts.

Spend ceiling: **$0 external spend**; no purchases, credit issuance/use, paid AI,
speech, email, push or client delivery. Existing provider/quota checks fail closed.
Sales and public launch remain held throughout this rollout and QA.

Receipt must include merged SHA, migration hash/result/platform stamp (or explicit
not-applicable explanation), exact schema preflight, deployment ID/source SHA,
separate frontend-release status, safe health/hold checks and device QA results.
Rollback to prior source can retain the additive table and preferences; never
delete customer records or revert another operator's newer production work.

## Design references

The preference uses an atomic subject-bound UPSERT after external validation,
adapting the isolation and short-transaction advice in *Supabase PostgreSQL Best
Practices*, pp. 5, 7–8 to SQLite/D1. No PostgreSQL RLS assumption is made.
Identity isolation, resource-access checks and server-side session invalidation
follow the testing guidance in *OWASP Web Security Testing Guide v4.2*, pp. 57–59,
67–68. Actual behavior is covered by local D1-compatible SQLite and route tests.
