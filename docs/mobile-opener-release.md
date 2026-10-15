# Mobile opener review and release gates

This change opens StreamLion with the approved forest-paper composition, the
existing six workflow illustrations and lion identity, and the exact tagline:
**Condensing Capture Work into an End-to-End Workflow**.

All six icons are fully visible by 395 ms. The first pull starts at 3100 ms,
giving viewers a 2.705-second hold. The final pull ends at 3730 ms; the tagline
starts at 3780 ms and is fully visible at 4080 ms. Account controls remain
available throughout. Reduced motion, missing assets and unsupported animation
use the static composition. The illustrations are optimized local WebP files
(52,338 bytes combined), derived from the owner's existing craft-winch assets.

## Account and preservation contract

- A new user can sign in or sign up through the existing Google flow, or enter
  the device workspace. Required purchase checks still guard the workspace.
- A returning, verified account sees its email and opens Projects with one
  click. OAuth callbacks retain their existing routing.
- **Sign out on this device** deletes only the current authorization session.
  It preserves records, workbook-scoped drafts, other devices and coordination
  grants. **Disconnect Google** remains a separate, broader action.
- An encrypted, HttpOnly workspace bookmark can restore workbook/folder
  selection only after Google independently verifies the same subject. It
  cannot authorize API access or select another account's workspace. Session
  and selection responses deliver it before sign-out, covering a lost
  sign-out acknowledgment. Privacy pages describe this essential cookie.

## Local validation

- 578 tests pass, including first entry, returning account, license gating,
  expired/cancelled sessions, sign-out failure, draft preservation, account
  isolation and lost-response recovery. The test harness emits React act
  warnings; there are no failed, skipped or cancelled tests.
- Production app/PWA and extension build, Pages Functions compilation and local
  capacity verification pass. Both auxiliary Worker dry-run builds pass and the
  dependency audit reports zero vulnerabilities. Capacity evidence is local,
  not a production SLO.
- Built-app browser QA uses a separate local origin and synthetic APIs with no
  provider forwarding. New/device entry, returning Projects, sign-out and
  reconnect preserve the exact synthetic draft and records without writes.
  Animation inspection confirms visible icons and hidden tagline at 1500 and
  3000 ms, hidden icons/tagline at 3730 ms, and visible tagline at 4200 ms.
- Integrated browser reduced-motion emulation stalled the automation tool;
  that runtime check and physical Android/iPhone/PWA acceptance remain open.
  Closing the isolated local QA tab clears its temporary viewport/media state.

## Separate release gates

1. Review this PR. Its commit uses `[skip ci] [CF-Pages-Skip]` to suppress hosted
   Actions and Cloudflare builds; local evidence is not hosted CI evidence.
   Do not merge or deploy under the current authorization.
2. Obtain explicit merge/release authorization. The diff contains frontend
   assets and a Pages Function auth-handler change. Release the matching Pages
   frontend and Functions together; merging main may automatically deploy.
   No D1 migration, new secret, provider setting or environment change is needed.
   No Lovable action is required; StreamLion releases use GitHub and Cloudflare.
3. After an authorized release, verify the deployed SHA, pilot modes, checkout
   pause and webhook reconciliation separately. Do not activate sales or AI.
4. On a physical phone, verify new and returning account entry, same-account
   reconnect, exact draft preservation, reduced motion, installed-PWA cold
   start and install guidance using disposable QA records only.

This PR does not change production records, drafts, pilot modes, live settings,
sales activation or provider spending. It does not deploy either auxiliary
Worker.
