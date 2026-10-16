# Provider-owned pricing and estimates

## Product flow

Account → Pricing & Estimates stores the account default and up to nine named
service pricing profiles. Each profile has a provider-selected currency (two
minor digits), pricing method, optional/required named extras, quantity limits,
and an optional client-budget field. Nothing is published until the provider
chooses Publish pricing for new forms. The preview never creates a project,
sends email, collects payment, or spends StreamLion credits.

Supported methods:

- Provider prepares a quote (no invented zero-dollar total).
- One rate per square foot.
- Two/three whole-area tiers: one selected rate applies to all square footage.
  A lower tier rate can reduce the total at the boundary; the editor explains it.
- Two/three progressive bands: each portion uses its own band's rate.
- Two/three flat-fee area ranges: size selects a single project fee.

Bands start at 1 sq ft, use strictly increasing inclusive upper limits, and end
with an open final range. Extra charges use provider-defined names, unit prices,
units, required/optional choices and positive default/maximum quantities. Clients
can enter fractional quantities to hundredths. Optional quantity zero means
not requested. Required quantities must be positive and within the maximum.
An extra with unit “item” and quantity one provides a fixed charge.

Currency rates permit four decimal places; fixed fees and client budgets permit
two. Integer arithmetic rounds each line once to the nearest cent (half up),
then sums the lines. No exchange conversion is performed. Total/quantity/size
bounds prevent unsafe arithmetic. Unsupported currencies, negative values,
unknown extras and invalid ranges cannot publish or submit.

Client requests → Services & intake templates chooses Account default or a named
pricing profile for each service. Profiles are always resolved through that
connection's Google subject and payment mode. A submitted profile ID or amount
cannot read another provider's configuration or replace the calculated total.

Each new public/prospect form seals its pricing snapshot separately from its
intake questions and branding. Editing Account prices affects new forms. Under
Your public forms, the provider can review the latest published profile and
explicitly Update form pricing for future requests, retaining the same URL and
owner. Current form pricing and latest available version are visible before the
update. Existing submitted requests retain their original snapshot, breakdown,
quantities, currency and proposed budget in Google-owned records.

Server submission recomputes prices from the sealed snapshot. The client budget
is a separate proposal, never the agreed fee. Fresh submissions with stale
pricing fail with `pricing_changed`; the client can review current prices while
keeping answers. The submission transaction checks the exact form descriptor,
so a concurrent pricing publish cannot leave a partially created job. Previously
saved submissions retry against their original fingerprint and payload even if
the form is subsequently repriced. Form-creation retries and concurrent inserts
recover the original pricing snapshot instead of reading new default prices.
A repeated form-pricing publish recovers an already-applied target version.

Historical descriptors without the pricing field retain the legacy TM
calculator. Historical questions, estimates, links, credentials and project
records are not rewritten. New forms never silently use TM prices. TM sample
rates are an optional, editable starting point in the Account editor and still
require explicit publication. The built-in template's original stored metadata
is retained for cross-release retry compatibility; new client pages describe it
as optional service questions, with prices from the provider's published profile.

A missing pricing migration disables publishing and form repricing. New default
forms offer a provider quote; an explicitly named unavailable profile fails
closed. Existing forms retain their sealed prices. No credentials, grants,
providers, Google scopes, pilot modes, checkout restrictions or paid services
change.

## Held release checkpoints

No production migration, deployment, configuration change or owner price
publication is authorized by this review PR. PR #87 is merged at `b99e671` but
its branding migration and release remain held with this pricing release.

1. **Review/merge:** require passing GitHub `verify` and resolve substantive
   review findings. The `[CF-Pages-Skip]` commit marker suppresses Cloudflare
   deployment without skipping GitHub Actions. Merge only with owner approval.
2. **D1 migration:** after merge and explicit authorization, inspect
   `sqlite_master` and `PRAGMA table_info` for each named table independently.
   Apply committed `0014_provider_branding.sql` only if
   `streamlion_provider_branding_v1` is absent. Apply committed
   `0015_provider_pricing.sql` only if `streamlion_provider_pricing_v1` is absent.
   Verify exact columns, checks and primary keys when present; stop on partial
   or mismatched state. Do not substitute migrations, rewrite records or alter
   existing policies. Receipt: merged main SHA and each migration/schema result.
3. **Configuration:** no changes required. Preserve current secrets, modes,
   allowlists, quotas, Google grants and checkout restrictions. $0 ceiling;
   no sales activation, upgrade, payment, paid AI call or live email test.
4. **Functions deployment:** deploy reviewed merged handlers, including
   `/api/provider-pricing` and `/api/provider-branding`, plus public/prospect
   pricing snapshots and guarded form updates. Anonymous profile GETs must be 401. Signed-in GETs must return only the current account and mode's data.
   Check old form descriptors and public configuration without submission.
5. **Frontend release:** publish assets from the same merged SHA, including
   Account pricing editor, service profile selector, client breakdown/budget,
   form update controls and pricing section navigation. Record separately from
   Functions even when Pages publishes both in one operation.
6. **Owner/device QA:** finish existing edits before the normal PWA update.
   Publish the owner's intended business branding and service prices through
   Account, then review and explicitly update any existing form that should use
   those prices. Use an isolated workbook for any submission/recovery proof.
   Confirm recipient, rates, tier boundaries, extra quantity, proposed budget and
   separate agreed fee. Confirm original requests/estimates, drafts and selected
   workbook/folder are preserved. Physical phone acceptance is separate from
   local responsive QA; preserve pilot modes and the $0 ceiling.

Rollback limitation: keep pricing-aware Functions/readers deployed once a Google
workbook contains pricing-configured service templates. Older parsers reject the
new template field. If publication must be stopped, use a scoped forward fix
that pauses pricing writes/form updates while retaining compatible readers and
frontend behavior. Keep the additive metadata tables and submitted records;
never delete records or restore production to undo this feature.
