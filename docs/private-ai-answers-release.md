# Private in-app AI answers — release held

## Scope and data flow

Extends privacy filtering to `/api/ai/answer` only. The authenticated server still
reads the selected Google workbook and project; it filters that authoritative
snapshot and the submitted question before OpenAI. It does not accept client
supplied project context or add a new Google read. No source record or draft is
edited. The own-ChatGPT handoff and extension tools remain separate, unfiltered
paths and are described that way.

`src/privacy-filter.js` shares bounded detectors with browser brief preparation.
Strings are filtered before JSON serialization with one request-local map across
question, project fields and notes. Known names (including case variants), contact
details, addresses, links and project title are replaced. The whole access-
instructions field is excluded. Labeled secrets and recognized repetitions of
those secrets are removed rather than entered into the restoration map. Detection
can miss identifiers and can withhold legitimate wording that matches a secret;
this is assisted filtering, not guaranteed anonymization. Use saved-detail lookup
for access instructions. Brief preparation keeps its existing device preview,
6,000-character input limit and measurement behavior.

OpenAI receives only filtered context/question, with fixed instructions to retain
reference labels and never reconstruct removed access details. The map and raw
Google snapshot remain in server request memory; no new D1/Drive file, history,
answer cache, question log or recovery record is added. Different requests never
share a map.

The existing 10 KB context, 500-character source question, 240 output-token,
900-character answer, 60-second timeout, model, price, reserve and allowance limits
stay in force. Filtered context remains capped at 10 KB; references/maps/matches
are separately bounded. The complete bounded model answer is buffered until
completion and checked before any text or hosted speech is emitted. Unknown or
malformed references, newly generated detectable private data, or expansion past
900 characters fail/refund the one reservation. Buffering delays first text and
speech until validation completes; there are no automatic model retries. Existing
cancellation, duplicate protection and separate purchased/test funding remain.

Names/contact values are restored into the answer. **When hosted voice is
explicitly chosen, DeepInfra still receives the restored answer text, which can
include those details.** Consent, Credits and client notices, and both policy
copies state this. Model filtering does not promise privacy from the chosen voice
provider. Completed text remains charged if later voice playback fails.

## Separate release gates

1. **Review/merge — HOLD.** Owner review and passing required verify check. This
   implementation does not authorize merge.
2. **Migration — NONE.** Do not apply SQL, reset allowances, alter wallets,
   policies, journals, credentials or history.
3. **Configuration — PRESERVE.** No secrets, provider, mode or quota changes are
   needed. Keep general AI, brief importing, test/pilot controls and sales as they
   are. No live model test or funding is authorized.
4. **Functions deployment — HOLD** for merge and explicit release authorization.
   Only the merged Pages Functions are in scope; no cleanup/coordination Worker
   deployment is needed.
5. **Frontend/static release — separate HOLD.** New assurances require matching
   Functions code, Credits/client notices, consent and both policy copies. Pages
   releases these together; obtain authorization for both scopes. Keep drafts and
   storage, using ordinary PWA update rather than clearing site data.
6. **Post-release/device QA — separate gate.** Read served revision and closed
   AI/import/sales configs, verify notices and policy anchors, and preserve record
   fingerprints. No real AI call is allowed by the $0 checks. Mocks do not prove
   model accuracy, physical-device acceptance or free-tier CPU capacity.

StreamLion uses GitHub, Cloudflare and Google. No Lovable action is required.

## Validation

- 917 unit/integration checks passed, including real local SQLite/Workers
  fixtures with provider responses mocked. Route checks prove Google access
  remains GET-only, inputs are filtered, names and fractions are restored,
  malformed/unknown references and restoration overflow are withheld, and a
  canceled model stream refunds without speech or a retry. Complete multi-word
  credentials, including quoted/punctuated forms, are removed from repeated
  questions and context without entering the restoration map.
- Frontend/PWA/extension build, Pages Functions compile and local capacity checks
  passed. Both policy copies match and their internal section links resolve.
- No production requests, real AI calls, email, checkout, activation or spending.
- Streaming behavior checked against [OpenAI streaming response guidance](https://developers.openai.com/api/docs/guides/streaming-responses).
