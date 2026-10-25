# Client project brief entry

The StreamLion landing page's client CTA, **Plan your capture project**, points
to `https://www.frontiers3d.com/directory#project-brief`. The capture-provider
CTA and existing product demos, pricing, starter credits and pilot controls are
unchanged.

Frontiers3D provides a free browser-only, non-AI project brief before signup.
Creation uses browser memory by default. Saving on the device, downloading,
copying reviewed text and publishing a private invitation are separate explicit
actions. Private publishing uploads one immutable reviewed snapshot and selected
recipient to F3D. The client signs in free, chooses a provider email or opted-in
public provider profile, and explicitly copies and sends the generated link.
No email is sent automatically. The named provider must use their verified F3D
account and enroll free before explicitly opening or replying. This F3D
participation needs no Core purchase, paid Studio role or trial. Public listing
is optional; it does not verify or endorse a business or guarantee availability.
Use general details and omit confidential information, addresses and access codes.

Private access lasts seven days. Clients can view/export, revoke or delete their
stored invitations, including expired records awaiting an hourly scheduled purge.
Deletion removes the stored brief and reply; minimal abuse-prevention metadata
is retained for up to seven more days. Shared/downloaded copies cannot be revoked.
Editing a local form never updates a published invitation: revoke and create a
fresh snapshot. Provider links contain a random fragment token; after explicit
Continue to sign in, F3D may keep only that token for up to 30 minutes in the tab's
session storage. Reopen the original invitation link on another device.

## Portable contract

`test/fixtures/client-project-brief.json` is the shared cross-repository example.
Its envelope is `{schemaVersion:1,kind:"streamlion.project",fields:{...}}`.
Only these string fields are exported: `title`, `propertySizeSqFt`, `city`,
`region`, `scope`, `deliverables`, `proposedTimes` and `notes`. Scope composes
space type and intended use. Notes may include general notes and preparation
questions. No prices or confirmed appointments are inferred.

The provider opens **Import saved project details** in the project editor and
chooses the JSON file, or pastes the complete JSON. Existing `parseIntake`
validation handles it without a new import path. The result is a local draft,
subject to the editor's existing device recovery behavior. Importing does not
automatically write to Google or establish an approved scope. The provider must
review it with the client and separately save the project using existing
controls. PDF/text import is a separate existing control.

## Release and verification gates

StreamLion's entry and guidance change is frontend only. It adds no StreamLion
migration, server deployment, configuration, authentication, billing, credits or
AI processing. No Lovable action is required for StreamLion. F3D's separate private
invitation backend must be activated and its frontend served before this CTA
description is released.

1. Review and merge the Frontiers3D brief surface and this StreamLion change
   through their separate review PRs; implementation does not authorize merge.
2. Activate F3D's reviewed backend through its separate approved activation gate,
   then release the Frontiers3D frontend and verify the brief is served at the exact
   CTA target before releasing the StreamLion frontend through Cloudflare.
3. Verify the live StreamLion CTA, both desktop and phone layouts, and JSON
   download/import across the two sites. Check that importing fills the local
   draft and requires review/save, without automatic Google writes. Confirm the
   provider CTA, samples, audio, pricing and pilot remain intact.

Frontend release, production acceptance and owner/device QA remain separate
gates. This implementation does not deploy either site, send email or authorize
live payments or AI spending.

Focused validation:

```sh
node --import tsx --test src/client-project-brief.test.js src/landing-*.test.js
node --import tsx --test src/ProjectWizard.test.jsx
npm run build
```
