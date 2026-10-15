# First-run setup, account status and installation

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

Tests cover fresh and returning entry, delayed/unavailable session checks,
cancelled consent, connected account changes, expired Google-backed refresh,
remembered workbook and exact draft retention, explicit device choice,
installation unavailable/dismissed/accepted/failed and standalone display.
Browser QA uses the built assets with synthetic loopback API responses. It
checks first-use setup, Connections navigation, returning-account visibility,
cold draft recovery, console health and phone-width installation instructions.
It does not grant Google access or install a real phone app.

## Release gates

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
