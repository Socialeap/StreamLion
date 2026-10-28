# CPU profiling and representative workload — scale gate held

Production base: `a2ee50619a164aca4fe7f1ce0c875cb7e52ac7a8`.
This change prepares two measured optimizations for review. It does not establish
Free-plan capacity or authorize checkout, a plan upgrade, or production release.

## Findings and changes

The full Pages Functions module graph imported the administrative reporting
module through authentication/observation. That constructed an expensive
`Intl.DateTimeFormat` for New York dates even when the request never used reporting.
A local workerd CPU profile attributed 233 samples, approximately 23 ms at the
100-microsecond sampling interval, to that native construction on the first health
request. Deferring construction until reporting actually uses it removes that
initialization from ordinary requests. Reporting still reuses one formatter per
isolate; timezone and DST boundaries are covered by regression tests.

Coordination readiness performed four serial D1 queries on each private request.
It now uses one fresh SQLite statement to check the same three schema markers and
the active policy for the current payment mode. Missing tables, missing markers,
inactive policies and database errors still fail closed. A change to policy takes
effect on the next private request; authorization is never cached. No migration,
credential rotation or data rewrite is required.

Signed workbook parsing, canonical serialization, HMAC verification and D1
authorization remain material costs in representative authenticated reads. These
checks have not been weakened to meet a CPU target.

## Reproduce the bounded workload

Use the repository's supported Node version and installed lockfile dependencies:

```sh
npm test
npm run build
npm run verify:scale -- --output /tmp/streamlion-scale.json
```

The scale command builds the entire Pages Functions worker and runs it in local
workerd with an isolated real D1 database. It applies committed migrations only
to that disposable local database and generates synthetic records. It exercises:

- Four independent provider accounts, twenty commercial jobs per provider and
  three signed revisions per job: eighty jobs and 240 signed events overall.
- Four concurrent provider readers, four independent client viewers, long scope
  text, cold/warm health and paused checkout/configuration.
- Authenticated unchanged polling with no additional Google read, account
  isolation, between-request signature tampering and signed-maintenance replay.
- Idle maintenance with no mail, push, AI, purchase or refund operation.

All outbound application requests terminate in a closed synthetic Google/Stripe
fixture. An unrecognized request fails instead of reaching a provider. The command
does not use production credentials, a live D1 binding or real customer records.
`--bundle <path>` accepts a selected Functions bundle for paired diagnostics;
`--export-staging <directory>` exports synthetic fixtures only. Neither option
deploys anything or executes remote SQL.

The JSON receipt includes assertions, local response times, sampled CPU and V8
heap usage. Inspector CPU sampling includes runtime overhead and is diagnostic;
it is not Cloudflare CPU accounting. Heap usage is not total isolate memory.
There are too few requests to infer a concurrent-user ceiling or sustained SLO.

## Validation and live edge limits

The final full test suite passed 1,167/1,167 tests. Vite/PWA/extension builds,
Functions build, the local representative workload and read-only production
checkout verification passed. Independent code review found no actionable issue.

A temporary Free-plan Worker and separate D1 database also ran the complete
Functions code against synthetic provider responses. Production bindings and
routes were excluded. All twenty-nine client-side assertions passed in the
optimized runs, including paused checkout, isolation, tamper rejection and replay
protection. Real provider latency and quotas were excluded.

Live tail delivery was incomplete in optimized attempts, so those attempts are
not accepted as complete per-route CPU percentiles. Aggregate Cloudflare adaptive
analytics for the optimized QA Worker from 06:17 to 06:25 UTC reported 57 requests,
zero execution errors, CPU P50 **13.071 ms**, P95 **37.433 ms** and P99 **45.383 ms**.
This window includes repeated test runs and tracing; it is not a paired speedup
claim. These values exceed the nominal Free-plan 10 ms per-invocation allowance.
Successful responses can use Cloudflare's occasional-overrun flexibility and do not establish
sustainable headroom. CPU analytics fields are microseconds, converted here to
milliseconds; `durationP*` GB-seconds must not be presented as response latency.

The scale gate remains **HOLD**. A local formatter improvement, fewer D1 round
trips and zero observed execution errors do not clear that gate. Further work
must profile and reduce the full authenticated-read cost, or present a separately
approved capacity/plan decision. Do not silently upgrade the plan or trade away
integrity checks. The owner has explicitly withheld plan-upgrade approval.

## Separate release checkpoints

1. Review and explicitly approve the optimization PR before merge. Keep checkout
   paused. The commit suppresses automatic Cloudflare Pages builds while retaining
   the required GitHub verification check.
2. After an approved merge, deploy the selected merged SHA's Pages Functions and
   frontend assets through Cloudflare. Pages ships both together; retain separate
   server and frontend verification receipts. No production migration, secret,
   plan, provider or environment change is needed. Scheduled Workers do not need
   deployment for this change.
3. Verify `/release.json`, protected reads, signatures, private headers, unchanged
   polling and `node scripts/verify-purchases.mjs
https://streamlion.transcendencemedia.com live 14 paused` on that exact release.
4. Obtain representative production CPU/error evidence and a subsequent 24-hour
   normal-use window. Keep the scale gate held while CPU headroom, complete
   workload evidence or Google quota acceptance remains unresolved.
5. Owner certificate and final phone QA remain separate owner-controlled gates.
   Checkout activation requires its own explicit authorization after prerequisites.

StreamLion uses GitHub, Cloudflare, Google and Stripe. No Lovable action is required.

References: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Workers CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/),
[Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).
