# Client invitation layout

`/api/client-requests` uses a full-width invitation flow instead of a fixed
310px sidebar beside an empty brief panel:

1. Choose the invitation method and service/intake.
2. Set public-form access or enter the known client's details.
3. Create and share, with a clear success state and a link to the saved form.

The first two stages have equal desktop columns and stack in order on smaller
screens. The create/share stage spans the width. Saved public forms have their
own responsive grid, with settings and sharing controls side by side when a
single form is shown. Projects appear before the selected brief; choosing a
project moves focus and the viewport to its details. No empty brief panel is
reserved when nothing is selected.

Existing public/private request payloads, template versions, verification,
delivery limits, QR and sharing behavior are retained. Starting a new invitation
clears the previous success message. The shared light/dark theme and provider
manual remain available.

## Validation

- All 521 repository tests and production app/PWA/extension builds passed.
- Local synthetic Chrome checks covered public/private creation, required email,
  retained contact details, copying, QR controls, selected-project focus,
  light/dark appearance and manual scrolling. Public and private forms were
  checked at 1440, 1024, 800, 768, 390 and 320px without horizontal overflow or
  browser errors.
- No real email, Google, payment or AI operations were used. Browser evidence is
  temporary and outside the repository.

## Release gates

Frontend only: no migration, backend activation, secret, configuration or server
function changes are required. Review and merge are separate from the existing
Cloudflare Pages frontend release and its revision receipt. Owner QA on installed
phone and desktop remains required: choose both invitation methods, create and
share a test form, check its QR code, and open a request. Existing PWA installations
should save edits before applying an available app update. This change does not
authorize a merge or claim physical-device acceptance.
