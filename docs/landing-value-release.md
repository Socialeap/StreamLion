# Landing value revision: release receipt

**HOLD — ACTIVATE AFTER THIS PR MERGES.**

## Implemented

Interactive hero reveals; room/measurement-derived job-site checks and remaining-work results; named-space measurement organization; sample invoice balance and sequenced handover actions; editable task-based time estimates; direct Purchase Now! link; 200 checkout reservations; seven-day refund-request policy. The existing voice-answer sample remains intact. Details are in `docs/landing-page.md`.

## Source acceptance

- 180 automated tests passed, including real-parser/checklist/payment calculations, preservation of financial rows through migration, uniqueness constraints, simultaneous final-slot purchases, refund/webhook replay and buyer restoration.
- Vite production build and Cloudflare Pages Functions compilation passed.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- Desktop 1440 × 1000 and mobile 390 × 844 browser checks: hero click/keyboard reveals, edited scope invalidation/rebuild, remaining-work list, named metric readings, blank-space guidance, handover decisions/$150 balance, editable/invalid time estimates, configured/exhausted offer, direct purchase link and zero console errors. Mobile document width matched viewport width.
- Sample values and Stripe quotes used for browser QA are synthetic. Physical Android, real Stripe test Checkout, production migration/configuration and deployment acceptance remain separate gates.

## Required activation

Pricing fallback follow-up: the public HTML advertises $39.95 with promotional pricing/comparison hidden. Only a valid live quote with a positive launch-slot count reveals a discounted offer. Network errors, non-2xx responses, malformed/invalid configuration and unavailable JavaScript keep that safe default. All 18 targeted landing tests and the production build passed for this correction.

**Cloudflare owner, after merge:** apply `0004` only if its complete purchase schema is absent, then `0005_streamlion_launch_200.sql` using the idempotent preflight in `docs/stripe-activation.md`. Verify v1/v2 stamps, the 1–200 CHECK, preserved financial state and uniqueness indexes; staging must be absent. Configure `STREAMLION_REFUND_DAYS=7` for this offer. Deploy the approved merged main's Pages frontend and Functions, recording its SHA/revision.

**Stripe owner:** complete the existing account's sandbox product/key/webhook and refund/restore acceptance before approving live activation. The expanded slot cap does not replace that work. The guarantee is handled through the support email and manual full refunds in Stripe. Keep any earlier, longer purchased refund rights.

**Publication/owner QA:** verify `/api/welcome`, `/api/purchase`, terms, exhausted promotion, Google/workspace restoration and Android navigation on the deployed revision. Public promotion and live charging follow the separate approval/receipt gate in the Stripe runbook.

**No Lovable action is required.** This project uses GitHub, Cloudflare and Google Cloud. No schema or secrets are activated by this source receipt, and no real payments were taken.
