# StreamLion Production licence and refund settings — read-only review

Owner TO-DOs

1. Review this report. No setting or deployment action is needed to enable licence enforcement: it is already true in the serving runtime.
2. Before authorizing a refund change, review the coordinated 14-day wording and the proposed “void after first delivery” condition. Implementation and activation are separate later work; neither is authorized by this review.
3. Keep checkout paused and all pilot/AI/credit/mail allowances unchanged. F3D Publish is outside this review.

## Assessment and scope

Viable; high priority for avoiding an unnecessary licence toggle and misleading refund promises, but the setting change itself is blocked on copy/policy readiness. Code and serving source: a872c25d317d0b06cf8b9de0c484f73e934c35e8. Checked October 25, 2026 EDT (October 26 UTC). This report is a point-in-time observation, not a configuration change or launch approval. StreamLion does not use Lovable.

## Current Production evidence

The owner-authorized local Cloudflare OAuth credential can read the Pages project. The optional Composio Cloudflare connection is inactive and was not used; no connection was created. Both named bindings exist as encrypted secret_text in project Production and canonical deployment. Cloudflare returns no readable secret value; presence alone cannot prove the setting's value. Values below are independently observed runtime configuration, not decrypted secrets.

| Item | Observation | Evidence |
| --- | --- | --- |
| STREAMLION_REQUIRE_LICENSE | effective true | anonymous GET /api/purchase/status returns required:true; server/purchase-access.js:2–3 derives it only from exact string true |
| STREAMLION_REFUND_DAYS | effective 7 | GET /api/purchase/config returns refundDays:7; server/stripe-purchase.js:74–81 validates 7/14/30 and returns its numeric value |
| New checkout | paused | same config returns enabled:false, checkoutMode:paused, mode:live; status enabled:true indicates payments configured, not checkout open |
| Free Core pilot | disabled | GET /api/free-pilot/config returns enabled:false; ENABLE_FREE_PILOT absent from Production/canonical deployment binding metadata |
| Extension | disabled | ENABLE_CHATGPT_EXTENSION is plain-text false in Production and canonical deployment |
| Serving deployment | successful | canonical02ccccb5-ae68-40d9-967c-40acc30c6d5e, SHAa872c25; /release.json agrees |
| Health | ready | /api/health reports configuration/database ready and upstreamsChecked:false |

[Filtered API/runtime evidence](production-settings-review-2026-10-25-evidence.json). No credentials, tokens, account identities, purchase records or private project content were exported. The public quote GET makes Stripe catalog reads and normal rate-counter updates; it creates no checkout, payment, purchase, refund, pilot admission or email. No direct D1 writes, deployment, configuration changes or paid AI calls occurred.

## Who gets access when REQUIRE_LICENSE=true

| Cohort | Browser/Google workspace | Extension / other paid features |
| --- | --- | --- |
| A matching paid order in the current payment mode | retained; a valid paid order is required, not an arbitrary credit balance or F3D account | passes licence checks; normal feature/session/cost gates still apply |
| Active free Core pilot | retained only with ENABLE_FREE_PILOT=true, intact required schema/policy rows, state active, starts_at<=now<ends_at | no extension exemption; no paid AI, import, speech or client-coordination entitlement |
| Applied/approved/invited but not started | no Core exemption yet | no paid entitlement |
| Started pilot later expired or revoked | Google writes and picker-token blocked; GET sheets/drive retrieval survives only while pilotHistory can resolve the started row (including ENABLE_FREE_PILOT=true) | no extension exemption or paid entitlement |
| Unpaid legacy workspace tester or old AI/extension pilot | no automatic exemption; blocked by the paid gate unless an active Core-pilot record independently qualifies | extension rejects unpaid use at consent/authorization and request-principal checks; AI has its own paid gate |
| Fully refunded/disputed account with no other valid paid order | hasPurchase is false; an independently valid active Core pilot can still govern browser Core access | paid-only operations fail; one other valid paid order can retain paid access |

Evidence: server/google-auth.js:683–698; server/pilot-access.js:3–31; server/free-pilot.js:63–73,158–180,367–400; server/extension-auth.js:122–127,275–283,338–345; server/ai-pilot.js:134–138; server/client-coordination.js:184–185; server/purchase-access.js:1–14.

