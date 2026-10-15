# Mobile opener and navigation follow-up

## Review scope

This follow-up to PR #81 is frontend-only. It changes React views, shared CSS
and regression tests. It contains no Functions, D1 migrations, credentials,
provider configuration or pilot-mode changes. Records and draft formats are
unchanged. No live deployment is authorized by this review PR.

## User-visible behavior

- The opener starts without waiting for web fonts. Mobile browser-bar height
  changes no longer cancel the animation. Width changes, reduced motion,
  unsupported animation and failed/slow assets settle safely to the static
  composition. A five-second asset deadline is terminal: late images cannot
  restart the animation after the tagline has appeared.
- The existing six icons retain their 2.705-second complete-set hold. Pulls end
  at 3730 ms; the tagline starts at 3780 ms and finishes at 4080 ms. The wordmark
  sits farther below the illustration. Account controls remain available.
- Workspace headers show the lion, Manual, appearance controls and a profile
  avatar. The adjacent wordmark is hidden on narrow screens. Full email is
  available in Account, rather than a large Projects header card. Google
  remains responsible for password and account-security management.
- Account reuses the existing Google connection, sign-out, device backup and
  recovery controls, with links to license, credits and install guidance.
- App pages, Credits, Purchase and the Manual have bottom navigation. Long
  pages use Home plus section shortcuts. More than four sections uses three
  shortcuts and a Sections directory listing every available section with its
  icon and full title. Home returns to Projects. The opener has no bottom nav.
- Client Requests exposes only sections appropriate to the current role and
  access state. Section jumps reveal collapsed content and focus its target.
  Work-order tab forms remain mounted, preserving unsaved inputs. Navigation
  is disabled during pending operations and capture.
- Cross-page Account and Projects links consume their page parameter once;
  purchase gating remains enforced. Normal cold entry still opens the opener.

## Validation receipt

- 593 unit/integration tests pass, with no failed, cancelled or skipped tests.
  Coverage includes first entry, returning and expired sessions, purchase
  gating, exact draft preservation, active-capture navigation guards, image
  fallback, mobile resize, reduced motion, Manual stages, role-aware section
  menus, billing states, and synchronized header theme controls. Existing
  React act warnings remain in the test harness.
- Production app/PWA and extension build pass. Pages Functions compile passes;
  Functions source is unchanged.
- Chrome browser QA uses the built production bundle on a separate loopback
  origin with synthetic APIs. No request is forwarded to Google, Stripe,
  Resend or AI providers. Projects renders without a visible email card;
  Account and Manual open; every Manual stage and Client Requests section is
  discoverable; section jumps preserve the exact unsaved input; Credits Home
  returns to Projects. A local PWA bundle update preserves the seeded draft.
- No horizontal overflow at 320 px and 390 px phone widths or 1280 px desktop
  width. Motion inspection at 1500/3000 ms shows all six icons and no tagline;
  at 3730 ms both are hidden; at 4200 ms the tagline is visible. Desktop
  inspection confirms space between the illustration and wordmark.
- Browser QA is responsive Chrome validation, not physical Safari/Android
  acceptance. Reduced-motion behavior is covered by automated tests; physical
  reduced-motion and installed-PWA cold starts remain owner/device gates.
- Independent code review found no remaining material issue after fixing busy
  navigation and delayed-image fallback regressions.

## Separate release gates

1. Review this PR and confirm the required GitHub `verify` result for its exact
   head SHA. Commits use `[CF-Pages-Skip]` without `[skip ci]`: Cloudflare
   deployment is suppressed while the existing GitHub check can run.
2. Obtain explicit merge and Cloudflare release authorization. The only
   activation needed is an ordinary frontend release of the reviewed bundle
   to the existing Pages project. No backend, secret or provider change is
   required. No Lovable action is required; StreamLion uses GitHub/Cloudflare.
   Do not assume merging is deployment permission or that a merge proves the
   served SHA, particularly with the Cloudflare skip marker.
3. After an authorized release, verify the served SHA and PWA update, then
   check cold/new and returning entry on physical Android Chrome and iPhone
   Safari, height changes during motion, reduced motion, Account, Manual and
   Client Requests section jumps, Credits Home, and exact draft preservation.
   Use disposable QA records; do not clear real device storage.
4. Keep production sales, pilot settings, webhook reconciliation and provider
   spending unchanged. Sales activation remains a separate owner decision.
