# Workers CPU optimization — release held

## Evidence and change

Read-only Cloudflare inspection on October 15, 2026 found 186 `Exceeded CPU
Time Limits` errors among 3,051 StreamLion production Pages Function invocations
over the preceding 24 hours. Account requests were 3,265 of 100,000 that day.
This is a per-invocation CPU problem, separate from Resend email quotas.
The retained telemetry did not identify the exact failing routes; these changes
address confirmed unnecessary invocations and reproducible computation costs,
not a proven attribution of all 186 failures.

The baseline Wrangler-generated routing manifest was `include: ["/*"]` with
no exclusions because of root middleware. The committed `public/_routes.json`
is copied into `dist` by Vite and limits Function invocation to `/api`, `/api/*`,
both MCP endpoints (including trailing slashes), and `/.well-known/*` discovery.
Public application shells, service workers, release metadata and assets bypass
Functions. API/MCP authentication and failure logging still run; public shells
hold no account data, and their APIs still enforce access. Static security and
privacy headers continue to come from `public/_headers`.

Large vault/archive and attachment conversions previously used per-byte
JavaScript loops. `server/base64.js` uses native Buffer conversion through the
already configured `nodejs_compat` flag. It retains `atob` validation rather than
using Buffer's permissive base64 decoder. The unpadded base64url ciphertext,
AES-GCM context binding, file validation, private Drive destinations and existing
size limits are unchanged. No stored data rewrite or credential rotation is needed.

## Local verification

Node 26.5.1, current dependency lockfile; no new dependency or upgrade:

- `npm test`: 588 passed, zero failed. Existing React `act(...)` warnings remain.
- `npm run build`: Vite/PWA and self-contained extension builds passed.
- Wrangler Pages Functions build and both scheduled Worker dry-run builds passed.
- Local Pages probes: six static routes bypassed Functions with CSP retained;
  six API/discovery routes invoked Functions. Unconfigured protected endpoints
  failed closed; public purchase status reported `purchased: false`.
- Both local MCP smoke suites passed, including protected extension reads.
- `npm run verify:capacity` passed; `npm audit --audit-level=high`: zero vulnerabilities.
- Large-payload codec tests passed in actual local workerd. Existing ciphertext
  read, old-decoder compatibility, malformed base64, tampering, context binding,
  all byte values, and typed-array slice boundaries are covered.

`npm run verify:cpu` compares seven interleaved synthetic samples after warm-up,
checks equal outputs, and makes zero provider calls. Example median process CPU
times from this Mac (milliseconds):

| Operation                          | Previous | Optimized |
| ---------------------------------- | -------: | --------: |
| 512 KiB base64url encode           |    7.922 |     0.081 |
| 512 KiB base64url decode           |   17.018 |     0.627 |
| 512 KiB standard attachment decode |   15.989 |     0.150 |
| 700,000-byte vault seal and read   |   35.306 |     2.261 |
| 700,000-byte vault read            |   23.063 |     1.551 |

These are local Node process CPU measurements, not Cloudflare CPU receipts or
production capacity guarantees. The Workers Free per-invocation CPU allowance
cannot be certified by a local timer. Hosted CI was intentionally skipped to
respect the exhausted Actions budget; local checks do not constitute hosted CI.

## Release gates — no activation performed

- **Review/merge:** draft PR only. Commit prefixes `[CF-Pages-Skip] [skip ci]`
  suppress automatic Pages deployment and Actions. No deployment is authorized
  by this document. Review any future merge/deploy trigger explicitly.
- **Migration/settings/subscription:** none required. No D1 schema/data, secrets,
  providers, quotas, cron frequency or subscription settings change.
- **Backend/frontend deployment:** a later owner-authorized Cloudflare Pages
  release must include both the built routing manifest and Functions bundle.
  Neither scheduled Worker needs deployment for this change.
- **Owner QA:** after that release, verify its exact revision; static assets,
  Google login/reconnect, private workbook reads, client/provider access,
  a synthetic attachment and archive recovery, and both MCP flows. Preserve
  purchased access and existing records. Do not enable sales or send mail as
  part of CPU verification.
- **Live closure:** compare production CPU-limit error counts/rates and CPU
  percentiles over representative normal use and a subsequent 24-hour window.
  Do not declare the incident resolved or free-tier capacity established until
  that evidence is reviewed. If errors remain, obtain private route-class and
  operation evidence without logging URLs, query strings, tokens or user content,
  then profile that specific path. Do not increase limits or buy a plan implicitly.

References: [Pages invocation routing](https://developers.cloudflare.com/pages/functions/routing/),
[Workers Buffer support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/buffer/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Pages deployment skip prefixes](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#skipping-a-build-via-a-commit-message).
