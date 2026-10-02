# StreamLion landing page

## Surface and offer

`api/welcome.html` is a separate static Vite entry. The existing app remains at `/`.
Local preview: `/api/welcome.html`. The public URL is `/api/welcome`.
Cloudflare Pages redirects the HTML extension to the extensionless path, as described in
[Cloudflare's route matching documentation](https://developers.cloudflare.com/pages/configuration/serving-pages/#route-matching).

The `/api/` prefix is already excluded by the previously deployed service worker.
This static page needs no API handler. Its first navigation therefore reaches
Cloudflare even before an installed workspace updates its worker. Do not advertise
`/welcome`: older workers intercept that route before a server redirect can run.
The new worker retains its `/welcome` exclusion, but that alone cannot repair an
already-installed worker. Use `/api/welcome` for launch links and bookmarks.

The offer is $39.95 USD for a one-time purchase. The proposed launch discount
is 25% for the first 100 completed purchases: $29.96 USD, saving $9.99 after
rounding to cents. There is no countdown or invented remaining-purchase count.
The offer is planned; the page does not accept payment or reserve a discounted
place.

The launch CTA opens an accessible dialog and then a prepared email to
`info@transcendencemedia.com`. The visitor must send that message in their email
app. The landing page does not collect an email address, write a mailing list,
or claim that an unsent message subscribed them.

Automatic updates refer to the purchased app. Future premium upgrades have
separate availability and pricing. Free access to join the Frontiers|3D
Providers directory is explicitly forthcoming, with no claim of leads or
bookings.

## Demonstration

The hero leads into a saved-project voice-answer demo. A separate workflow demo
provides Prepare, On site and Handover selection.
The editable measurement example uses the app's actual `parseMeasurements`
function. It retains exact values and flags unclear wording. Editing the input
clears old results until it is organized again. The preparation checklist and
delivery, acceptance and payment statuses update locally. All data is labeled
as a sample, and no Google records are read or written.

The page uses self-hosted Manrope fonts under the included OFL license, the
existing lion assets, native HTML controls and a small dedicated script. It
does not load React, analytics, remote font services or an LLM API.

## Release classification

Frontend and build entry change only. No migration, new server function,
secret, provider configuration or backend activation is required.
No Lovable action is required; StreamLion uses GitHub, Cloudflare and Google
Cloud.

After PR merge, the ordinary Cloudflare Pages Git deployment publishes the
landing entry. Verify `/api/welcome`, both CTA locations, `/` app access and
`/privacy.html` on the deployed revision, including from an existing installed
PWA. Local design and interaction checks are not a production deployment
receipt or physical-phone test.

Before paid sales open, complete the app's production gates and a separate
reviewed purchase/entitlement flow. Enforce the first-100 limit at checkout,
with final taxes and discount displayed before payment. This PR does not
implement checkout, license enforcement, refunds, or discount inventory.

## Verification

- Production build passed for both app and landing entries.
- Focused measurement and Workbox navigation tests passed.
- Browser/IAB checked desktop and a 390 × 844 mobile viewport, including
  measurement organization, ambiguous wording, checklist updates, independent
  closeout statuses, modal close/Escape behavior and focus return.
- Design concepts and final browser screenshots were compared with
  `view_image`; the local design review includes the copy diff and intentional
  functional deviations. No QA images are shipped in the production bundle.
