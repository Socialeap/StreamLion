# Voice project answers: landing feature

## Verified implementation

Read the task “🦁• 10/1-8:18pm→API StreamLion to AI Model” and the merged PR #27
(`34fdfa0`, merged into main `e8d9b36`). The feature is bounded, read-only saved-field
lookup, not an OpenAI/Gemini integration. It supports the selected project's
address, contact, access, visit, work, deliverables and payment, names sources,
and optionally speaks the answer. Browser support varies. Actual phone speech
and playback still need physical-device validation; no live hardware test is
claimed by the landing update.

## Design specification

Make retrieval the first demonstration after the hero. The desktop section
pairs open editorial copy with one native phone-shaped preview. Mobile stacks
copy and preview. Reuse paper #f7f8f2, forest #173e31, lime #e2edb5, self-hosted
Manrope, outline mic/speaker icons and the existing lion. No stock photos,
model logos, fake voice waveforms or speed/savings statistics.

Headline: **Ask the job. Keep moving.**
Supporting line: **Tap. Ask a saved project detail. Read the answer—or hear it aloud.**
Visual sequence: **Select your project → Tap Ask by voice → Get the saved detail.**
Benefit: **Less digging through sheets. More focus on the capture.**
Example: **Who is the site contact?** → the saved contact and telephone, with field sources.
Additional examples: access and deliverables. The sample uses the same answer
lookup as the app; it never connects to Google or requests a microphone.

Concept: `../landing-review/voice-feature/concepts/voice.png`.
The phone is a demonstration of the interaction, not an exact product screenshot.
Intentional corrections to generated concept: remove invented handwritten slogan,
background flourish, OS time/status bar and ellipsis; use **Try sample question**
in the demo instead of **Ask by voice**, so it never implies live listening;
use the app's actual field labels. Keep the native **Read answer aloud** action
as an optional, user-triggered sample. Hero CTA becomes **Try voice answers**;
add a direct **Voice answers** nav link and concise FAQ/pricing mention.

## Release classification

Frontend only. No Lovable action is required. No AI API, new credentials, backend,
Google scope, analytics, real audio recording or project-data writes. After merge,
Cloudflare's normal Git deployment and a separate live landing check are required.
This change does not resolve the actual-phone speech validation gate for PR #27.

## Verification receipt

- Production build: PASS. Focused answer, value and public-navigation checks:
  11 passed, 0 failed. `git diff --check`: PASS.
- Browser: Codex In-app Browser, built Cloudflare Pages preview at
  `http://127.0.0.1:4181/api/welcome`. Tested default 1280 × 720, concept-native
  1672 × 941, and mobile 390 × 844 viewports. No horizontal overflow or broken
  images; no captured browser warnings/errors. Mobile question chips are 44 px
  high. The first hero action reaches the new section; its secondary action
  reaches the example phone.
- Interactions: contact, access and deliverables each produce the actual bounded
  lookup's answer and field source; selected chips change. Sample action explains
  the real app's voice action without requesting a microphone. Read-aloud enters
  its Stop reading state; changing the question resets/stops the owned utterance.
  This is UI/lifecycle proof, not a claim that sound was audible or phone
  recognition worked.
- Screenshots: `../landing-review/voice-feature/native.jpg`, `desktop.jpg`,
  `mobile-story.jpg`, `mobile.jpg`. Native concept and latest browser renders
  were opened with `view_image` and compared directly.

### Fidelity ledger

| Comparison             | Concept evidence                                               | Render evidence / resolution                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Copy hierarchy         | Two-line Ask the job / Keep moving, one supporting sentence    | Exact headline, supporting copy, numbered sequence and benefit preserved                                                                                     |
| Layout                 | Editorial left column, phone right, open paper background      | Same composition at native dimensions; one column on mobile                                                                                                  |
| Typography             | Bold dark headline, restrained sentence and small phone labels | Self-hosted Manrope throughout; retained site's 68 px desktop heading cap and 42 px mobile heading for consistency, rather than the generated oversized type |
| Palette                | Forest text/frame, pale green selected controls, white phone   | Existing paper/forest/lime tokens retained; no photo wash or gradient introduced                                                                             |
| Icons and media        | Mic circle, speaker outline, decorative OS/status elements     | Native SVG mic/speaker; OS/status/notch and flourish deliberately omitted so the preview remains an illustration                                             |
| Containers and spacing | One phone frame; sparse sequence and answer/source panel       | Open section, 72 px desktop gutter, 42 px sequence circles, white answer card, thin source divider; no additional feature-card grid                          |
| Interaction copy       | Generated Ask by voice label in a non-listening sample         | Renamed Try sample question; sample and browser-support captions are visible; actual app retains Ask by voice                                                |
| Source accuracy        | Generic Contact 1 label                                        | Uses actual On-site contact 1 label from shared lookup; no invented live-Google status                                                                       |

Above-the-fold copy diff: existing hero headline and subscription line retained;
hero lead now explicitly mentions saved project voice retrieval. Primary CTA is
**Try voice answers**; nav adds **Voice answers** and renames **Try it** to
**Workflow**, removing **Your return** from header to keep it compact. ROI remains
on the page. These are intentional feature-emphasis changes. No additional hero
badge, speed claim, ROI statistic or unrelated product promise was added.

Faithfully verified against the concept with the intentional production
adaptations listed above. No remaining material layout, overflow, clipping or
interaction mismatch was observed in the checked views. Physical-device speech
and a fresh production deployment remain separate checks.
