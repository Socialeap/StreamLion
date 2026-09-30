# StreamLion Google-owned workflow — v0.2

Supersedes the older streamlion-app plan's requirement for a hosted project journal. No StreamLion server stores project details. No model API key is required for ChatGPT-hosted extraction or queries.

## Implemented architecture

- Ordinary ChatGPT prepares versioned project files from user-supplied briefs and discusses explicit dated snapshots. The PWA supplies the file contract and project context. A Google connector and the optional private StreamLion plugin are not prerequisites.
- PWA: React/Vite on existing Cloudflare Pages; direct Google Identity Services token flow, drive.file scope and Google Picker. Access tokens remain in memory; reconnect after expiry. No service-account key or browser client secret.
- Google: Projects and Observations are append-only, wide revision tables. The PWA retains photos and voice memos through the existing drive.file scope. Its versioned checklist uses a clearly identified Observations record; no headers change. No StreamLion server stores private project data. Explicit opt-in site copies, device drafts, local media, and pending field records are retained on the device.
- PWA keyword search scans loaded records and is rebuildable. Deeper questions use ordinary ChatGPT plus a dated snapshot. No embedding provider is configured.
- Manual editor and imported JSON share project-schema.js. Jotform labels were reconciled 2026-09-23; original form remains unmodified.

## Reliability and privacy

Stable record IDs survive sorting. Metadata headers are fixed. Same-revision retry is idempotent; divergent children cause a visible conflict. App reads the latest base immediately before append and verifies readback. This detects conflicts, but Sheets has no row-level transactional compare-and-swap: simultaneous writers can produce a branch requiring manual reviewed repair. Pilot: one active editor per project.

Updates append a full row. Direct edits to a latest row are reflected on refresh, but lose that edit's previous cell history unless Google version history supplies it. Prefer editing in StreamLion/ChatGPT. Do not alter IDs, parent relationships or headers. The PWA rejects incompatible/oversized books rather than silently truncating. Pilot cap is 10,000 grid rows per tab, including history.

Delete in the PWA appends a Projects revision with reviewState `archived`; it hides the project and its notes from active PWA lists. Restore appends a draft revision so details can be reviewed again. The workbook rows and observations remain intact. Snapshots contain only active projects selected in the PWA; the optional plugin must still respect archived heads when used independently. Neither status means the site work was completed.

Fetched Google lists are held in browser memory. Users may explicitly keep a dated read-only site copy in IndexedDB. Disconnect removes live authorization; opting out removes the workbook copy, while queued field records and original media remain available for recovery when the workbook is selected again. Device drafts, their base snapshots and pending write operations are persisted locally, partitioned by workbook/project, to prevent silent loss and allow the same write to be retried after a reload. These include project details; they remain until saved/released or site data is cleared. Shared-device users should clear site data only after exporting/saving needed drafts. ChatGPT has its own processing/retention; "Google-owned records" does not mean information never reaches ChatGPT.

## Acceptance and remaining gates

Source tests: schema validation, sorted histories, duplicate retries, conflict rejection, original transcript retention, draft isolation and recorder regressions. Browser: JSON prefill → review → local save → notes → navigation recovery → query handoff.

Owner activation: Google Cloud OAuth web client; Sheets and Drive APIs; Picker configuration for pre-existing workbooks. The primary customer workflow needs one Google connection in the PWA; ordinary ChatGPT receives an explicit snapshot or brief. No one-click cross-app session is promised. No hidden consumer ChatGPT invocation or webhook-based model execution.

Live Google roundtrip and physical phone voice tools must be tested after OAuth setup. Test scanned PDFs, conflicting emails, exact fractions, app switching and absent tools. Source tests do not prove these outcomes. Calendar scheduling, structured measurement geometry, payment allocations/invoicing and automatic semantic indexing remain later increments. Direct retained voice/photo upload, actionable checklists, site copies, repeat visits, and handover tracking are implemented in the provider workflow increment, subject to the live checks in provider-workflow.md. Current payments are sourced summary fields, not accounting ledgers.

## Build sequence

1. Shared field contract, editor/import, controlled Google workbook read/write and updated plugin instructions.
2. Activate Google setup, verify document-to-workbook-to-PWA, correct through ChatGPT, refresh and verify.
3. Test mobile voice tools and one real provider workflow with owner consent.
4. Add requirements, calendar and document lifecycle features based on pilot evidence.
