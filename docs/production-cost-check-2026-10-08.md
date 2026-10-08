# Cost check — October 8, 2026

This is a read-only price and source check. No paid request, upgrade, automatic overage, counter reset or live-cost approval was performed. Public provider rates do not verify the account's actual plan, invoice, shared usage or remaining credit.

## Bounded optional AI

`server/ai-providers.js` uses `gpt-6-luna` through the Responses API with the default service tier, no reasoning, no storage and at most 240 output tokens. The short-context standard rate is $0.10 per million input tokens and $0.50 per million output tokens. [OpenAI pricing](https://developers.openai.com/api/docs/pricing?tab=suite).

Optional speech uses DeepInfra Kokoro-82M. Its listed rate is $0.62 per million characters. [DeepInfra model pricing](https://deepinfra.com/hexgrad/Kokoro-82M).

The source bounds project context to 10,000 UTF-8 bytes, the question to 500 characters and the answer to 900 characters. An illustrative allowance of 14,000 input tokens, 240 output tokens and 900 speech characters therefore costs:

| Component   | Calculation                | Listed variable cost |
| ----------- | -------------------------- | -------------------- |
| Text input  | 14,000 × $0.10 / 1,000,000 | $0.001400            |
| Text output | 240 × $0.50 / 1,000,000    | $0.000120            |
| Speech      | 900 × $0.62 / 1,000,000    | $0.000558            |
| Total       | Sum                        | $0.002078            |

The input-token allowance is an estimate with padding for instructions and formatting, not measured model usage. Actual input usage and billing must be reconciled. The application's existing $0.006 reservation is an internal accounting ceiling, not a provider-enforced invoice limit. Failed/partial calls, operations, support, infrastructure, payment processing and promotional credits still need a fully loaded cost allocation. The chosen 30% is markup on the approved fully loaded cost, not a guaranteed margin. `AI_COST_APPROVED` remains false.

## Email and infrastructure

Resend lists a free plan with 3,000 emails/month and 100/day. The StreamLion restriction is intentionally lower: the original 20 attempts/day and 500/month. The owner approved a test-only 40/day allowance through October 11; the candidate configuration expires it at `2026-10-12T04:00:00.000Z`. The monthly cap, approved QA recipient list and existing attempt history stay unchanged. These are attempt ceilings; retries can consume attempts without a delivered email. [Resend pricing](https://resend.com/pricing).

Cloudflare D1's listed free allowance includes 5 million rows read/day, 100,000 rows written/day and 5 GB. Paid usage depends on rows read/written and storage, so polling, revisions, archives and other account applications must be included. Local retained-row benchmarks do not establish an account bill or production capacity. [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Required cost receipt before paid public activation

Record the actual provider/account plans, authorized budget, expected accounts and active jobs, polling/lifecycle volume, measured tokens/speech usage, retry/failure rate, D1 row operations, retained storage and payment-processing allocation. Reconcile the estimate with provider receipts under separately approved bounded usage. Obtain owner approval for the resulting live ceiling before changing any commercial flag. This candidate neither enables live payments nor approves new AI spending.
