# Coordination credit top-ups — release held

A provider may buy the existing $10/800, $25/2,000 or $50/4,000 shared-credit
packs for confirmed project coordination without enabling AI. The project price
still comes from the active policy (currently 240 credits / USD 3.00); this change
adds no price, charge, grant or balance conversion. Credits retain their existing
account/mode ownership and signed Stripe fulfillment/refund/dispute behavior.

`STREAMLION_COORDINATION_CREDIT_SALES_ENABLED=true` is a separate explicit sales
approval. Absent, false or malformed values keep this new path closed. It requires
`coordinationReady` (the same read-only gate used by the coordination service), an
active positive project-charge policy, readable shared-credit ledger, matching payment/credit modes, complete
Stripe configuration, live payment approval in live mode, the independent
checkout/owner-QA gate, and the buyer's paid Core entitlement. Readiness is
rechecked for new checkout and pending-URL reuse; missing/unavailable prerequisites
fail closed. Catalog validation, CSRF/account checks and webhook verification
remain in place.

The original `STREAMLION_AI_CREDIT_SALES_ENABLED` path remains independently
available under its existing checks. AI execution still requires its own keys,
explicit cost approval, active policy, budget, eligible funding and mode guards.
Purchasing coordination credits never changes those controls or invokes a model.
The legacy `STREAMLION_AI_CREDITS_MODE`, Stripe IDs, `kind=ai_credits` metadata and
webhook secret names remain compatibility contracts for the shared ledger; do not
rename catalog objects or migrate balances for this change.

## Separate release gates

1. **Review/merge:** require passing `verify` and owner review. This PR does not
   authorize merge. `[CF-Pages-Skip]` suppresses automatic Pages release while
   allowing required GitHub CI. Record the approved merged main SHA.
2. **Migration:** none. Do not apply/replay migrations, alter schemas, copy test
   purchases/credits into live, or rewrite records, forms, credentials or drafts.
3. **Configuration:** HOLD for separate owner approval. Deploying code with the
   new switch absent preserves current behavior. For a future coordination-only
   live launch, approve the matching live Stripe bundle and payment/credit modes,
   active live coordination policy and matching relay configuration together with
   the existing launch plan. Only then consider the new switch true; retain
   `STREAMLION_AI_CREDIT_SALES_ENABLED=false`, `STREAMLION_AI_COST_APPROVED=false`,
   and paid-AI policy inactive with zero budgets. Keep checkout paused or private
   owner QA until explicit public opening. Preserve all other pilot settings,
   secrets, email limits, grants, accounts and budgets. No upgrade/auto-recharge.
4. **Functions deployment:** HOLD for explicit owner authorization after merge.
   Deploy the selected merged main Pages Functions with shared coordination
   readiness and credit checkout handler. No auxiliary Worker change is needed
   for this code-only release; a future test-to-live relay promotion is separate.
   Check current mode/catalog, denied anonymous checkout, paused/owner-QA guards,
   balance/confirmation availability and signed webhook method/signature guards.
5. **Frontend release:** HOLD for separate authorization of the same merged SHA's
   assets, including the Credits explanation that buying credits does not enable
   AI. Pages publishes Functions/assets together, so obtain both approvals and
   record separate evidence. Use the normal PWA update; never clear storage.
6. **Acceptance:** run synthetic payment/replay/refund/debt and failed-readiness
   checks at $0. Physical phone/PWA capture, install and backup-file acceptance
   require the owner's device. Real live settlement/refund requires a separate
   explicit gross-charge and processing-fee allowance; sandbox/mocked results do
   not prove settlement. No live configuration or payment is authorized here.
7. **Public sales:** separate owner authorization only after agreed commercial,
   device, Stripe, Google/email and cohort capacity gates pass. AI can remain off.

To pause all new credit purchases, set checkout paused or disable BOTH sales
switches under separate authorization. Turning off only the legacy AI sales
switch no longer stops an approved coordination path. Keep matching live secrets,
webhooks, confirmation/status, records and reconciliation available. Do not roll
payment mode back to test or credit mode to disabled after live funds exist.

## Validation scope

Local and CI tests use in-memory SQLite and synthetic Stripe responses only.
Network mocks reject Google, OpenAI, DeepInfra and other external destinations.
Coverage includes coordination-only live configuration, absent/malformed approval,
service/schema/policy/mode failures, owner-only/account/Core-license enforcement,
pending checkout reuse and pause, signed duplicate/out-of-order completion and
refunds, exact project charging, negative-balance hold, and independent AI gates.
The full suite also covers drafts, device backups, offline recovery, writer locks,
Google reconnect and at-most-once appends. None of those substitute for physical
phone or real settlement acceptance.