Important distinctions:
- hasPurchase checks Google subject and CURRENT payment mode, status paid. A test-mode order never becomes a live entitlement. Admin/pilot credits are not Core purchases.
- Sign-in/status/disconnect and purchase restoration remain available. Google-owned files are not deleted or confiscated; local device work/backup and direct Google access remain separate from server access.
- Closing admissions alone does not revoke an existing active pilot; the per-account record and pilot feature/schema must remain valid. Disabling ENABLE_FREE_PILOT removes even the historical-retrieval exception.
- Current Production already has enforcement true and free pilot disabled. Thus no newly affected cohort from a no-op true setting; do not switch it off to admit testers. A separately reviewed pilot rollout is needed if unpaid testers are intended to enter.
- Missing pilot schema returns no pilot exemption. Missing purchase configuration/errors fail the server operation rather than granting access.
- Actual individual users and cohort counts were not inspected. This describes authorization rules, not an assertion about who has already lost access.

## Refund wording inventory

Change these together in a separately approved implementation:

| File/component | References | Action |
| --- | --- | --- |
| api/welcome.html | 1119,1121,1320,1327 | static guarantee/FAQ fallbacks say 7-day/seven days; align 14-day condition even when JS/quotes are unavailable |
| public/api/terms.html | 34,50 | guarantee paragraph and Core-versus-credit guarantee reference; preserve earlier longer promises and mandatory rights |
| public/api/support.html | 32 | support link text says 7-day guarantee |
| server/stripe-purchase.js | 74–81,440,683 | period is already dynamic; hosted Checkout still promises a full refund with no first-delivery condition |
| src/Purchase.jsx | 248–249 | dynamic number, but needs the same delivery exception |
| src/landing.js | 656–660 | dynamic period replacement; verify both landing placements and fallback/paused behaviour |
| src/landing-value.js | 28 | accepts7/14/30 already; avoid assuming a paused quote updates visible landing text |
| docs/stripe-activation.md | 7,17,63–64 | current operational refund setting/policy instructions; mark historical initial-enforcement wording as superseded rather than rewriting past receipts |
| docs/landing-page.md | 11,26 | offer description and configuration |
| docs/landing-value-release.md | 7,21 | refund policy and activation instructions |
| docs/ai-credit-activation.md | 13,78 | Core guarantee reference and settings table, not credit refund policy |
| docs/client-credit-disclosures.md | 12 | Core guarantee description |
| src/Purchase.test.jsx; src/landing-value.test.js; functions/api/stripe-purchase.test.js | fixture7 and relevant quote/Checkout assertions | retain7 compatibility tests, add14 + consistent first-delivery wording coverage; do not simply replace every7 |

Do NOT replace unrelated seven-day lifetimes: private F3D invitations, deleted-brief metadata, browser drafts, offline receipts, OAuth-testing token limits, client sessions, webhook retention, analytics lookback or pilot duration/extension. Full literal inventory appears below.

The approved 14-day/first-delivery condition is not present in today's customer-facing guarantee. No automatic refund-eligibility endpoint enforces it: refund requests are manual by email; Stripe events reconcile the resulting licence. Changing the environment number neither enforces that condition nor retroactively alters what a buyer was promised. Refund-window/condition versions are not snapshotted as purchase fields in the inspected purchase schema/INSERT, so preserve the effective-date policy and Stripe checkout receipts for manual review. Handling mandatory consumer rights needs owner review; this is not legal clearance.

## Numbered held change/verification/rollback plan

