# StreamLion

Local field-workspace foundation for spatial capture providers. This is an initial review increment, not a production release or the full planned product.

## Run and verify

Use Node 22.12+ (Node 22 recommended for Cloudflare).

```sh
npm ci
npm test
npm run build
npm run preview
```

## Works in this increment

- Create jobs with original project IDs, site, scope, and optional offered USD fee.
- Capture area-linked typed notes; keep fractions and wording unchanged.
- Correct notes with retained revision history and explicit review state.
- Record short foreground audio with captured job/area context; store recordings and notes together in IndexedDB. No transcription is performed.
- Export jobs and notes as JSON; download each recording separately.
- Responsive layout, PWA manifest, and app-shell precache. New service workers wait rather than forcing reload during field work.
- Storage errors remain visible; stale concurrent-tab writes fail rather than overwrite.

## Not yet implemented / verified

Google OAuth and sync, user accounts, tenant isolation, structured measurement parsing, checklist completion, PDF intake, AI answers, invoicing, payments, backup import, and commercial readiness. No cloud data storage or API keys are required. Use synthetic test data until field validation and security work are complete.

Browser data is not a backup. It can be cleared or evicted. Export records regularly and download audio. JSON export does not embed audio. Physical iPhone/Android recording, interruption recovery, PWA installation and offline operation require owner testing.

## Deployment: Cloudflare Pages with Porkbun DNS

After the reviewed change is merged to `main`:

| Setting                | Value                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| Repository             | `Socialeap/StreamLion`                                           |
| Project                | `streamlion`                                                     |
| Production branch      | `main`                                                           |
| Framework preset       | `Vite` (or None with explicit values below)                      |
| Build command          | `npm run build`                                                  |
| Build output directory | `dist`                                                           |
| Root directory         | repository root / leave default                                  |
| Node version           | `22` (Pages build environment setting `NODE_VERSION`, if needed) |
| Application secrets    | none                                                             |

Verify the generated `pages.dev` deployment before adding the custom URL. In the Pages project's Custom domains, register `streamlion.transcendencemedia.com`. Then add **only** a `streamlion` CNAME at Porkbun pointing to the exact assigned Pages hostname. Wait for active HTTPS and verify the app.

**Porkbun remains the registrar and authoritative DNS provider. Do not change nameservers, transfer the domain, unlock it, or alter apex/www/email/3dps records.** The pending Cloudflare domain-zone onboarding is not required for this Pages subdomain setup.

No Lovable action is required: this increment has no backend, migration, server function, or provider activation. Cloudflare Pages build configuration and frontend publication are owner-controlled release steps. Merge, build, live verification, and device acceptance are separate gates.

Build-tool note: official WebAssembly variants of Rollup and esbuild are pinned via npm overrides so builds run without native binaries rejected by the development machine's macOS policy. No system security settings are changed.
