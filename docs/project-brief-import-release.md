# Create Project: paired ChatGPT preparation and import

The Start page keeps two numbered actions in one card: prepare the project brief
in the user's ChatGPT account, then bring the resulting project file back. The
return button reveals the native .json file chooser first, followed by the
clearly labelled paste alternative and Use these details. Focus moves to the
file chooser. Closing/reopening the panel retains pasted text during that editor
session. Copy explains uploading source documents to ChatGPT, downloading its
project file, and reviewing the imported steps before saving.

The ChatGPT URL/prompt and extraction schema are unchanged. Upload/paste uses the
same schema validator, project-step review and local draft handling. Unreadable,
oversized or malformed files report an error and keep existing fields/drafts;
the chooser resets so the same file can be selected again. Importing does not
invoke Save, write a Google project or call an AI provider. The malformed-JSON
message now correctly directs users to bring ChatGPT output into StreamLion.

## Release classification and separate gates

1. **Review/merge:** owner review and passing required verify. No merge is
   authorized by this PR. Commits use [CF-Pages-Skip] to prevent automatic
   Cloudflare release without skipping GitHub CI.
2. **Migration:** none. No D1 schema, grants, policies, records or balances change.
3. **Configuration:** none. Preserve pilot modes, settings, secrets and quotas.
4. **Functions:** no handler change or backend activation is required. The shared
   project-schema module changes only the import parser's error copy; that parser
   is used by ProjectEditor, not server handlers.
5. **Frontend release:** HOLD until merge and explicit owner deployment approval.
   Publish the approved merged SHA's assets through the existing Cloudflare
   workflow and verify release.json. Use the normal PWA update; do not clear
   storage or rewrite drafts to deliver this layout change.
6. **Owner/device QA:** after release, check Create Project's two actions, file
   chooser and paste alternative on the actual phone. Use a disposable draft;
   review imported details before saving. Existing production projects, drafts,
   selections and pilot settings must stay intact. No paid AI, email, checkout,
   sales activation, upgrade or spending is needed.

## Scoped validation

Full local suite: 663 tests passed. Build: Vite/PWA and extension passed.
New flow tests cover paired actions and control order, successful file/paste
imports without saving, paste retention across collapse/reopen, and preserved
drafts after invalid/oversized/unreadable files. Existing manual entry, wizard
navigation, ChatGPT handoff, draft/recovery and backup checks pass.

Local synthetic browser checks covered native file selection and paste import,
mobile widths 320/390 and desktop width 1280. Both routes open populated review
steps, section navigation works, and no horizontal overflow or console errors
were observed. No production records, settings or external ChatGPT conversation
were used. Physical phone file-picker acceptance remains a post-release check.
