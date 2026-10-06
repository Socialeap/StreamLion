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
| Icons and brand | Existing StreamLion lion image retained; shared Lucide microphone, stage, settings and tool icons replace the concept's generated brand artwork. |
| Spacing and copy | Controls adapt to shorter screens. Project names and prices come from application state; the local fixture explicitly says simulated/no charge rather than displaying production data. |

Long answers and panels can scroll within their own areas. The page keeps a
scrolling safety fallback for smaller viewports, zoom, multiple alerts and the
phone keyboard; this change does not promise zero scrolling in every condition.

## Validation

- 306 tests passed, including explicit submission after dictation, credit opt-in
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
