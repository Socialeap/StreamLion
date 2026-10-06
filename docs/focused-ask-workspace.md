# Focused Ask workspace

The selected project, microphone, question and Get answer are the primary
controls. The Project/Ask/Answer strip, repeated task heading, free-lookup/credit
corner, mode row, idle status and routine Google-refresh text have been removed.
Read aloud lives at the top right next to the brand. Its preference and media
lifecycle still belong to the same conversation component.

Tap the project name to choose another project. Context, Tools and voice/AI
Settings open on demand. Ask another returns to the retained question; Last
answer in Tools restores the preceding answer. A new project/owner scope stops
media and clears the old conversation. Sources and record freshness remain
available under the answer's Sources disclosure and in Context.

Final dictated words wait for an explicit Get answer tap. The first eligible
AI request shows its current credit quote and provider disclosure, then asks for
consent. The choice is remembered only for the same Google account, workbook
and quoted price. A changed quote requires a new confirmation. The user can
choose free lookup in Settings. Storage contains the choice and an opaque scope
hash, never credentials, questions, records or audio.

An unavailable AI request shows the configuration reason and recovery controls.
It never quietly substitutes the narrow saved-field lookup for AI. Free lookup
is still an explicit alternative; unsupported questions retain the question and
explain that AI is needed, without an empty answer card or long canned speech.
Availability checks do not submit a question or spend credits. Initial config
loading blocks Get answer until the availability check finishes.

Listening is mint, preparation amber, and playback violet. Recognition speech
and playback events drive the animation; this is a state indicator, not a
measured waveform. Reduced-motion preferences disable motion. Stop remains
available during a request or playback, including inside optional panels.
Routine progress text is announced in the existing state region instead of
repeated in a second status paragraph. Errors and actionable fallback guidance
remain visible.

Long answers and panels scroll internally. A page-scroll fallback accommodates
small screens, zoom, extra alerts and the phone keyboard. Local fixture testing
cannot establish physical Android microphone, keyboard or hosted audio behavior.

## Validation

- 313 tests passed, including Workers runtime checks, cumulative-cap concurrency,
  account/workbook quote rejection, paused-pilot recovery, one-time consent,
  reopen/changed-price behavior, double taps and explicit dictation submission.
- App/extension build, Cloudflare Functions compile, synthetic capacity checks,
  dependency audit (zero vulnerabilities) and diff checks passed.
- Rendered local fixture checked at 430×932, 390×667 and 1440×900: primary actions
  fit, panels preserve the question, native consent opens/closes correctly and
  the browser warning/error log is empty. Temporary viewport overrides reset.
- Live investigation used read-only policy/wallet/config checks. No provider
  calls, grants, policy changes or credit spending were part of this revision.

## Release gates

This revision changes the frontend and the AI Cloudflare Function. It adds no
migration, secret, provider account, price change or credit grant. The existing
pilot policy must be reopened separately after the merged code is deployed.
No Lovable action is required. Follow the exact preflight and bounded activation
in `docs/AI_PILOT.md`, then refresh the installed PWA and repeat the owner test.
The original 30-total-attempt/$1 provider allowance remains in force, including
earlier attempts. Commercial rollout and markup remain separate decisions.

## Logo and credit display follow-up

The approved mint lion master is retained in
`assets/branding/lion-mint-source.png`; transparent app, 192/512px PWA and 64px
favicon derivatives are under `public/lion-mint*.png`. Versioned URLs avoid
reusing older icon cache entries. The app, local fixture, purchase page, welcome
page and public legal/support pages use these assets. Installed home-screen
icons may need the browser's normal manifest refresh or reinstall after release.

The built-in image-generation tool derived the logo from the approved concept.
Extraction prompt: isolate the top-left right-facing mint lion, preserve its
head/mane proportions, remove the wordmark and all UI/background, and output a
centered transparent square. Refinement prompt: preserve that silhouette and
render clean mint strokes without texture, gradients, decorations or lettering.
Production sizes are mechanical resizes of the retained master.

The fixed pilot display unit is **12,500 internal micro-units per credit**.
The current quote therefore shows **1 credit / answer** and the sample balance
262,500 shows **21 credits available**. Display conversion never divides the
balance by the current answer price: a future quote change must not relabel
credits already held. Exact ledger integers, the once-only refund behavior and
the submitted-price check are preserved; the new cumulative reservation guard
is described in `docs/AI_PILOT.md`. Fractions retain their
exact five-decimal representation; missing/invalid values say unavailable.

Pilot allowances are not purchased currency. Commercial bundle prices and
markup remain undecided until measured provider usage, hosting/operations and
payment costs are reviewed. The future checkout must disclose bundle price,
credits received and applicable terms; the Ask view must display the current
credit charge before submission. This revision introduces no billing, top-up or credit grant. Reopening the
existing policy is a separate post-deployment action, described above.

The empty Project chooser also retains Refresh from Google, allowing connected
users to fetch newly added records without leaving Ask.
