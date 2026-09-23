# v0.2 implementation checks — 2026-09-23

- `npm test`: 19 tests passed, including recorder permission/recovery regressions, exact intake values, revision conflicts, retry idempotency, draft isolation and protection of newer drafts after delayed save acknowledgments.
- Final Google range-read adjustment: Google adapter test rerun successfully; reads use actual sheet grid height and include populated extra columns for schema validation.
- `npm run build`: production bundle and PWA service worker generated successfully.
- Plugin skill and manifest validators passed. Private StreamLion plugin updated to 0.71.0, release `pluginrel_6ab36856a0b481919b0e1ab6e59dbf9c`. This release changes instructions; it does not attach a Google account or prove voice tool support.
- Browser on local `http://127.0.0.1:4174/`: synthetic JSON import → reviewed project → area note → navigate away/back → draft restored → save → Ask handoff. Exact `10 ft 4 3/32 in` retained. Google setup screen rendered. No browser errors/warnings observed.
- Desktop and narrow layout visually checked; actual narrow browser width was 500px. Physical phone layout/microphone/ChatGPT voice acceptance is still pending.

The Google adapter tests use synthetic OAuth/fetch responses. A real Google OAuth client has not been configured; no live Sheets write or document-to-Google-to-PWA roundtrip is claimed. Production remains the previously deployed version until review/merge and Cloudflare publication. Follow [Google setup and owner acceptance](google-setup.md) before declaring the connected workflow ready.
