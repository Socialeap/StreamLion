# StreamLion project boundary

StreamLion does **not** use Lovable. Lovable has no development, backend,
configuration, deployment or publishing role in this repository.
Never generate Lovable handoffs, prompts or activation steps for StreamLion.
This project-specific boundary overrides generic Lovable workflow guidance.

Use repository/GitHub for code and review, Cloudflare Pages/Functions/D1 for
hosting and server metadata, Google Cloud for OAuth/API configuration,
Google Sheets/Drive for authoritative project records, and Stripe for payments.
Provider keys belong in server-only Cloudflare secrets.

Classify migration, configuration, server deployment, frontend deployment and
owner/device QA as separate release gates through those existing systems.
See docs/persistent-google-activation.md and docs/AI_PILOT.md for scoped steps.
