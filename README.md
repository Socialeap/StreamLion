# StreamLion

Google-owned project workspace for spatial capture providers. The PWA prepares visits, records field evidence, and tracks handover; Google Sheets/Drive own the saved business records. Ordinary ChatGPT can interpret a brief or discuss a dated project snapshot using the customer's own account. This version implements the field contract, PWA editor, Google browser adapter and plugin instructions. Google configuration and mobile voice acceptance remain required before the connected workflow is ready for users.

## Run

Node 22.12+:

```sh
npm ci
npm test
npm run build
npm run dev -- --port 4174
```

## Workflow

Create a project from a brief or the basic details. ChatGPT returns a project file for review and import; it does not need a Google connection for this path. Save the project and open its home: Prepare → On site → Before leaving → Delivery. Add area-specific notes, photos, or voice memos in the PWA. Ask provides common facts immediately or copies the actual selected project snapshot for ordinary ChatGPT. No private desktop plugin or owner-paid model API is required.

Named unfinished drafts appear in Projects on the device where they were started. Project names, cities, visit dates and details review status appear in the list, with Edit and Delete actions. Delete moves a saved project to a restorable section and retains Google revision history and field notes. The details status does not indicate whether site work is finished.

- [Provider workflow and release checks](docs/provider-workflow.md)
- [Google setup and activation](docs/google-setup.md)
- [Current architecture and limits](docs/google-owned-plan.md)
- [Field map](docs/field-map.md)
- [JSON fixture](fixtures/project-intake.json)
- [Plugin source](plugin/skills/instructions/SKILL.md)
- [ChatGPT in-chat prototype](docs/chatgpt-inline-prototype.md)

Google access tokens stay in memory. Project drafts and the original local workspace stay on the device; browser storage is not a backup. Photos and voice memos up to 5 MB can be uploaded directly to the user's Drive. An optional dated workbook copy and waiting field records remain on the device. Browser storage can be evicted; export important originals. The optional MCP prototype provides a data-free in-chat workspace card; the skill continues to use the host's existing Google connector for real workbook operations. Missing Google tools produce an explicit JSON fallback.

Append-only workbook revisions support idempotent retry and detect competing revisions. They do not provide transactional concurrency against arbitrary external Sheet edits. Pilot with one active editor per project. Workbook limit: 10,000 grid rows per tab. JSON export of the legacy local workspace excludes audio and is not yet a restorable backup package.

## Cloudflare

Existing project streamlion, repository Socialeap/StreamLion, production branch main. Build npm run build, output dist, repository root, Node 22. Do not alter Porkbun nameservers, transfer/unlock the domain, or change apex/www/email/3dps records. Existing streamlion.transcendencemedia.com CNAME/Pages arrangement is retained.

Official wasm Rollup/esbuild overrides accommodate the development machine's native-binary policy. CI runs tests/build. Owner Google setup, published frontend, live Google roundtrip, offline recovery, and phone microphone acceptance are separate gates. The optional private plugin is not a dependency of the primary customer workflow. See the committed release instructions before claiming completion.
