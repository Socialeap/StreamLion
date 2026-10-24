# Immediate pilot admission and scheduled places implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare a tested PR for immediate free Core admission, truthful landing states and simple administrator capacity/reopening controls. No live activation.

**Architecture:** Add migration 0024 on existing 0023 policy. Keep legacy manual mode as the default; explicit instant mode uses atomic conditional admission. A dated, single-use release of additional cumulative admissions is materialized on the first server request at/after its due time, within the approved window and only while admissions remain enabled. No cron, new provider, email or paid operation.

**Tech Stack:** Existing React/Vite, Pages Functions, D1 SQLite, Google session and purchase gates.

**Spec:** Current owner request plus docs/controlled-free-pilot-release.md; immediate admission supersedes manual-only admission for the new selected mode.

## Global constraints
- Feature flag remains absent/false; migration retains manual mode and both opening flags closed. No merge/deploy/migration/configuration/admission/invitation messaging under this task.
- Paid checkout stays paused; do not change payment/tax/AI/provider settings or hasPurchase. Pilot remains Core-only, $0 metered features; preserve paid customers and expired retrieval.
- Active cap and total admission budget each 1–20, cumulative admissions never reset. First cohort defaults remain five. No new trial for previously admitted accounts, including revoked/expired users.
- Start requires verified existing Google session, professional-provider declaration, contact consent, readiness and terms free-pilot-v2. Clock begins on successful activation only; last-slot loss keeps interest and grants no access.
- Reopening adds N to total admission budget once; simultaneous capacity still limits access. Owner pause cancels pending schedule. No automatic waitlist admission or notification. Invalid/stale admin changes return errors without partial writes.
- All timestamps server-enforced; admin date inputs show UTC and require a confirmed future time within the approved window with full trial duration remaining. No invented counts/countdowns or promise of opening soon.

## API contract
Existing GET config/status adds `admissionMode` ('manual'/'instant'), `availability` ('available'/'full'/'closed'), `reopenAt` (timestamp/null). Status includes own `application` {name,business,fit,contact,marketing}, if any, and preserves existing state/active/admin/expiry fields. Availability full means an otherwise valid open window is blocked by active/reserved or cumulative capacity; paused/not-started/closed never masquerades as full. Public interest-only card uses planned-openings copy. Approved duration remains dynamic.

POST start: {name,business,fit,contact:true,marketing:boolean,provider:true,ready:true,terms:'free-pilot-v2',durationDays:7|14}. Atomic immediate admission/activation only in instant mode; returns active/start/end. Repeats preserve the durable grant. If full, records interest and returns409 {code:'pilot_full',registered:true,error:...}; no access. Existing POST apply remains interest only. GET status pre-fills the applicant's own profile. POST activate remains legacy invited flow.

Admin GET list preserves policy/counts and adds policy fields: admission_mode, revision, reopen_at, reopen_slots. `admin/settings` POST takes {revision,activeCap,admissionCap,durationDays,applicationStart,applicationEnd,closesAt,interestOpen,admissionsOpen,admissionMode,reason}; validates entire form and updates atomically with revision check. Timestamp values are epoch ms, others numeric/bool as indicated. AdmissionCap cannot drop below cumulative admissions, exceed20 or break a pending schedule. Existing live access never revoked by capacity edits.
`admin/schedule` POST {revision,reopenAt,slots,reason}: 1–20 additional cumulative places, future approved date, sum total budget+slots<=20; replaces a pending schedule explicitly with audit. `admin/pause` POST {revision,reason}: closes admissions and cancels pending reopening. `admin/cancel-schedule` {revision,reason} clears only schedule. All changes audited, no admin-management API.

## Review focus
1. Final-slot and scheduled-release concurrency on real local D1, including repeated requests and RETURNING/trigger metadata.
2. Paused, not-started and truly full offers must have different truthful copy; losing last-slot race keeps interest.
3. Stale admin tab, invalid dates, unsupported policy or missing migration fail closed; no silent state reset.
4. Reopen cannot create unlimited rolling access, exceed20 total or revoke paid/existing pilot access.
5. Keyboard/mobile form behavior and UTC dates, no automatic paid checkout or marketing consent.

## Tasks
1. Parent: test-first migration0024, runtime instant admission/admin/schedule contract, exact additive preflight and migration compatibility tests. Keep legacy tests valid by upgrading fixture schemas to0024.
2. Participant/admin worker: own src/FreePilot.jsx, src/FreePilot.test.jsx, new src/PilotControls.jsx and its tests, src/free-pilot.css. Build immediate flow and simple controls against contract; preserve legacy/expiry/feedback behaviors. No server/landing edits or commits.
3. Landing worker: own src/landing-pilot.js, src/landing-pilot.test.js, src/landing.js, src/landing.css, api/welcome.html if needed. Selected Workflow card: available Start free pilot; full Update: this pilot group is full / More pilot places are planned. Join the interest list for news of the next opening. Closed interest mode must not claim full. Hidden when disabled; refresh stale availability, no duplicate cards; no unsafeHTML fromserver. No participant/server edits or commits.
4. Parent: integrate, scoped and full tests, real local D1 race tests, builds/dry checks/audit, browser fixtures, independent review, fix findings, release plan; commit/push with CF-Pages-Skip and PR. Keep activation held and include exact backend/frontend/QA/rollback actions.
