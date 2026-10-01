# StreamLion policy pages

Operator confirmed by owner: Transcendence Media LLC.
Support/privacy contact: info@transcendencemedia.com.
Effective date: October 1, 2026.

## Public routes

- Privacy: `/api/privacy` (static `public/api/privacy.html`).
- Terms: `/api/terms` (static `public/api/terms.html`).
- Landing: `/api/welcome`.

Both footer destinations are under a prefix excluded by the previously deployed
service worker, so first visits do not require a workspace update. The existing
`/privacy.html` OAuth URL remains a full copy of the privacy policy; keep it
identical to `public/api/privacy.html`. New workers also exclude `/privacy`,
which Cloudflare's HTML-extension redirect can produce.

## Policy basis and boundaries

The notices were checked against the implemented Google proxy, encrypted
Cloudflare session store, essential sign-in cookies, request limits, cleanup,
browser storage, media capture and manual ChatGPT snapshot handoff. Disclosures
include transient processing of Google content by Cloudflare; Google is the
saved-record destination, not the only processor. No legal compliance
certification, absolute security guarantee or verified operational-log retention
period is claimed.

Primary drafting references:
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [FTC privacy and security guidance](https://www.ftc.gov/business-guidance/privacy-security)
- [FTC online shopping guidance](https://consumer.ftc.gov/articles/online-shopping)

Terms describe the current pre-sale release and the planned one-time purchase.
They do not invent a refund window, legal venue, business address or checkout
processor. Before paid sales open, the owner should obtain jurisdiction-specific
legal review and finalize checkout disclosures, license scope, cancellation and
refund terms, tax treatment and purchase assent/receipts. Those are commercial
launch gates, not backend actions introduced by these static pages. No forced
arbitration or consumer-rights waiver is added.

## Release classification

Static frontend content, stylesheet, footer links and navigation exclusions only.
No backend, migration, secret or provider change is required. No Lovable action
is required. Merge, Cloudflare Pages deployment and deployed-link QA are separate
steps. Verify both footer links, contents anchors, return-to-landing links and
legacy privacy URL on the deployed revision, including an existing installed PWA.
The existing Google OAuth privacy URL continues to work; no console edit is
required for this change.

## Validation receipt

- Production build and both focused Workbox navigation tests passed.
- Local Wrangler Pages returned HTTP 200 and the correct content at
  `/api/welcome`, `/api/privacy`, `/api/terms` and the legacy `/privacy.html`.
- Footer links and contents anchor targets were checked in served HTML;
  legacy and canonical privacy source files are identical.
- Browser checks exercised both landing footer links, privacy-to-terms
  navigation and return to landing. Desktop privacy and 390 × 844 mobile terms
  layouts were inspected; no mobile horizontal overflow or missing images,
  and no relevant browser error/warning logs were observed.
- Earlier preview-tab timeouts were resolved using a fresh tab.
