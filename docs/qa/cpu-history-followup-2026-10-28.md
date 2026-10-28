# Signed-history CPU follow-up — scale HOLD

## Scope

Base: `9ebdce291aecdada16db3efebd37bbac4583be00` (PR #141).
This change removes repeated work; it does **not** clear Free-plan capacity.

- Serialize each new history row's exact HMAC context once and reuse those bytes
  for verification and the adapter's existing request-local verification key.
  The key also binds the workbook, provider and mode. No verification result
  survives an adapter/request. Existing signed bytes and HMAC checks remain valid.
- Build sorted records without intermediate entry/pair arrays. Null prototypes
  retain own `__proto__` properties as data. A compatibility corpus compares the
  original encoder's bytes, including Unicode, numeric keys, omissions, wrappers,
  custom `toJSON`, cycles and unsupported BigInt.
- Reuse the existing strict native base64 helpers for HMAC signature bytes.
- Read the two optional intake schema markers in one fresh SQLite snapshot.
  Separate marker checks remain the fallback when an optional table is absent,
  so an incomplete prospect migration cannot suppress public privacy cleanup.

No authorization, financial, expiry, replay, retention or checkpoint check was
removed. No dependency, schema, secret, environment, cron or plan change is needed.

## Validation

- 1,181 tests passed, zero failures, including actual local Workers/D1 tests.
- Vite/PWA build, Pages Functions build, `verify:capacity`, `verify:cpu` and the
  final `verify:scale` workload passed. Four independent providers each had 20
  commercial jobs and 60 signed history rows; four clients were tested separately.
  Unchanged polls avoided Google, modified history returned 409, scheduler replay
  returned 409, and checkout remained paused. External provider calls: zero.
- Independent review found no actionable findings, including a separate review
  of the final native signature codec change.
- Production dependency audit passed the high-severity threshold. Three existing
  moderate advisories remain in unchanged dependencies: fast-uri, hono and
  ip-address. This change does not claim a zero-advisory dependency tree.

Local sampling varied between runs. One final run measured 41.60 ms total sampled
CPU for four concurrent provider reads, versus 45.68 ms in the first baseline;
client and health samples varied in both directions. These are aggregate local
samples, **not** per-request Cloudflare limits or a demonstrated live speedup.

## Isolated Cloudflare result

A temporary Free worker and a new synthetic-only D1 database exercised the built
Pages Functions bundle. No production routes, data, credentials or provider
services were bound. Checkout was paused inside the fixture. All outbound
Google/Stripe calls terminated in a closed synthetic transport.

Final deployed QA worker version: `1c2fa0f5-ab97-4013-af6c-ee6db51d0c46`.
The final 24-request window was 2026-10-28 19:35:30–19:37:10 UTC.
Cloudflare aggregate analytics reported sample interval 1:

| Metric           |    Result |
| ---------------- | --------: |
| Requests         |        24 |
| Execution errors |         0 |
| CPU P50          |  9.283 ms |
| CPU P95          | 20.382 ms |
| CPU P99          | 39.241 ms |

All 24 responses matched their assertions. The live tail supplied only 15 of 24
records; the tail is incomplete and cannot establish whole-window percentiles or
zero errors. The separate aggregate dataset covers 24 requests. No missing tail
record was interpreted as a successful or zero-CPU request. Earlier baseline and
candidate runs also had incomplete tails and substantial timing variation; they
are insufficient to establish a reliable end-to-end improvement percentage.

The [Cloudflare Free allowance](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)
is 10 ms per HTTP request. Occasional overruns can succeed, so zero observed
execution errors do not establish capacity when P95/P99 remain above the budget.
**Free CPU headroom and production scale remain HOLD.** These short synthetic
runs also do not establish a full-day production error window or provider quotas.

The temporary worker/database were removed after testing and the QA key file was
deleted. Sanitized local detail is retained outside Git under
`../artifacts/cpu-history-maintenance-2026-10-28/`.

## Release gates

1. Review and merge this scoped optimization PR. Merge requires owner approval;
   no merge or production deployment was performed during this test.
2. After merge, deploy the selected current main SHA's Pages Functions and
   frontend assets through Cloudflare, retaining separate server and frontend
   receipts. No migration or environment edit is required. The scheduled worker
   source is unchanged and does not need redeployment.
3. Verify canonical `/release.json`, served assets, health, access/tamper/replay
   behavior and paused checkout. Keep owner/device acceptance separate.
4. Continue CPU work and collect representative production evidence before
   clearing scale. The current result does not authorize sales or a plan upgrade.

Production verification during this task still served `9ebdce2`, reported ready
health and `checkoutMode: paused`, `enabled: false`. No Lovable action is required.