1. **REQUIRE_LICENSE — recommended action now: no change.** Current effective value is already true. Recheck /api/purchase/status required:true and /api/health ready. Do not disturb payments mode, checkout pause, webhooks, free-pilot flags or credit policies.
2. **If a future enforcement change is explicitly approved**, use Cloudflare Dashboard → Workers & Pages → streamlion → Settings → Variables and Secrets → Production → edit the EXISTING encrypted STREAMLION_REQUIRE_LICENSE binding. Save only the approved value. Do not create a second binding or add public VITE configuration. The older docs' false-initially text is historical, not an instruction to disable today's enforcement. Redeploy only the specifically approved reviewed SHA under separate deployment authorization; capture deployment ID/SHA and serving /release.json. Cloudflare documents secrets as taking effect through a deployment: https://developers.cloudflare.com/pages/functions/bindings/ .
3. **Enforcement verification:** check required:true, unchanged checkoutMode:paused, health ready, paid account restoration and workspace read/write with owner-approved identities, unpaid workspace refusal, active-pilot Core exception in isolated staging, expired/revoked read-only retrieval, and extension denial for unpaid pilots if extension is separately enabled. Keep paid AI/mail disabled and use mocks for paid-provider paths. Anonymous status alone does not prove cohort behaviour.
4. **Enforcement rollback:** restore the exact pre-change secret and redeploy the pre-approved revision with that configuration; verify status and paid access. Baseline in this review is true, NOT false. Restoring false would broaden legacy unpaid access and requires its own explicit approval. Keep live payment webhooks running; never disable payment mode or erase orders to solve an access incident. Setting this flag false does not bypass independent paid gates in coordination/import/paid AI, so rollback is not a free-everything switch.
5. **REFUND_DAYS — first prepare and review code/terms**, including14 days, first-delivery condition, effective date, earlier-buyer protection, manual eligibility decision and all rows above. Keep checkout paused. Validate14 quote and Checkout text in disposable tests, plus7/30 compatibility and unknown-value failure. Obtain owner approval for that precise offer and deploy/configuration scope; no change is authorized by this report.
6. **Refund setting change after that approval:** Cloudflare Dashboard → Workers & Pages → streamlion → Settings → Variables and Secrets → Production → edit EXISTING encrypted STREAMLION_REFUND_DAYS from7 to14. Save without exposing other secrets. Redeploy only the approved reviewed revision so assets/Functions/terms/config agree. Do not open checkout, create a purchase or perform a refund during activation. A real payment/refund test needs separate explicit approval and a spend ceiling.
7. **Refund verification:** /api/purchase/config must return refundDays:14, required:true and checkoutMode:paused. Check /release.json, health, both landing guarantee locations, /api/purchase, /api/terms and /api/support, including paused and JS-failure fallbacks. Use a mocked Checkout test for Stripe submit wording; no paid event is needed for this verification. Retain the receipt before any separately approved checkout opening.
8. **Refund rollback:** pause sales first if a broader future rollout opened them (new authorization needed), restore pre-change setting7 and the compatible approved copy/revision, redeploy and verify the same endpoints. Preserve14-day or longer promises already made to buyers; rollback applies prospectively and never deletes/rewrites purchases or webhook receipts. Rolling back deployment alone may restore old binding values for that deployment but leaves future project settings changed; restore both intentionally and verify runtime results.

## Validation and limits

Cloudflare project GET, source review and anonymous read endpoints substantiate the settings and deployment observations. No real signed-in cohort test, Google write, purchase, refund or email was attempted. The three relevant local suites (free-pilot, instant-pilot and extension-auth) could not start in this isolated checkout because jose is not installed; this is a local dependency limitation, not a test pass or a discovered app defect. No dependency install was performed. Library page retrieval was unavailable due its monthly read quota; no book-derived claims are made.

## Full seven-day literal inventory (source SHA a872c25)

This is the review search result, including intentionally unrelated matches, not an edit list. Search covered docs/src/public/api/server/README, excluded images and generated maps. Dynamic refund sources and config table rows are listed separately above.

