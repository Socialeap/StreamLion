# StreamLion

Google-owned project workspace for spatial capture providers. The PWA prepares visits, records field evidence, and tracks handover; Google Sheets/Drive own the saved business records. Manual entry, saved project-file import, exports and backups remain available. Optional in-app AI uses prepaid credits and its existing eligibility and activation gates. The customer ChatGPT handoff and plugin/extension integrations are retired. Google configuration and mobile voice acceptance remain required before the connected workflow is ready for users.

## Run

Node 22.12+:

```sh
npm ci
npm test
npm run build
npm run dev -- --port 4174
```

## Workflow

Create a project manually, restore a saved StreamLion project file, or use optional in-app brief preparation when enabled. Save the project and open its home: Prepare → On site → Before leaving → Delivery. Add area-specific notes, photos, or voice memos in the PWA. Ask provides free saved-detail lookup and optional credit-backed AI answers when enabled. Project snapshots can be downloaded for your records.

Named unfinished drafts appear in Projects on the device where they were started. Project names, cities, visit dates and details review status appear in the list, with Edit and Delete actions. Delete moves a saved project to a restorable section and retains Google revision history and field notes. The details status does not indicate whether site work is finished.

- [Provider workflow and release checks](docs/provider-workflow.md)
- [Google setup and activation](docs/google-setup.md)
- [Current architecture and limits](docs/google-owned-plan.md)
- [Field map](docs/field-map.md)
- [JSON fixture](fixtures/project-intake.json)
- [Immediate pilot admission and scheduled places: held release](docs/instant-pilot-release.md)
- [Controlled free pilot: held release and approval gates](docs/controlled-free-pilot-release.md)
- [ChatGPT retirement and release gates](docs/chatgpt-retirement-release.md)

Google access tokens stay in memory. Project drafts and the original local workspace stay on the device; browser storage is not a backup. Photos and voice memos up to 5 MB can be uploaded directly to the user's Drive. An optional dated workbook copy and waiting field records remain on the device. Browser storage can be evicted; export important originals.

Append-only workbook revisions support idempotent retry and detect competing revisions. They do not provide transactional concurrency against arbitrary external Sheet edits. Pilot with one active editor per project. Workbook limit: 10,000 grid rows per tab. JSON export of the legacy local workspace excludes audio and is not yet a restorable backup package.

## Cloudflare

Existing project streamlion, repository Socialeap/StreamLion, production branch main. Build npm run build, output dist, repository root, Node 22. Do not alter Porkbun nameservers, transfer/unlock the domain, or change apex/www/email/3dps records. Existing streamlion.transcendencemedia.com CNAME/Pages arrangement is retained.

Official wasm Rollup/esbuild overrides accommodate the development machine's native-binary policy. CI runs tests/build. Owner Google setup, published frontend, live Google roundtrip, offline recovery, and phone microphone acceptance are separate gates. The retired ChatGPT routes return HTTP 410 after deployment. See the committed release instructions before claiming completion.
