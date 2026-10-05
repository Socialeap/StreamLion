# Launch-hardening activation and owner acceptance

**HOLD — ACTIVATE ONLY AFTER THIS HARDENING PR MERGES AND THE OWNER APPROVES DEPLOYMENT.**

## Classification and minimum action set

Frontend + existing Cloudflare Pages Functions + private scheduled cleanup Worker/log configuration. This release introduces no D1 migration, new secret, OAuth scope, provider setting, price, paid service or payment activation. StreamLion's established stack-specific protocol uses GitHub/Cloudflare/Google/Stripe and excludes Lovable. Owner activation remains separate from reviewed source.

The existing Pages project automatically deploys main. Treat approval to merge as approval of that Pages deployment only when the owner explicitly accepts this release boundary. Cleanup does not follow a Pages deployment; redeploy that Worker separately after approval. Never merge or deploy automatically from this guide.

## Copy-ready owner deployment instructions

```text
HOLD — USE ONLY AFTER HARDENING PR MERGE AND OWNER DEPLOYMENT APPROVAL.

Sync Socialeap/StreamLion to current merged main containing the reviewed
launch-hardening changes. Record the exact full 40-character main SHA and
verify it contains server/request-body.js, functions/_middleware.js,
health schema 2, updated Stripe signature ordering, and this guide. Stop
if the checkout is dirty, the changes are absent, or approval is missing.

Spend ceiling: $0 incremental. Verify existing Cloudflare allowances before
proceeding; stop if that cannot be established. No upgrades, paid monitoring,
auto-recharge, real charges/refunds, paid searches or provider probes.

Preflight existing streamlion production without exposing customer rows or
secret values. Verify auth schema stamp 1, folder schema stamp 1, extension
schema stamp 1, request-counter table/index, and definitions against committed
0001_google_sessions.sql, 0002_google_request_limits.sql,
0003_google_workspace_folder.sql and 0006_chatgpt_extension.sql.

This hardening requires NO migration. If any expected marker is missing,
partial, or inconsistent, STOP and report it. Do not generate/substitute SQL,
run migrations apply, or apply pending purchase migrations 0004/0005. If
restoration/initial provisioning is separately authorized, use only the
respective committed activation guide: apply its exact committed migration
byte-for-byte only when EVERY named marker is absent; stop on partial state.

Preserve every existing production/preview binding, credential and flag.
No new secrets are involved. Do not rotate GOOGLE_TOKEN_ENCRYPTION_KEY,
change OAuth clients/scopes, enable payments/license enforcement or copy
production secrets/D1 into previews. Do not alter Stripe/F|3D integrations.

Deploy only the existing streamlion Pages project's frontend and bundled
Pages Functions from the approved merged SHA using its ordinary existing
build/deployment control. If its automatic main deployment already succeeded,
verify that exact deployment instead of starting a duplicate. Confirm the
public /release.json matches the full approved main SHA.

Separately deploy ONLY streamlion-session-cleanup from that same SHA with:
npx wrangler deploy --config ops/wrangler-cleanup.jsonc
Verify D1 f9945b40-00ca-4662-9113-585927e31ec0 / GOOGLE_SESSIONS,
cron 23 3 * * *, existing ENABLE_CHATGPT_EXTENSION=true, no public routes,
counts-only logs enabled, invocation logs disabled, traces disabled. Do not
invoke cleanup against customer state merely to create a receipt. Capture
its next scheduled aggregate-count log and platform invocation/error metric.

Run one safe, non-credit-consuming release verification:
node scripts/verify-release.mjs https://streamlion.transcendencemedia.com FULL_MAIN_SHA
It must verify revision, health schema 2/database ready/request ID,
anonymous Google session denial of private data and public configuration.
No Google/Stripe API health probes, customer writes, checkout or real searches.
Then the existing anonymous extension smoke may run once without credentials.

Receipt: full main SHA; Pages deployment ID/revision; database/schema preflight
and existing platform stamps (migration result: NOT REQUIRED, NOT APPLIED);
security result (preview isolation preserved; no RLS/grant changes; generated
request ID, sanitized diagnostics); exact cleanup Worker version/binding/cron/
log result; safe release-check result; next scheduled cleanup receipt or an
explicit pending status. Owner must share and accept this receipt before
activation is declared complete. Keep frontend deployment, Worker activation,
authenticated account/device QA, Stripe activation and scale approval separate.
```

## Owner acceptance after deployment

1. Confirm the closed-sales CTA opens the sample and a valid live quote alone enables purchase promotion. With payments still disabled, do not try to create a real checkout to test the CTA.
2. Use two dedicated synthetic Google accounts/workbooks for folder/file selection, save/readback, exact fraction and media, silent restore/refresh, disconnect/revocation and stale-account isolation. Do not share passkeys, secrets or customer files in chat. Review current Google Audience/Branding status on the owner's Console.
3. On physical Android and iPhone, verify installation/reopening, permission denial/interruption, background/app switch, offline retry, draft-safe update, clipboard handoff, printing/sharing and original-media backup restore.
4. Assign incident/backup owners and an existing private alert destination; record D1/Google/device recovery drills and supported workload/cost/SLO. Local fixtures alone do not clear these gates.
5. Stripe remains a separate owner-approved test/live activation via stripe-activation.md, including exact purchase migration preflights, test cards, policy approvals and existing-tester treatment. Public ChatGPT distribution remains a separate optional submission gate.

## Rollback

Redeploy the previously accepted Pages revision and, if required, the previously accepted cleanup Worker/configuration; verify exact versions. Preserve D1/Google data, encrypted credentials, purchase/webhook state and device drafts. No key rotation, migrations, deletes, paid upgrades or broad function deployments. Record anonymous checks and owner acceptance after rollback.
