# Focused Ask workspace

The Ask page shows one task at a time: Project, Ask, or Answer. A desktop stage
rail becomes a horizontal icon strip on phones. Context, optional tools and
voice/AI settings open on demand. Switching views preserves the conversation;
changing the project or record scope clears it and stops the previous media.

The large microphone starts dictation. Final words populate the question, then
wait for an explicit **Get answer** tap. The user can review the words before a
paid request. Free lookup remains available; managed AI requires opt-in and
shows the current per-answer price and available credits in a quiet corner.

Listening uses mint, answer preparation amber, and speech playback violet.
Recognition speech events and playback lifecycle drive the visual state. CSS
motion stops with reduced-motion preferences. The activity bars are a state
indicator, not a measured audio waveform; no extra microphone stream or audio
recording is introduced. Stop remains available during a request or playback,
including when an optional panel is open.

## Visual fidelity check

Compared the generated mobile concept with the rendered implementation:

| Element | Rendered result |
| --- | --- |
| Layout | Selected project bar, Project/Ask/Answer strip, centered microphone, question, prominent submit button and optional tools. Desktop moves the strip to the left rail. |
| Typography | Strong task heading and action labels; small muted credit, source and settings text. |
| Palette | Existing dark navy/slate theme, mint primary actions and selected stage, violet speaking feedback. Existing light mode remains available. |
| Icons and brand | User-approved mint outline lion derived from the illustration replaces the earlier app image; shared Lucide microphone, stage, settings and tool icons remain consistent. |
| Spacing and copy | Controls adapt to shorter screens. Project names and prices come from application state; the local fixture explicitly says simulated/no charge rather than displaying production data. |

Long answers and panels can scroll within their own areas. The page keeps a
scrolling safety fallback for smaller viewports, zoom, multiple alerts and the
phone keyboard; this change does not promise zero scrolling in every condition.

## Validation

- 308 tests passed, including fixed credit units, empty-state Google refresh,
  explicit submission after dictation, credit opt-in
  without automatic submission, view switching, scope reset, recognition event
  guards, playback state and Stop.
- Production app/extension build, Cloudflare Functions compile, dependency audit
  (zero vulnerabilities), synthetic capacity verification and diff checks passed.
- Local browser fixture checked at 430×932, 390×667 and 1440×900. Main controls
  fit without document overflow; native panels open/close and restore focus.
  The browser error/warning log was empty in the final check.
- Fixture answers use synthetic records. No real provider calls, pilot grants,
  policy changes or provider spending were part of this validation.

## Release gates

This is a frontend change. No migration, backend configuration, secret or server
function change is required. No Lovable action is required.

1. Review and merge the PR through GitHub.
2. Verify the Cloudflare Pages deployment corresponds to merged `main`.
3. Apply the fresh PWA update on the owner's phone.
4. Test the physical Android keyboard, microphone feedback, transcribed-question
   review, Get answer, speaking feedback, Stop and panel navigation. Retain the
   prior pilot spending ceiling; do not activate paid testing without the
   existing operator controls and authorization.

The prior smooth voice-answer acceptance is separate from acceptance of this
new layout. The local fixture remains development-only and is excluded from the
production build inputs.

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
credits already held. Exact ledger integers, reservation/refund behavior and
the server's submitted-price check remain unchanged. Fractions retain their
exact five-decimal representation; missing/invalid values say unavailable.

Pilot allowances are not purchased currency. Commercial bundle prices and
markup remain undecided until measured provider usage, hosting/operations and
payment costs are reviewed. The future checkout must disclose bundle price,
credits received and applicable terms; the Ask view must display the current
credit charge before submission. No billing, top-up, grant or policy change is
included here.

The empty Project chooser also retains Refresh from Google, allowing connected
users to fetch newly added records without leaving Ask.