- `public/privacy.html:54` — Client work-order edits are saved as drafts on this device and are shared with the other party only when you save the current information. Draft restoratio
- `public/privacy.html:94` — Coordination access expires on the recorded job deadline; original Google records and Drive archive packages remain under the provider’s control. Client pu
- `public/privacy.html:96` — Purchase, refund and dispute records are retained as needed to provide purchased access and meet accounting, tax, security and legal obligations. Disconnec
- `public/privacy.html:107` — Account activity and owner administrationStreamLion retains operational account metadata, including your verified Google account identity, first-known/sign
- `api/welcome.html:1119` — 7-day money-back guarantee</strong
- `api/welcome.html:1121` — seven days of purchase.
- `api/welcome.html:1185` — Private access expires after seven days. Clients can revoke access
- `api/welcome.html:1188` — for up to seven days after deletion. Downloaded or shared copies
- `api/welcome.html:1320` — 7-day money-back guarantee. Use it
- `api/welcome.html:1327` — seven days of purchase. Your Google
- `docs/persistent-google-activation.md:15` — Declare \`openid\`, \`email\`, and \`https://www.googleapis.com/auth/drive.file\`. Keep Sheets, Drive and Picker APIs enabled. Do not request all-Drive permissio
- `public/api/support.html:32` — For a purchase or refund request, include your purchase receipt. See our purchase terms and 7-day money-back guarantee.
- `public/api/privacy.html:54` — Client work-order edits are saved as drafts on this device and are shared with the other party only when you save the current information. Draft restoratio
- `public/api/privacy.html:94` — Coordination access expires on the recorded job deadline; original Google records and Drive archive packages remain under the provider’s control. Client pu
- `public/api/privacy.html:96` — Purchase, refund and dispute records are retained as needed to provide purchased access and meet accounting, tax, security and legal obligations. Disconnec
- `public/api/privacy.html:107` — Account activity and owner administrationStreamLion retains operational account metadata, including your verified Google account identity, first-known/sign
- `public/api/terms.html:34` — 7-day money-back guarantee. Try StreamLion on your own job. To request a full refund, email info@transcendencemedia.com with your purchase receipt within s
- `public/api/terms.html:50` — For questions about unused credits or a refund, contact info@transcendencemedia.com with your receipt. The seven-day app purchase guarantee applies to the 
- `docs/launch-and-scale-release-runbook.md:74` — Confirm the actual OAuth project's audience/publishing status, requested scopes, branding/domain verification, and any applicable verification or user limi
- `src/Purchase.test.jsx:32` — refundDays: 7,
- `src/request-assistant.js:1233` — // Drafts stay on this device for seven days after the last change, keyed by
- `docs/stripe-activation.md:7` — Backend + frontend + durable D1 state + server-only secrets + Stripe provider setup. This PR does not activate payments on merge. The owner has requested t
- `docs/stripe-activation.md:17` — Configure **\`STREAMLION_REFUND_DAYS=7\`** for the requested seven-day money-back guarantee. The API also accepts 14/30 for compatibility with longer existin
- `docs/stripe-activation.md:83` — - Verify local offline work after a verified purchase and backup download while access is unavailable. A 7-day browser receipt allows local offline use onl
- `src/landing-value.test.js:18` — refundDays: 7,
- `src/AdminPortal.jsx:926` — Last 7 days
- `src/PilotControls.jsx:204` — 7 days
- `docs/client-coordination-activation.md:21` — Email login uses fragment tokens, a deliberate verification button, 20-minute single-use challenges and a separate seven-day Secure/HttpOnly/SameSite cooki
- `src/landing-pilot.test.js:54` — assert.match(card.textContent, /7-day/);
- `src/landing-pilot.test.js:84` — assert.doesNotMatch(ui.card().textContent, /7-day|soon|Start free pilot/);
- `src/landing-pilot.test.js:97` — /group is full|soon|7-day|Start free pilot/,
- `docs/landing-page.md:11` — The requested **seven-day money-back guarantee** is a request window from payment, not a bank-settlement deadline. Requests go to \`info@transcendencemedia.
- `docs/landing-page.md:26` — **Frontend + backend + durable purchase state + refund configuration.** This includes \`0005_streamlion_launch_200.sql\` after the original \`0004\` purchase s
- `src/request-assistant.test.js:435` — test("drafts are kept for seven days per form, keyed without the token", () => {
- `src/FreePilot.test.jsx:495` — assert.match(ui.getByText(/Your 7-day pilot/).textContent, /7-day/);
- `docs/client-request-assistant.md:83` — Answers are kept on this device for seven days after the last change under
- `docs/client-request-assistant.md:100` — seven days; **Clear from this device** removes it.
- `docs/landing-value-release.md:7` — Interactive hero reveals; room/measurement-derived job-site checks and remaining-work results; named-space measurement organization; sample invoice balance
- `docs/landing-value-release.md:21` — **Cloudflare owner, after merge:** apply \`0004\` only if its complete purchase schema is absent, then \`0005_streamlion_launch_200.sql\` using the idempotent 
- `docs/ai-credit-activation.md:13` — Only authenticated Google accounts with a verified app purchase can top up or spend commercial credits. Stripe Checkout uses one server-selected Price and 
- `docs/admin-portal-release.md:49` — Verify real owner sign-in and wrong-account denial, all direct admin API paths, expired/revoked windows, account switching/sign-out, search/sort/page/filte
- `docs/client-workflow-spec.md:150` — D1 must not become an independent authoritative copy of accepted project content. Temporary encrypted operation payloads may support retries; delete them a
- `docs/launch-readiness.md:19` — PR #63 adds actionable access states and retry guidance, a fixed OAuth return to Client requests, provider-copyable private request links, client-editable 
- `docs/google-setup.md:10` — 2. Configure Google Auth Platform Branding, Audience and Data access for StreamLion. Choose External for providers outside your own Google Workspace, keep 
- `docs/notifications-activation.md:14` — - Three devices per subscription owner are permitted. The pilot supports one role/client project per browser push subscription on this origin; switching re
- `docs/notifications-activation.md:50` — Dispatch rechecks the paid account, payment mode, connection expiry/revocation, job archival/access deadline and client push grant. Expired invitation chal
- `docs/production-completion-2026-10-08.md:13` — - Draft recovery has a seven-day restore limit, rejects malformed/private/closed-job records and never shares an edit automatically. It is separate from Co
- `docs/client-project-brief-entry.md:20` — Private access lasts seven days. Clients can view/export, revoke or delete their
- `docs/client-credit-disclosures.md:12` — The terms retain the existing one-time Core prices, seven-day app guarantee, prepaid credit purchase/refund rules and 30% AI-cost markup. The existing \`#ai
