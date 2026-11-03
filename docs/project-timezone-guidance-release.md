# Visit time-zone correction

A scheduled start or end time requires the visit location’s time zone. Previously the export error named this requirement without identifying the Visit step. Replace the open text field with a native scrolling selector and a separate city/region search filter; typing in search cannot change the selected time zone. Use the runtime IANA list with a committed fallback list for older browsers, filtering unsupported fallback entries. Include UTC, preserve valid saved aliases, and retain invalid saved values as disabled options until corrected. Add guidance beside the time-zone field and, beside the Finish export error, an explicit step 5 instruction and “Review time zone in Visit” button. Missing and invalid time zones both receive the correction route. No time zone is guessed from the current device; no appointment time or existing record is changed automatically.

Verification: focused ProjectWizard tests exercise missing/invalid zones, correction to America/New_York, retention of the original local appointment time, and successful JSON export. Focused suite: 22 passed, including search filtering without changing the chosen zone, valid selectable codes, and saved-alias preservation. An isolated probe with Intl.supportedValuesOf disabled verified the older-browser fallback list. `npm test`: 1,232 passed, zero failures/skips. Build and diff checks passed. Physical Android QA follows deployment.

Review and merge this change, then separately authorize deployment of its exact merged SHA to Cloudflare Production Pages/Functions streamlion. No migrations, secrets, server-function changes or provider settings are required. Keep paid checkout paused, pilot disabled and existing metered holds unchanged. Verify canonical served SHA/health/holds before owner Android QA. Owner opens step 5 Visit, chooses the actual site time zone, then retries Finish export and opens the JSON. Rollback only frontend assets, preserving Google records and payment/refund processing.

Backend Activation Required: NO

No Lovable action is required.
