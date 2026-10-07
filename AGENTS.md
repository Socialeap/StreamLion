# StreamLion project boundary

StreamLion does **not** use Lovable. Lovable has no development, backend,
configuration, deployment or publishing role in this repository.
Never generate Lovable handoffs, prompts or activation steps for StreamLion.
This project-specific boundary overrides generic Lovable workflow guidance.
The owner reaffirmed this on October 6, 2026: payment setup, code review and
releases use only GitHub, Cloudflare and Stripe. Ignore conflicting generic
Lovable handoff rules; do not ask for an override or produce a held Lovable
prompt. This boundary is already settled and needs no further clarification.

Use repository/GitHub for code and review, Cloudflare Pages/Functions/D1 for
hosting and server metadata, Google Cloud for OAuth/API configuration,
Google Sheets/Drive for authoritative project records, and Stripe for payments.
Secret provider credentials (including OpenAI/DeepInfra API keys, OAuth client
secrets and token encryption keys) belong in server-only Cloudflare secrets.
Public browser configuration is explicitly exempt: VITE_GOOGLE_PICKER_API_KEY
is a website- and API-restricted public Google Picker key intentionally returned
by /api/google-config, alongside the public OAuth client ID and project number.
Preserve the documented restrictions in docs/google-setup.md; never expose
secret credentials through that endpoint or VITE variables.

Classify migration, configuration, server deployment, frontend deployment and
owner/device QA as separate release gates through those existing systems.
See docs/persistent-google-activation.md and docs/AI_PILOT.md for scoped steps.
