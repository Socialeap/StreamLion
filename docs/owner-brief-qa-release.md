# Owner-only brief-import QA — disabled release, activation held

The owner approved a review PR for **8 existing test credits per completed
preparation**, **three provider attempts total**, **USD 0.30 total API reserve**,
and a **24-hour access window**. This approval does not authorize merging,
deployment, configuration, real AI calls or sales activation.

## Behavior and fixed terms

The separate owner-QA branch works only with `STREAMLION_PAYMENTS_MODE=test`.
The public importer flags can stay false. The server authenticates the existing
Google session, compares its subject against one private subject, and requires
that subject's existing paid **test** Core license. Request parameters, email,
headers, UI visibility and checkout allowlists cannot grant brief QA access.
No new license, starter grant, balance transfer or real purchase is created.

The fixed policy is price/reserve **100000 microUSD each** (8 credits/USD 0.10),
daily/total reserve **300000** (USD 0.30), daily request ceiling **3**. The server
rejects any different policy, including a larger budget. Lifetime counts and
reserves include **all** test-mode brief jobs, across subjects, dates and prior
windows. All three failed attempts exhaust the allowance even though credits
are refunded. There is no midnight reset or permission-window reset of history.
An atomic INSERT rechecks these limits and the policy, preventing races.

QA uses only the approved existing test wallet; a nonzero promotional balance
fails closed rather than silently selecting another source. Paid/live wallets,
revoked starter grants and other service policies are untouched. Successful
preparation charges once; failed preparation returns the original test credits
once. Discarding a completed result does not refund it. There is one pending
job per account, no automatic inference retry and no model fallback.

Access requires both dedicated QA approvals, a strict subject and canonical UTC
start/end timestamps no more than 24 hours apart. Expiry, changed permission,
changed workbook/session/license, or a changed policy immediately before model
invocation fails the reservation and refunds credits. Permission cannot stop a
provider request already in flight; that request remains covered by its reserve.
New preparation stops at expiry/exhaustion, while authenticated result recovery
remains subject to its existing 24-hour retention and account/workbook binding.

