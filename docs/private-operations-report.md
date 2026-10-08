# Private operations and cost report

This operator tool closes the source gap for a manual operations dashboard and cost-allocation worksheet. It does not install alerts, polling, a public administrator route, a new credential or an approval flag. The report is a private local HTML file generated from aggregate, read-only D1 query receipts. Google records, client text, email addresses, account/file/job identities, session credentials and push endpoints are never returned by these queries.

## Collect a bounded snapshot

Use the existing Cloudflare operator access and an approved private local directory, outside the repository. Check the account's actual plan and remaining allowance before collecting. Queries consume ordinary D1 rows read; they make no Google, email, Stripe or AI request. Do not add permissions or purchase capacity to run the report.

```sh
umask 077
mkdir -m 700 /private/tmp/streamlion-operations-YYYYMMDD-HHMM
node scripts/operations-report.mjs sql > /private/tmp/streamlion-operations-YYYYMMDD-HHMM/queries.sql
WRANGLER_LOG_PATH=/private/tmp/streamlion-operations-YYYYMMDD-HHMM/wrangler.log npx --no-install wrangler d1 execute streamlion-google-sessions --env production --remote --file /private/tmp/streamlion-operations-YYYYMMDD-HHMM/queries.sql --json > /private/tmp/streamlion-operations-YYYYMMDD-HHMM/query-results.json
node scripts/operations-report.mjs render /private/tmp/streamlion-operations-YYYYMMDD-HHMM/query-results.json /private/tmp/streamlion-operations-YYYYMMDD-HHMM/report
```

Replace the placeholder with a fresh timestamp; never overwrite an earlier receipt. Open `report/operations.html` locally. The renderer creates a new directory with mode 0700 and files with mode 0600, refuses overwrite and never prints the query contents or raw input errors. Do not commit, upload or publish these private reports. Protect and remove them under the owner's operator retention policy. No production dump or credential export is required.

The query bundle is fixed and read-only. Nine current schema stamps must be present. Each sampled table stops after 5,001 rows; more than 5,000 marks coverage partial and requires review. Inner limits precede account joins. Counts in a partial section are incomplete and cannot clear a gate. A missing response, unknown binding, missing policy row, conflicting timestamp, query write, unexpected field, duplicate metric or stale snapshot fails closed or shows attention. The renderer rejects inputs larger than 2 MiB and receipts beyond 250,000 reported rows read; that post-query check is not a provider invoice cap. Never enlarge the limits to hide a failure.

The capture timestamp is supplied to the SQL before execution; collect promptly and retain the D1 duration/read receipt. Statements are separate reads, so a command completing during collection can change adjacent counts. For incident reconciliation use the original operation receipt; this aggregate view is not a transactionally consistent financial export. The file does not refresh. After five minutes it is visibly stale; inputs older than 24 hours are rejected.

## Interpret the counters

Test and live coordination/credit/payment rows stay separate; pilot reservations have their own section. Email attempts and project Google counters are shared. Queued, accepted, delivered, bounced, complained, uncertain and failed mail stay distinct. Push acceptance does not prove device display. Cleanup scheduling metadata does not prove a natural cron invocation. Payment/refund amounts are ledger values, not bank settlement. Cleanup removes expired metadata, so retained counts are not lifetime totals. Failed AI attempts retain their provider-cost reservation; the report never treats refunded customer credits as recovered provider spend.

Use pending-write age, revoked/expired grants, archive deadlines, uncertain mail, delivery failures and exhausted push retries to decide which private original receipt to inspect. An unfinished reserved AI turn requires attention even when all other counters are clean: it may block another turn for that account. Commercial reservations appear under their exact test/live mode; the separate pilot finding stays visible in both dashboard views. Preserve drafts and original operation identities. This tool cannot retry, reset a budget, revoke a grant, repair a row or enable a service. Incident ownership, alert destination, real platform allowances, production relay receipts and representative staging remain separate operational gates.

## Complete the allocation

Select one service and billing period. Enter allocated period costs for model/speech, hosting/D1, retained storage/backups, email/push, payment processing, failures/retries, promotional/abandoned work, support labour and other fixed operations. Include each cost once. Free or abandoned work must not disappear from the allocation; amortize the complete allocated cost over paid units. Use a measured allocation basis for costs shared with Core or other applications. Blank stays unknown; verified zero is entered explicitly.

The worksheet converts decimal costs into exact integer micro-USD, rounding upward only when a value has a fractional micro-dollar, and computes the proposed 30% markup on that allocated unit cost. A six-decimal cost of $0.000123 stays 123 micros. It is a local scenario with no persistence or network connection. It neither guarantees margin nor approves a cost, price, paid plan, live payment, AI ceiling or automatic recharge. Compare against actual billing and measured supported workload before seeking the concrete commercial decision.

## Release classification and verification

This candidate changes private scripts, their local HTML template, tests and documentation only. It adds no product frontend, Function, Worker, migration, secret, environment setting or live-state activation. No Cloudflare deployment is needed to use the reviewed tool. Owner merge approval and required CI still precede merge. A local synthetic dashboard is not a live operator receipt or a production/scale acceptance result.

Verify privacy, exact modes, queue age, partial coverage, failed-turn reservations, missing/stale responses, protected files, overwrite rejection and the shared cost calculation with `node --import tsx --test functions/api/operations-report.test.js`. Native browser QA must use synthetic aggregate receipts; private production counts must not be served on a public or shared preview.

October 8 updated source receipt: all eight focused operator checks and the combined 462-test suite passed, including PRs #64–#66. Reserved commercial/pilot turns alone produce attention, and exact decimal inputs and fractional micros retain correct rounding through the embedded browser cost function. The dashboard interaction test switches test/live modes. Public Vite entries and the extension builder do not include this template. Latest required CI is a separate merge gate. Native browser acceptance is pending because the Mac is locked; no production snapshot, account-plan verification, installed alert or cost approval is claimed.
