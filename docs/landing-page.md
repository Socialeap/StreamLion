# StreamLion public landing page

## Surface and offer

`api/welcome.html` is the standalone Vite entry at **`/api/welcome`**; the workspace remains at `/`. Preview uses `/api/welcome.html`. Use `/api/welcome` for public links so an older installed PWA does not intercept this entry. The `/api/` navigation exclusion remains unchanged.

The requested offer is **$39.95 USD one-time**, **$29.96 for the first 200 launch checkout places**, saving $9.99 (25% rounded to cents). Places are reserved at checkout initiation, retained for pending payments, and released after confirmed expiry/failure. Completed purchases retain their historical place. There is no countdown or invented remaining-buyer count.

**Purchase Now!** links directly to `/api/purchase`, with or without landing-page JavaScript. The purchase page rechecks account, price and availability before creating hosted Stripe Checkout. Default payments remain disabled; this change does not enable live charges. A valid live configuration updates displayed prices, discount and refund period; an exhausted promotion removes its discount and comparison. See [Stripe activation](stripe-activation.md) before public promotion.

The requested **seven-day money-back guarantee** is a request window from payment, not a bank-settlement deadline. Requests go to `info@transcendencemedia.com` with the receipt. The owner processes refunds in Stripe; the app's key does not need refund-write permission. Earlier, longer refund rights remain intact. Purchase terms and hosted Checkout describe the same policy.

## Demonstrations and copy

- **Hero:** three accessible buttons reveal the brief, original-to-organized room readings, or specific unfinished work. Arrow keys/Home/End switch reveals. Each reveal stays beside its control and links into the corresponding workflow demo.
- **Ask the job:** the existing interactive, source-labeled voice-answer sample is preserved.
- **Prepare:** explicit sample spaces and requested dimensions generate individual capture/tape-check actions. The actual `requirementsFromBrief`, `scopeSignature` and `beforeLeaving` functions track requirements and report remaining work. Editing the optional sample brief disables old checks until rebuilt. This is an explicit-room example, not a general-purpose freeform scope parser. Unknown rooms are not inferred.
- **On site:** visitors enter a room/space name and readings. The actual `parseMeasurements` function retains exact values and flags ambiguity. Edited input clears old results; a missing space name prompts guidance and produces no unlabeled result.
- **Handover:** statuses produce sequenced next actions. An explicit $300 sample invoice and $150/$300 received choices use the real `paymentSummary` calculation. A missing received amount stays unknown; accepted-but-unsent records prompt verification before duplicate delivery. Receipt of payment alone does not complete handover.
- **Time value:** three editable task rows compare today's timings with an organized-workflow scenario. Assumptions are visible; the visitor does not need to guess total savings. The net time difference (including any extra work) is valued at the visitor's hourly rate. Zero/negative differences show no positive return; incomplete fields hide stale results. Example timings are planning inputs, not measured customer performance.

Samples stay in the page and do not read/write Google. The landing does not load analytics, remote fonts or an LLM API. Existing lion assets and self-hosted Manrope fonts are retained.

## Release classification and acceptance

**Frontend + backend + durable purchase state + refund configuration.** This includes `0005_streamlion_launch_200.sql` after the original `0004` purchase schema. Existing financial rows and uniqueness rules are preserved. The new backend requires the v2 stamp before quote/checkout, and `STREAMLION_REFUND_DAYS=7` is the offer's activation setting. No Google/provider credentials are changed here.

**No Lovable action is required.** StreamLion uses repository/GitHub, Cloudflare and Google Cloud. Follow the idempotent D1 preflight in [Stripe activation](stripe-activation.md) after PR merge, then deploy the approved merged main's Pages assets and Functions. Do not promote the new public offer before Stripe test acceptance and separate live activation approval. Browser viewport checks do not replace physical Android checkout/restore testing or a production deployment receipt.
