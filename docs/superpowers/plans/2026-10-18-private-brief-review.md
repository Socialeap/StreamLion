# Privacy-filtered brief preparation implementation plan

**Goal:** Implement the owner-approved privacy preview and bounded generate → check → correct → recheck workflow, without activation or spending.

**Spec:** The approved conversation: extract on-device; replace detected and user-selected private details consistently; never send replacement values or credentials to OpenAI; review against the complete filtered source; regenerate once on findings; recheck; preserve source ambiguity for provider confirmation. One existing quoted charge, unchanged pilot gates, explicit review before filling empty draft fields.

**Architecture:** Browser creates a bounded replacement map and filtered preview. The authenticated server validates that envelope, sends only filtered content to GPT-6 Luna, checks reference integrity, then restores details before encrypting the existing temporary result. Replacement maps exist in request memory, never logs or separate durable storage. Failed/interrupted jobs retain existing refund/no-replay semantics; completed results recover without a device-local map. No D1 migration or new service.

**Tech stack:** Existing React/JavaScript, Responses strict schemas, Cloudflare Functions, existing D1 credit journal/encryption; mocked provider responses only.

## Constraints and review focus

- Preserve source/drafts/records, existing 24-hour recovery and account/workbook authorization.
- Detection is assistance, not guaranteed anonymity. Exact known details and user-marked phrases supplement contact/address patterns; generic filename sent upstream.
- Secrets are removed; they are not reinserted into AI output. Existing project access instructions are untouched.
- New privacy protocol fails closed for stale clients before debit. Historical encrypted results remain readable.
- At most four provider calls with one shared 45-second deadline, no network retries, existing $0.10 minimum reserve. Enforce a conservative aggregate token-cost bound below the reserve using bounded request bodies/output.
- Strict email/URL schema accepts reference labels during processing and validates real values after restoration. Reject unknown labels and malformed maps.
- Omitted requirements trigger repair; unresolved source gaps/conflicts remain confirmation items. Final unresolved extraction defects fail/refund, never loop or claim verified accuracy.

## Execution

- [x] Test privacy replacement/restoration, credentials, filenames, repeated references, unknown IDs, measurements, envelope bounds and manual masking; observe failures, implement shared module.
- [x] Test real extraction with injected OpenAI responses for two/four passes, source issues, final defects, malformed review, timeouts and privacy boundaries; observe failures, implement bounded cycle.
- [x] Integrate the envelope before debit, include workflow in quote, retain encrypted restoration/recovery, update endpoint fixtures and verify exactly-once charge/refund under concurrency and response loss.
- [x] Add accessible browser preview/manual masking, concise disclosure, reviewed result wording, preservation tests and recovery without local replacements.
- [x] Update privacy copies/release gates, run complete tests/build/Functions compile and review the final diff. Prepare the commit and review PR handoff on a codex branch. No merge, migration, deployment, settings or paid calls.
