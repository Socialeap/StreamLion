# First-run setup, account status and installation

## Setup assistant

A genuinely new visitor (no Google session, no remembered workbook, no device
projects, notes or drafts, no earlier device-only choice and no finished
setup) sees **Get started** on the opener. It opens a chat-style assistant
(`src/SetupAssistant.jsx`) that asks one question at a time. **Already use
StreamLion? Sign in with Google** and **Continue on this device** remain on
the opener, so returning users and anyone who wants to skip setup are not
forced through it. Returning users go straight to their workspace.

The flow is a deterministic list of conditional steps in
`src/setup-assistant.js`. The next question is the first step that applies and
is not yet confirmed, so answers drive branching:

| Stage           | Questions (asked when)                                                                                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| About you       | Preferred name; business or trade name (client pages, project records, handovers)                                                                                                                                                                               |
| Contact         | Form card: business email (required), phone, service area or address, website                                                                                                                                                                                   |
| Your work       | How StreamLion will be used; capture systems; other system (if Other); usual deliverables (options follow the hardware); 360° tour hosting (Insta360, Ricoh Theta, Other)                                                                                       |
| Storage         | Google or this device (Google disabled offline or when sign-in is unavailable); Google sign-in; create or choose a workbook; offline workbook copy (on-site work only)                                                                                          |
| Pricing & units | Measurement system (on-site work); pricing method, tier style, currency, per-sq-ft rate or size bands, client budgets (client requests only)                                                                                                                    |
| ChatGPT & AI    | How ChatGPT will be used: smart project briefs and project questions (built-in, AI credits) or the free Briefing Helper in the user's own ChatGPT, with a link to the Credits page; read answers aloud (project questions only); add credits (built-in AI only) |
| Finish          | Logo (client requests only); theme; review card with Edit on every answer                                                                                                                                                                                       |

Every confirmed answer is written to this device immediately under
`streamlion-setup-v1` (browser storage only; no identity or authorization).
A reload, **Finish later**, or Google's sign-in page resumes at the exact
pending question with the transcript intact; the opener then shows **Continue
setup**. **Edit** re-asks only that answer and keeps later answers; answers
that depend on it (for example deliverables after a hardware change) are asked
again with the previous choice preselected. Escape keeps the previous answer.
**Start over** asks for confirmation and never signs out or touches workbooks
or projects.

Google sign-in uses the existing flows: the persistent `/api/google/start`
redirect (the assistant reopens on return with `?google=connected`, or shows
the cancelled/failed message) or the existing popup when persistence is off.
Workbook creation, the workbook chooser and the offline copy use the existing
`google.js` and App handlers and run only from an explicit choice. A restored
account with a saved workbook is never asked to create another. Offline, the
Google choice is disabled and setup continues on the device.

The ChatGPT & AI stage explains credits in one line and links to the Credits
page. The read-aloud answer sets the Ask page's existing switch. The credits
step checks `/api/credits/config`: without Google it says credits need a Google
account; while purchases are closed it keeps the choice and points to the free
Briefing Helper; when open it lists the packs and opens the Credits page in a
new tab, where the existing Stripe Checkout and disclosures handle payment.
Purchases are one pack at a time; there is no stored card, subscription or
automatic recharge. Whether briefs and project questions are switched on stays
a separate server setting.

**Save & finish** is the only write. When Google is connected it saves the
business name, website, phone, service area and optional logo through
`/api/provider-branding`
and publishes the chosen pricing as the account default through
`/api/provider-pricing`, keeping any saved logo, website and named extras.
Each result is reported in the chat; a failure keeps the finished setup. On
this device only, nothing is sent: Account prefills unsaved branding and an
unpublished default price from the answers, still behind their explicit
Save/Publish buttons. New projects start with the business name and email as
the capture provider, the deliverables field offers **Add my usual
deliverables**, and measurement examples follow the chosen unit system.
Device backups include the setup answers and the handover contact card; a
restore adds them only where this device has none and rejects damaged ones.
Account shows the setup summary with **Rerun setup assistant**, which reopens
on the review card.

## Existing entry points

