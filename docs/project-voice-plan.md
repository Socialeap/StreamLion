# Project voice answers: implementation and release plan

## Goal

Open a saved project, tap **Ask by voice**, ask one short factual question,
and receive the saved answer in StreamLion. **Read answers aloud** is optional
and remembered on this browser. No OpenAI/Gemini API key or LLM bill is required.

## Implementation sequence

1. Build a bounded, read-only lookup for address, site contacts, access, visit,
   scope/exclusions, delivery requirements, and separate payment facts. Cite
   exact saved field names. Unknown values stay unknown; refuse arbitrary calculations,
   measurements, conditional advice, changes, and unsupported questions.
2. Use one browser speech session per tap, English (`en-US`) in this prototype.
   Show recognized wording; automatically submit only final readings. The user
   can tap **Get answer** as soon as words appear, including interim readings,
   or edit them; either action stops recognition and ignores late callbacks.
   Low-confidence wording stays editable for confirmation. Limit listening to
   20 seconds; allow cancel. Dismiss the keyboard and bring each answer or
   unsupported-question guidance into view, above the mobile navigation.
3. Offer opt-in browser speech playback plus manual read/stop. Stop microphone
   before playback to prevent feedback. Keep text available if audio fails.
4. Put the same controls on Project home and Ask, keeping the selected project
   and ownership scope. Abort media and ignore late callbacks on project/data/
   owner changes, unmount, or backgrounding. Include voice busy state in the
   existing app-update gate. Preserve clipboard/ChatGPT handoff state.
5. Validate lookup correctness and media lifecycle using synthetic records.
   Check desktop/mobile rendered controls, missing speech APIs, permission
   errors, and unsupported questions. Test actual Android separately.

## Data, privacy, cost

- Lookup runs against the selected saved record already loaded by StreamLion.
  No new project database, write, automatic refresh, or external AI request.
- Google results show their last read time. A disconnected site copy is labelled
  as a saved copy needing reconnection; device records are not Google-verified.
- Questions/audio are not persisted by StreamLion. Only the read-aloud preference
  is stored. Browsers may send dictation audio to their speech provider and may
  need internet. This feature is not guaranteed to transcribe offline.
- Browser speech support varies. Always retain typed input and keyboard dictation.
  Source facts remain separate from any optional ChatGPT discussion.
- No new secrets, OAuth scopes, providers, backend functions, schema, or dependencies.
  Existing microphone permissions remain user controlled. No Lovable involvement.

## Acceptance and release gates

Automated: exact saved references/units preserved; offered/agreed/invoiced/received
remain distinct; proposed dates are not confirmed appointments; missing and
unsupported facts remain explicit; one project cannot answer for another;
permission/network/start failures remain recoverable; late callbacks after cancel,
background, ownership change or unmount cannot display or speak an answer;
timestamp-only rerenders preserve the active session. Build and existing Ask
handoff regression tests pass. Desktop/mobile rendering has no clipping or app errors.

After authorized merge, Cloudflare's normal frontend deployment must publish this
revision. No backend activation/configuration is required. On physical Android:

1. Select a known saved project; ask “What is the address?” and “Who is the site contact?”
2. Enable read-aloud; ask about access, verify exact text and spoken answer; stop playback.
3. Deny microphone once; verify clear recovery and typing/keyboard dictation.
4. Cancel, switch project, and background while listening; confirm no old answer/audio.
5. Disconnect/offline: verify copy labels and typed answers, without a live-Google claim.
6. Ask an unsupported question and verify the existing optional ChatGPT handoff.
7. While words are visible and **Cancel listening** still appears, tap
   **Get answer**. Verify listening stops and the answer is visible immediately.
   Repeat by editing the recognized words, then submitting; repeat an unsupported
   question and verify visible guidance rather than an apparently inactive button.

Browser mocks prove lifecycle logic, not hardware speech accuracy or browser
permission behavior. Physical Android speech/playback and live deployment remain
separate gates; do not call the feature production-verified before those pass.

## Deferred work

Free-form reasoning, field-note/measurement search, additional languages, wake words,
background listening, ChatGPT plan authorization and paid API integrations are out
of scope. Keep the core one-time-purchase path useful without those dependencies.

## Validation receipt (2026-10-01)

| Check                                                       | Result                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Complete automated suite                                    | PASS — 149 tests                                                           |
| Voice/lookup/App update/ChatGPT focused tests               | PASS — 18 tests                                                            |
| Production Vite/PWA build and diff whitespace               | PASS                                                                       |
| Page identity, meaningful render, no framework overlay      | PASS — local field workspace                                               |
| Browser console                                             | PASS — zero errors or warnings                                             |
| Desktop / mobile layout and screenshot inspection           | PASS — 1280×900 and 390×844; no horizontal overflow                        |
| Project creation → home → simulated spoken contact question | PASS — exact synthetic contact returned; recognition aborted before answer |
| Ask → typed address question                                | PASS — exact synthetic address and device source label                     |
| Physical Android microphone / speech accuracy / playback    | NOT RUN — owner hardware check after deployment                            |
| Live Google roundtrip / production deployment               | NOT RUN in this change                                                     |

Browser plugin was not available; rendered checks used the existing cached
Playwright CLI with isolated Chrome, synthetic local records, and a stubbed
disconnected Google session. Speech events were simulated; no real audio or
Google data was captured. Screenshots and test logs stayed outside committed source.
The two other StreamLion Codex chats were verified idle before and after implementation.

Browser references: [speech recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
and [speech playback](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis).

PR #27 review regressions: checking or unchecking read-aloud during recognition
uses the current preference without restarting the microphone. Temporal questions
require a topic-specific subject; payment and delivery dates do not expose visit
dates, and “delivery due” does not accidentally include payment dates. The three
new tests reproduced both findings before the fixes and pass after them. Existing
rendered UI evidence above is unchanged; this follow-up changes logic only.
