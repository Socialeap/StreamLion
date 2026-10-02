# Visitor flow and provider value revision

## Decisions from the audit

1. **P1 — Make the first screen clear.** Name 3D/360 providers in the supporting
   line and lead with arrival readiness and complete site records. Keep one
   primary action to try a sample job, with pricing immediately reachable.
2. **P1 — Demonstrate once.** Remove the duplicate workflow strip, numbered
   feature rail and staged hero controls. Use one interactive Prepare / On site /
   Handover showcase. Each selected stage pairs the actual controls with one
   business consequence and a specific next action.
3. **P1 — Show value rather than assert ROI.** Add a local break-even estimate
   using minutes saved per job and the visitor's hourly value. Compare estimated
   time value with both advertised one-time prices. Defaults are explicitly
   illustrative, not measured customer results or a guarantee.
4. **P2 — Reduce reading and expose navigation.** Provide direct links to demo,
   value, pricing and questions. Replace long FAQ answers with concise answers
   and link to the detailed privacy policy. Keep mobile targets usable and all
   visible interactions keyboard accessible.
5. **P2 — Keep trust grounded.** Saved records are in the chosen Sheets/Drive;
   drafts may be local and Cloudflare processes connections. Do not use “100%
   yours,” “safely,” “Google Drive native,” or “all-in-one” to imply exclusive
   storage, guaranteed security, scan creation, tour hosting or live ChatGPT
   access. Keep paid sales closed and directory benefits forthcoming.

## Provider value chain

| Capability shown                             | Provider consequence                               | Evidence boundary                                           |
| -------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Brief, access and checklist                  | Prepare before travel; notice missing scope/access | Demo controls and current product workflow                  |
| Room measurements and field notes            | Reduce reconstructing the job later                | Exact-value parser with ambiguity flags; user verifies tape |
| Independent delivery, acceptance and payment | Identify remaining follow-up                       | Local sample statuses, no automatic collection claim        |
| No recurring StreamLion subscription         | Predictable app price                              | Planned one-time purchase, checkout still closed            |

## Calculation

Estimated value per job = entered minutes / 60 × entered hourly value.
Break-even jobs = ceiling(price / estimated value per job), calculated using the
unrounded estimate. Invalid, empty, zero, negative or out-of-range inputs do not
produce a savings claim. Both prices remain fixed at $39.95 and $29.96. Tax,
provider fees, actual time saved and other costs are not modeled. Values remain
on the page; no analytics or data transmission is added.

## Release classification

Frontend only. No Lovable action is required. No backend migration, provider,
secret, payment or analytics changes. Merge, ordinary Cloudflare Pages Git
deployment and live visitor QA are separate gates. Paid checkout and product
production checks remain separate from landing-page improvements.

## Visual specification and fidelity review

Section concepts (local review artifacts, not shipped raster UI):
`../landing-review/visitor-value/concepts/hero.png`, `demo.png`, `value.png`.
The implementation keeps the concept composition with these intentional
corrections: retain the existing lion brand; remove invented sidebar tabs,
stock property photos and tour thumbnails; retain current sample job values;
use the hero navigation consistently instead of the differing generated headers.
These changes avoid implying tour creation/hosting or nonexistent app screens.
The concept is a direction for the revised sections, not a pixel-perfect asset.

Screenshots were captured through the Codex In-app Browser against the built
Cloudflare Pages preview at `/api/welcome`. Both the three concepts and the
latest rendered section screenshots were inspected with `view_image` at
original detail. The native concept viewport sizes were checked: hero
1659×948, demo 1774×886, value 1487×1058. Browser screenshots exclude/scale
the viewport scrollbar area (1644×939, 1759×879, 1472×1047 respectively);
DOM viewport dimensions were verified separately. Mobile was checked at 390×844.
Viewport overrides were reset after testing.

| Comparison point   | Concept evidence                                         | Render evidence / decision                                                                                                                    |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy and hierarchy | Action-oriented hero with two actions                    | Hero headline, supporting line, CTAs and ownership line retained verbatim                                                                     |
| Composition        | Copy left, product panel right                           | Two-column desktop hero and a stacked mobile continuation                                                                                     |
| Product imagery    | Generated workspace with extra navigation/photos         | Compact native brief rows replace invented controls and tour imagery                                                                          |
| Typography         | Large Manrope-style heading, quieter supporting text     | Existing Manrope retained; heading scale capped for readability and section continuity rather than copying generated oversized text           |
| Palette            | Off-white, evergreen, sage and lime                      | Existing brand palette retained; no new gradients or photo overlays                                                                           |
| Demo               | Green band, vertical numbered stages, white sample panel | One stage selector; real checklist, parser and independent closeout controls; no duplicate process rail                                       |
| Value estimate     | Inputs, time value, two prices and comparison bars       | Native inputs and outputs, one clearly labelled progress bar per price; generated extra comparison bars removed to avoid ambiguous quantities |
| Spacing and mobile | Spacious desktop composition                             | Bounded containers, 44px mobile nav targets except existing 42px Open app; no horizontal overflow at tested sizes                             |

Above-fold copy diff: no new eyebrow or badge. Hero copy, nav labels and
three benefit captions match the selected concept. Intentional differences:
existing browser-frame title and existing lion, no generated sidebar labels
or photos, secondary pricing CTA uses the existing text-link treatment,
arrow added as a decorative CTA icon. The one-time price and unavailable
checkout disclosure remain grounded in the existing product state.

The revised implementation was faithfully verified against the selected
composition and documented functional corrections. No material unintended
visual mismatches remain in the inspected views. Generated assets are design
references only; all visible controls, fields, labels and tables are native HTML.

## Verification receipt

- PASS — production build (`npm run build`).
- PASS — 13 focused tests: calculator, measurement parser and navigation/SW routes.
- PASS — primary hero link reaches the single demo; numbered controls switch stages.
- PASS — checklist updates its count; wording without units stays flagged.
- PASS — changing delivery leaves acceptance/payment independent.
- PASS — calculator defaults show $10.00 / 4 standard jobs / 3 launch jobs;
  20 minutes shows $20.00 / 2 / 2; zero hides estimates and offers a correction.
- PASS — mobile calculator inputs fit; navigation is visible; no sideways overflow.
- PASS — launch dialog clearly requires sending an email, takes no payment,
  and closes using Escape; no email was submitted.
- PASS — no broken images or browser console errors in inspected preview.
- PASS — main-page source text reduced from 761 to 588 words (22.7%), including
  initially collapsed FAQ answers and demo states, excluding header/footer/dialog.
- NOT RUN — production Cloudflare deployment and live visitor QA; pending merge.

Local screenshots: `../landing-review/visitor-value/hero-native.jpg`,
`demo-native.jpg`, `value-native.jpg`, `mobile-header.jpg`, `mobile-value.jpg`.
