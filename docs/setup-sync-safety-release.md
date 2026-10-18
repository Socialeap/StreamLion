# Setup sync safety review

This follow-up fixes three issues in merged PR #106 without changing the
backend schema, server handlers, Google grants, records, drafts, balances or
pilot modes.

- Local setup snapshots carry the Google subject that owns them. Switching
  accounts keeps the displaced snapshot under a separate device key and selects
  only the new account's own local/remote copy. A late connection-restore result
  cannot replace a more recently selected workspace.
- Older device-only snapshots have no trustworthy owner. They are retained
  locally and never uploaded automatically. On a blank account, the assistant
  offers an explicit **Use this device’s setup for this account** action. This
  supports a first-time Google sign-in without silently assigning another
  provider's unowned answers. No existing server record is rewritten by a
  migration or background repair.
- Saves are serialized, retain failed snapshots for retry, and report success
  only for a receipt from the expected account. **Finish later**, **Go to
  Projects**, and **Create my first project** await queued/in-flight saves.
  **Save & finish** waits for its completed snapshot to save. Failed saves keep
  the device copy and leave the assistant open for retry. A closed browser or
  interrupted request still relies on that local recovery copy on next open;
  unload-time network delivery is not guaranteed.
- Review-only reopening is a view, not a persisted edit. Opening review or
  selecting **Review answers** does not change completion status or updatedAt.
  Confirmed edits still save normally.

## Separate release gates

1. **Code review/merge:** this PR is stacked on PR #107's wording branch,
   `codex/setup-persistence-copy`. Review PR #107 first. After it merges, retarget
   this PR to `main` and require passing checks on that base before merging this
   follow-up. No merge is authorized by this implementation. Commits use
   `[CF-Pages-Skip]` without `[skip ci]` so GitHub CI runs while Pages deployment
   is suppressed.
2. **Migration:** none added or replayed. Existing migration 0018 belongs to the
   previously released account-setup capability; this fix does not reapply it.
3. **Configuration:** none. Preserve secrets, Google grants, sales restrictions,
   AI/importer settings, QA allowances and pilot modes.
4. **Server deployment:** no server or Worker changes; no separate backend
   activation is required for this fix.
5. **Frontend deployment:** hold for approval after the exact merged SHA is
   known. Deploy only through the existing Cloudflare release process.
6. **Owner/device QA:** after an authorized frontend release, use isolated mock
   accounts to verify A → empty B → A isolation, interrupted-save retry and
   reopening a completed review without changing its completion state. Repeat
   cross-browser restoration/newer phone edit as a post-release check. Do not
   overwrite real branding/pricing, create checkout, invoke AI or spend.

No Lovable action is required.
