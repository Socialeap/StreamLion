# Provider services and versioned intake

This completes the MVP service-template and conditional-question contract in `client-workflow-spec.md`. Source implementation is ready for review; it is not production activation or an authenticated Google acceptance receipt.

Providers open **Services & intake templates**, choose a starting set or create their own, and save service wording, reusable defaults and up to twelve field-mapped questions. Starting sets cover 3D capture, floor plans and property photography. Each new request can select a saved service version or use the standard work order. A saved service may contain up to 12,000 characters, and a workspace supports twenty services. All versions count toward the existing workbook history limit.

Questions use existing client-editable work-order fields with provider wording, help, required/optional status and optional text choices. Conditions support another field being answered, matching a stated answer, or property area exceeding a numeric threshold. Core required fields cannot be hidden. Dependency cycles, duplicate fields, private/provider-only questions and malformed choices are rejected. Unknown information remains blank and prevents agreement when required. Clarification and additional free-form questions continue through the existing Updates workflow.

Reusable defaults cover scope, exclusions, access, deliverables, deadline, handoff instructions, notes and a provider's offered fee/currency/payment terms. They exclude client identities, site addresses, confirmed appointments, agreed fees and payment receipts. Defaults are starting information; they do not create an agreement, payment, project debit or automatic reservation.

## Ownership, versioning and recovery

- Signed `streamlion.intake-template` records use the existing provider-owned `CoordinationEvents` tab, existing immutable parent/revision checks and existing D1 operation journal. The Projects and Observations headers stay unchanged; no new tab or D1 migration is required.
- Templates are returned separately from jobs. They cannot be addressed using a client grant or a job command. Their events require the provider actor and `template-save` action; another provider's records or invalid signatures stop the read.
- A request selects an exact saved ID/version from verified Google history. The server validates its provider binding, applies only allowed defaults and pins a full public question snapshot to the new job. Caller-supplied replacement configuration is rejected. Later template edits do not update old jobs; request retries retain the selected version even if a newer version exists.
- Template saves share the workbook's single-writer recovery gate. Lost acknowledgments retry the original operation. They bypass job projection, email, client-session creation and credit accounting. An uncertain write retains its operation and blocks subsequent writes until recovered.
- Unsaved template wording survives background refresh in the current page. A stale version requires an explicit reload. A failed refresh after a successful API response retains the original recovery operation. Only a verified completed save/readback is labelled saved.
- Conditional hidden answers are preserved. Missing required answers block initial agreement and acceptance of a proposed revision. Agreed service question/condition changes use the existing mutual proposal flow; operational contacts/access keep the existing acknowledgment rules.
- The pinned version appears in the client brief and downloaded work order. Provider archive packaging retains it in the complete signed job history. Google remains authoritative; device drafts remain separate and are not a shared save.

## Verification

The complete suite passed 429 tests, followed by 18 focused rendered-UI/export checks after the final unsaved-status adjustment. App/extension builds and Cloudflare Functions compilation passed. Focused cases cover immutable versions and request replay, cross-provider/forged selectors, private defaults, missing conditional answers, choice validation, stale editing, signed history isolation, lost Google acknowledgment, unchanged credit/outbox counts and recovery after a failed follow-up read. The final source checks are recorded in the PR receipt.

Native local browser QA used synthetic transports only: saved template version 2, observed an existing client still on version 1, created a new request pinned to version 2, revealed a large-site reference above 10,000 sq ft, and checked a 390 × 844 viewport without horizontal overflow. These UI checks sent no email and wrote nothing to Google, Stripe or an AI provider. Screenshots are retained locally outside the repository.

## Release classification and remaining gates

This change requires both **Cloudflare Functions deployment** (`client-coordination`, `coordination-engine`, `coordination-google` and their shared validation) and **frontend deployment** through the existing GitHub/main release path. It adds durable Google template records only when the authorized provider explicitly saves. It adds no migration, environment setting, secret, OAuth scope, background grant duration, transport allowance or paid service. No Lovable action is required; StreamLion uses the existing Cloudflare release path.

Owner approval of this concrete PR and required CI precede merge. The deployment receipt must match the merged SHA; then verify fresh provider/client behavior and saved template readback using an explicitly authorized synthetic Google workbook. The earlier QA-only grant was revoked and original resources restored; source tests do not authorize a new grant. Purchases remain in test mode and live-payment/AI-cost approval flags remain false. No live purchase, new AI request or additional spending is part of this release.

Archive rollover/cold restoration, physical-device acceptance, representative staging capacity and final commercial approvals remain separate unfinished gates. Linked multi-location requests and agency roles are later increments in the MVP specification.
