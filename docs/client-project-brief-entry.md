# Client project brief entry

The StreamLion landing page's client CTA, **Plan your capture project**, points
to `https://www.frontiers3d.com/directory#project-brief`. The capture-provider
CTA and existing product demos, pricing, starter credits and pilot controls are
unchanged.

Frontiers3D provides a free browser-only, non-AI project brief before signup.
Creation uses browser memory by default. Saving on the device, downloading and
sharing a reviewed copy are explicit client actions. Clients bring their own
provider; there is no automatic matching, verified invitation, guaranteed
availability or cloud-private project record in this flow. Use a general
location and omit confidential information; an exact address or access code is
not required.

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

This is a frontend-only entry and guidance change, with a contract fixture and
tests. It adds no migration, server deployment, configuration, authentication,
billing, credits or AI processing. No Lovable action is required.

1. Review and merge the Frontiers3D brief surface and this StreamLion change
   through their separate review PRs; implementation does not authorize merge.
2. Release the Frontiers3D frontend and verify the brief is served at the exact
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
