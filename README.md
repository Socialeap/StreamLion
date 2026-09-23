# StreamLion

Google-owned project workspace for spatial capture providers. ChatGPT interprets specifications and assists with voice annotations; Google Sheets/Drive own the business records. This version implements the field contract, PWA editor, Google browser adapter and plugin instructions. Google configuration and mobile voice acceptance remain required before the connected workflow is ready for users.

## Run

Node 22.12+:

```sh
npm ci
npm test
npm run build
npm run dev -- --port 4174
```

## Workflow

Upload specifications in ChatGPT using StreamLion. Review and save through the connected Google tools, or import its JSON into the PWA. In Connections, authorize Google and create/select the StreamLion workbook. Refresh to read current project records. Edit details, add area-specific notes, and use Ask to copy project context into ChatGPT for queries/voice.

- [Google setup and activation](docs/google-setup.md)
- [Current architecture and limits](docs/google-owned-plan.md)
- [Field map](docs/field-map.md)
- [JSON fixture](fixtures/project-intake.json)
- [Plugin source](plugin/skills/instructions/SKILL.md)

Google access tokens stay in memory. Project drafts and the original local workspace stay on the device; browser storage is not a backup. Source documents and retained recordings belong in the user's Drive. No model API key, StreamLion database or MCP server is deployed by this code. The skill uses the host's existing Google connector; missing tools produce an explicit JSON fallback.

Append-only workbook revisions support idempotent retry and detect competing revisions. They do not provide transactional concurrency against arbitrary external Sheet edits. Pilot with one active editor per project. Workbook limit: 10,000 grid rows per tab. JSON export of the legacy local workspace excludes audio and is not yet a restorable backup package.

## Cloudflare

Existing project streamlion, repository Socialeap/StreamLion, production branch main. Build npm run build, output dist, repository root, Node 22. Do not alter Porkbun nameservers, transfer/unlock the domain, or change apex/www/email/3dps records. Existing streamlion.transcendencemedia.com CNAME/Pages arrangement is retained.

Official wasm Rollup/esbuild overrides accommodate the development machine's native-binary policy. CI runs tests/build. Owner Google setup, published frontend, plugin release, live Google roundtrip and phone voice acceptance are separate gates. See the committed release instructions before claiming completion.
