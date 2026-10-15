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
Exact exclusions also bypass the eight static API shells: welcome, purchase,
credits, client-portal, client-requests, terms, privacy and support, including their
trailing-slash and `.html` forms. These exclusions do not cover child paths:
purchase/credits status, checkout and webhook handlers still invoke Functions.
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
- PR #83 review regression: all 24 clean/trailing-slash/HTML variants of the
  eight static API shells bypassed middleware in isolated local Pages, served
  the expected built HTML and retained CSP. Private client shells also retained
  no-store and no-referrer policies, including a synthetic query-token request.
  Thirteen dynamic API/MCP/discovery routes still reached middleware; no
  provider bindings, external calls or production data were used. The routing
  test discovers static shells from both source directories so new shells
  cannot silently miss this check.
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
cannot be certified by a local timer. Hosted CI was initially skipped to respect
the reported exhausted Actions budget. A follow-up commit requests the required
`verify` run; its current result must be checked on PR #83. Local checks do not
constitute hosted CI, and a billing-blocked run must not be reported as passing.

## Release gates — no activation performed

- **Review/merge:** PR #83 is ready for review; no merge is authorized. The initial
  commit used `[CF-Pages-Skip] [skip ci]`. The follow-up retains `[CF-Pages-Skip]`
  while omitting the Actions skip marker so required `verify` can report.
  No deployment is authorized by this document. Review any future merge/deploy
  trigger explicitly.
- **Migration:** no migration is required. D1 schema and stored records are
  unchanged; do not apply a migration or rewrite data for this change.
- **Configuration:** no live configuration change is required. Keep secrets,
  providers, pilot modes, quotas, cron frequency and subscription settings
  unchanged. Review the committed routing manifest as part of the artifact;
  it does not authorize a dashboard or provider-settings change.
- **Server deployment:** HOLD for explicit owner authorization of the selected
  merged main SHA and its Pages Functions bundle. Verify the deployed server
  revision and protected API/MCP behavior separately. Neither scheduled Worker
  needs deployment for this change.
- **Frontend deployment:** HOLD for explicit owner authorization of the same
  SHA's built assets and routing manifest. Verify public-shell bypass, security
  headers, release metadata and PWA update separately from server behavior.
  Pages ships Functions and assets together, so obtain both deployment
  authorizations before that single release and retain distinct server and
  frontend receipts. Evidence for either gate cannot clear the other.
- **Owner/device QA:** after both deployment checkpoints, verify the exact
  revision on the owner's devices; static assets,
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