An anonymous visitor to `/` sees **Set up StreamLion** after the existing
Google session check completes. **Set up with Google** opens Connections,
where the existing Google consent flow and workbook controls remain explicit
user actions. **Continue on this device** remembers a device-only choice;
it does not create an account or send records to Google.

Existing device projects, field records, any retained draft, or a remembered
workbook bypass first-run setup. Returning Google users restore their existing
workspace. Cancelled consent stays in Connections with retry guidance. A
failed connection check is shown as unverified, rather than signed in or signed
out. No drafts, operation identities, records, workbook selections or media
are cleared by setup or account navigation. The new local setup preference
contains only `device`; it carries no identity or authorization and is not
required for restored records to remain accessible.

Account is visible in the workspace header. It shows checking, signed out and
device only, connected Google email and workbook readiness, reconnect needed,
or connection unavailable. Opening Account uses Connections, preserving the
current edit through the existing draft mechanism. Existing capture/save locks
also disable account navigation and the native install action. Google sign-in
does not automatically migrate pre-existing device-only projects.

Install app offers an optional browser-native prompt when eligible, plus manual
instructions when unavailable. Eligibility is captured before the initial
license read completes. Prompting requires a user click; dismissal and failure
leave browser use available. Acceptance is reported as requested, not installed;
the installed event or standalone display hides the installation control. The
app gives a general private-browsing persistence warning without detecting
Incognito. A service worker or manifest alone is not proof of installation.

## Validation

Setup assistant tests (`setup-assistant.test.js`, `SetupAssistant.test.jsx`,
`AppSetup.test.jsx`) cover branching, validation, every pricing path against
the existing pricing contract, edit and dependent re-asking, persistence and
exact resume, offline fallback, Google redirect return, popup sign-in,
workbook creation, saved-workbook restore, explicit-only publishing with
merged branding/extras, publish failures, Account rerun and project prefill.
Browser QA drove the built assets at 390 px and 1280 px in light and dark
themes with synthetic API responses: no console errors or horizontal scroll.

Tests also cover fresh and returning entry, delayed/unavailable session checks,
cancelled consent, connected account changes, expired Google-backed refresh,
remembered workbook and exact draft retention, explicit device choice,
installation unavailable/dismissed/accepted/failed and standalone display.
Browser QA uses the built assets with synthetic loopback API responses. It
checks first-use setup, Connections navigation, returning-account visibility,
cold draft recovery, console health and phone-width installation instructions.
It does not grant Google access or install a real phone app.

## Release gates

The setup assistant is also frontend code and copy only. Its optional
publishing reuses the existing `/api/provider-branding` and
`/api/provider-pricing` endpoints and their D1 tables (migrations 0014 and
0015); where those are not yet applied it reports "awaits activation" and
keeps the answers on the device. Owner/device QA should include one real
Google sign-in round trip through the assistant on a phone, using synthetic
business details.

This is **frontend code and copy only**. There are no migrations, server-function
changes, required secrets, provider or environment changes. No Lovable action
is required. Keep payment/credit test modes, license enforcement, owner-only
checkout, webhook reconciliation, blocked AI and private coordination unchanged.

1. Review and merge the exact PR separately. This review does not authorize merge.
2. Verify Cloudflare Pages deployed the approved merged SHA through the existing
   pipeline. No manual backend activation or live setting change is needed.
3. Verify a genuinely new regular-browser visit, explicit device-only choice,
   Google consent cancelled/completed, correct email/workbook on a returning
   device, expired access and draft continuity. Keep Google grant expansion
   subject to explicit owner authorization; use synthetic isolated records.
4. On a physical Android phone, verify actual installed standalone mode, native
   install accepted/dismissed/unavailable, offline close/reopen and backup restore.
   Update an existing installed PWA with an unfinished draft and confirm it remains
   exact. Use a separate Android Guest space; Incognito is a first-visit observation,
   not persistent offline or installation acceptance.

Source/build/browser receipts establish review readiness. Deployment, real Google
consent, physical installation/recovery, paid launch and production capacity
remain separate gates. All pre-merge QA stays at $0 with synthetic providers.
