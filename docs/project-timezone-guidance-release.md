# Visit time-zone correction

A scheduled start or end time requires the visit location’s time zone. Previously the export error named this requirement without identifying the Visit step. Add guidance beside the time-zone field and, beside the Finish export error, an explicit step 5 instruction and “Review time zone in Visit” button. Missing and invalid time zones both receive the correction route. No time zone is guessed from the current device; no appointment time or existing record is changed automatically.

Verification: focused ProjectWizard tests exercise missing/invalid zones, correction to America/New_York, retention of the original local appointment time, and successful JSON export. Build and diff checks must pass before review. Physical Android QA follows deployment.

Review and merge this change, then separately authorize deployment of its exact merged SHA to Cloudflare Production Pages/Functions streamlion. No migrations, secrets, server-function changes or provider settings are required. Keep paid checkout paused, pilot disabled and existing metered holds unchanged. Verify canonical served SHA/health/holds before owner Android QA. Owner opens step 5 Visit, chooses the actual site time zone, then retries Finish export and opens the JSON. Rollback only frontend assets, preserving Google records and payment/refund processing.

Backend Activation Required: NO

No Lovable action is required.
