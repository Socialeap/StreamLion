# Provider branding and form ownership

Providers manage their business name, optional logo, display shape (rounded
square, square or rectangle), and HTTPS website in Account → Your business
branding. A preview appears before an explicit Save. There is no paid service,
remote logo fetch, Google scope change, or automatic project-credit charge.

The provider screen shows “Request goes to [business name]” before sharing.
Public forms, prospect invitations and verified client workspaces use the
original connection owner's saved identity. Forwarding another provider's link
never transfers ownership. Submitted business names, profile IDs and connection
IDs cannot select a recipient. Google Sheets/Drive remain authoritative for
project records; D1 stores this public business profile separately, scoped by
Google subject and payment mode. Business branding is shared across that
account's workbooks in the same mode.

The TM preset is optional and uses Transcendence Media estimate rates. It never
changes the recipient. Providers can choose Standard work order or their own
service template. Existing service questions, template versions, links, project
records and drafts are not rewritten.

Logos accept PNG, JPEG or WebP up to 5 MB. The browser draws one static image to
canvas, strips the original metadata, preserves aspect ratio, and reduces it to
at most 640 × 640 and 80 KB PNG. The server validates the PNG envelope and size.
SVG, remote image URLs and executable website schemes are rejected. The shape
controls the display frame; the image is contained rather than cropped. Logo
and website are intentionally public to holders of the provider's client links.

Providers can also add an optional business phone and service area or
business address. The shared validator (`src/provider-branding.js`, used by the
browser and `/api/provider-branding`) accepts phones with 7–15 digits using only
digits, spaces, `+`, `( )`, `.` and `-`, and areas up to 200 characters without
control characters. Both are stored in the existing JSON profile only when
filled in, so profiles without them keep their exact saved shape and no
migration is needed. Client request pages, prospect invitations and client
workspaces show them on the provider card, with the phone as a `tel:` link.
Like the logo and website, they are public to holders of the provider's client
links. A server still running the previous validator ignores the two fields,
so they save only once the Functions from the same commit are deployed.

Providers can also write the **request assistant welcome line**: the first
thing a client reads when a public request form or invitation opens the guided
request assistant ([client request assistant](client-request-assistant.md)).
It is one line of up to 280 characters without control characters, stored in
the same JSON profile only when filled in; blank keeps the standard greeting.
It is edited in Account → Business branding or answered in the setup
assistant's Finish stage (client-request providers only). Like the other
branding fields it is public to holders of the provider's client links, and a
server still running the previous validator ignores it until the Functions
from the same commit are deployed.

Handovers are prepared on the provider's device, often offline, so the report
letterhead uses a contact card kept on that device
(`streamlion-provider-contact-v1`). Loading or saving branding in Account
refreshes it; before that, the setup assistant's answers are used. Projects and
the Google workbook schema are unchanged.

Existing links show the owner's current saved branding when reopened. If no
profile exists, they retain the legacy provider name. A missing migration keeps
legacy forms operational and disables profile saves. Other database failures
fail closed; they do not substitute a different provider. A stale profile save
returns 409 and keeps the editor input for review. Authentication is the existing
Google session; writes also require same Origin and matching account subject.
POST is bounded and never automatically retried. After an uncertain save, reopen
Account to check the stored version before resubmitting.

## Release checkpoints — all held pending merge and explicit release authorization

1. **Review/merge:** review this PR and require passing `verify`. Do not deploy
   unreviewed changes. The implementation commit uses `[CF-Pages-Skip]` only;
   GitHub Actions must still run. A merge is not a production release.
2. **D1 migration:** Cloudflare, production `GOOGLE_SESSIONS` binding only.
   Inspect `sqlite_master` and `PRAGMA table_info(streamlion_provider_branding_v1)`.
   If the table is absent, apply committed
   `migrations/0014_provider_branding.sql` byte-for-byte. If present, verify exact
   columns, primary key, checks and schema; partial or mismatched state means
   stop. Do not rewrite records, connections, forms, policies or credentials.
   Receipt: merged main SHA, D1 migration ID/result and verified table schema.
3. **Configuration:** none required. Preserve existing secrets, pilot modes,
   checkout restrictions, budgets, routing and Google scopes. No new service,
   upgrade, sales activation, emails, paid AI calls or credit spend.
4. **Functions deployment:** deploy the reviewed merged main Functions,
   including `/api/provider-branding` and branding responses for existing
   coordination handlers. Confirm anonymous branding GET is 401; a signed-in
   GET returns only that provider's profile. Check old public/private links
   without submitting or sending email. No project append is needed.
5. **Frontend release:** release assets from the same merged SHA, including
   Account editor, form recipient/branding display, optional-TM copy and manual.
   Record release SHA/deployment receipt separately from the Functions gate.
   Pages may publish Functions/assets together; both gates still need evidence.
6. **Owner/device QA:** after the above receipts, finish existing phone drafts
   before accepting the normal PWA update. In Account, save the owner's desired
   public business name/logo/shape/website; preview and open an existing client
   form to confirm branding and recipient. Check both rounded and rectangular
   frames at a narrow mobile width, then return to Account/Projects and confirm
   records, drafts and workbook/folder selections. Use only isolated QA records
   if submission proof is needed. Keep pilot modes unchanged and costs at $0.

No migration, deployment, owner branding save or production mutation is
performed by the review PR. This document is a release plan, not authorization.
