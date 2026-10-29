# Full commercial checklist capacity

Saved project task suggestions and checklists support up to 120 items. The
existing version-1 workflow JSON may use up to 45,000 characters. This remains a
single append-only Observations record, preserving the current revision,
conflict/readback and duplicate-metadata safeguards. No workbook headers or D1
schema change is needed. Existing small checklists remain readable unchanged.

Only the reserved `StreamLion project checklist` area's `text` and `sourceText`
cells receive the larger allowance. Ordinary annotations remain limited to
12,000 characters. Both new and original source JSON retain their complete
wording; there is no lossy compression, clipping or automatic removal of tasks,
source passages, exception reasons or evidence references. Task and total-size
limits apply independently: unusually verbose checklists may reach the storage
ceiling before 120 items. Rejection preserves the review draft for correction.

The shared workbook validator is bundled into browser, Pages Functions and the
extension. Deploy the merged revision's complete frontend and Pages Functions
together. Neither scheduled Worker needs deployment. No secrets, grants,
licences, migration, paid service or checkout change is required. Older installed
clients retain their old capacity checks; accept the app update before opening
new larger checklists. Rollback clients must not overwrite a larger record.

Acceptance covers full commercial intake, clarification, mutual approval,
projection, full-scope task review and factual queries using the coordination
engine with synthetic providers. Workbook regression tests round-trip commercial
and 120-task records through headers, two append-only revisions and readback,
retaining source wording, exception reasons and evidence IDs. Rendered localhost
QA saves and reopens all 67 tasks from the prior client submission without a
pending draft. This is separate from live Google/email acceptance, which still
needs eligible provider access. Keep production checkout paused.