Only text is sent to `gpt-6-luna` through Responses: Standard processing
(`service_tier=default`), `store=false`, reasoning `none`, strict JSON, no tools,
at most 6,000 source characters and 3,000 output tokens, 64 KiB complete serialized
model request. The original PDF remains on the device. The USD 0.10 per-attempt
reservation is a conservative operator budget, not an invoice or account-wide
OpenAI billing limit. Check current model pricing/access before activation;
do not add funds, change model/tier, increase limits or auto-recharge to resolve
an unavailable provider. [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

The preparation is reviewed before import; import fills empty fields only and
does not automatically save to Google. Existing draft/recovery protections and
cleanup behavior remain in place. The owner sees remaining attempts and expiry;
QA funding/attempt exhaustion does not direct them to buy credits.

## Separate release gates

1. **Code review/merge — HOLD.** Review this PR and its required `verify` result.
   Do not merge without owner approval. No secret owner identity is committed.
2. **D1 migration — none required.** Migration 0016 is a prerequisite already
   deployed for the importer. Verify its tables/indexes/triggers and schema stamp
   against the committed migration. Do not replay it. Stop on partial/mismatched
   schema; request separate migration authorization if repair is necessary.
3. **Configuration/D1 policy — HOLD for explicit configuration authorization.**
   After merge, verify production SHA/connection, the single approved private
   Google subject, its paid test license, zero promotional balance, nonnegative
   existing test wallet, and no prior test brief jobs. Do not reset prior jobs or
   grants to pass preflight. Preserve unrelated configuration and take a policy/
   balance/count receipt without credentials or private record content.
   For a disabled release, keep all public and QA approvals false. No production
   policy update is authorized by this document or the PR.
4. **Functions deployment — HOLD for explicit server deployment authorization.**
   Deploy only the reviewed merged main SHA's Pages Functions with QA disabled.
   No cleanup or coordination Worker changes are required. Verify anonymous
   config remains `enabled:false` and prepare fails closed without inference.
5. **Frontend release — HOLD for separate frontend authorization.** Deploy that
   exact SHA's assets and verify `/release.json`. Accept the ordinary PWA update
   without clearing storage. Confirm records, drafts and selections remain.
6. **Owner QA/activation — HOLD for explicit real-spend authorization.** After
   disabled release checks, reconfirm all gates and obtain authorization for at
   most USD 0.30, three attempts, and synthetic venue brief submission. Verify
   provider/model access read-only first. Then configure the exact test-policy
   values above and the private settings below, keeping QA approvals false until
   the final activation step. Activation writes must stop on unexpected state;
   apply the policy only if its entire row is inactive/zero and test history is
   empty, otherwise investigate without overwriting state. Record exact start/
   expiry once; never extend them or replenish budget without new approval.

   | Private server setting                     | Value after separately approved activation                         |
   | ------------------------------------------ | ------------------------------------------------------------------ |
   | `STREAMLION_BRIEF_IMPORT_QA_SUBJECT`       | One verified Google subject, Secret; never email or wildcard       |
   | `STREAMLION_BRIEF_IMPORT_QA_START`         | Fixed canonical UTC ISO timestamp, e.g. `YYYY-MM-DDTHH:mm:ss.sssZ` |
   | `STREAMLION_BRIEF_IMPORT_QA_UNTIL`         | Fixed canonical timestamp exactly 24 hours later                   |
   | `STREAMLION_BRIEF_IMPORT_QA_ENABLED`       | `true`, final activation step only                                 |
   | `STREAMLION_BRIEF_IMPORT_QA_COST_APPROVED` | `true`, final activation step only                                 |

   Keep `ENABLE_BRIEF_IMPORT=false`, `STREAMLION_BRIEF_IMPORT_COST_APPROVED=false`,
   payment mode `test`, checkout restrictions, AI and coordination pilot modes,
   public sales and every live policy unchanged. Use the existing server-only
   OpenAI/encryption secrets. Never expose them through configuration responses.
   Check anonymous/non-owner rejection at USD 0, then owner config: 8 credits,
   three remaining attempts, approved expiry. Only then run approved text/PDF
   QA, review facts and test result recovery. A Google save remains explicit.

7. **Closeout.** Verify expiry/exhaustion blocks new calls, record attempts,
   reserved API budget, measured provider usage and credit/refund totals. Confirm
   sales and pilot gates unchanged. Disable dedicated QA approvals if closing
   early. Keep job history for budget/recovery; no deletion, rearming or automatic
   renewal. A new round needs new approval and reviewed budget handling.

## Maintenance of an already approved QA window

A reservation bug fix does not authorize another window, new budget or more
attempts. Keep failed/interrupted job history. Recovering a stale job after five
minutes marks it failed and refunds reserved credits exactly once; it does not
run inference or return the attempt to the allowance. Refresh availability after
recovery. Before an app update, keep a copy of pasted source: unsubmitted source
text is held in memory, while project drafts and recovery references persist.

Treat follow-up release checkpoints separately:

1. **Code review/merge:** review the fix and its required check; do not merge
   without owner approval. Runtime tests must use D1's trigger-inclusive change
   count, not only SQLite's directly affected row count.
2. **D1 migration:** none for the reservation-count fix. Do not replay 0016,
   reset job history, change wallets, or rerun the initial zero-history policy
   activation against an existing window.
3. **Configuration:** hold for explicit authorization to retain the existing
   approved window. Preserve its exact subject/start/expiry, fixed policy and
   lifetime usage. The two QA approval flags declared in Wrangler are
   `plain_text` runtime switches; do not create duplicate Secret bindings for
   them. The subject/start/expiry remain server-only Secrets. Git builds use the
   committed false defaults, so verify the intended switch values in the final
   deployment. An approved runtime override may change only these two switches;
   do not change unrelated modes, secrets or bindings, or extend the expiry.
4. **Functions deployment:** hold until the fix is merged and server deployment
   is explicitly authorized. Release the exact merged SHA; check anonymous
   rejection and authenticated recovery/configuration without a preparation POST.
5. **Frontend release:** hold for explicit authorization. Verify the same merged
   SHA's assets and the ordinary PWA update; do not clear device storage.
6. **Owner QA:** within the original remaining allowance/window only, prepare a
   synthetic brief, review the result, fill empty draft fields explicitly, then
   save the mock project explicitly. Verify saved-detail lookup in Ask. The
   separate conversational AI pilot remains closed; brief QA does not activate it.

## Validation

Mocked Responses and in-memory SQLite cover private owner access, spoofed and
anonymous callers, malformed/missing settings, exact policy/quote checks,
concurrent final attempts, policy races, expiry/revocation after reservation,
unchanged live wallet/pilot settings, unexpected promotional funding, license
revocation, exactly-once refunds, three-attempt lifetime exhaustion and recovery
after pause/exhaustion. UI tests cover the owner terms and safe funding/exhaustion
messages without losing pasted source. No real provider calls or live writes.
