# Two-hour owner-only Core and client-coordination QA

This extends the existing optional encrypted Production-only
`STREAMLION_OWNER_CORE_QA_LICENSE` binding. The default and old `google-workspace`
scope still exclude coordination. The new `google-workspace-and-coordination`
scope permits the enrolled enabled owner only, on the canonical live origin
while checkout is paused, for at most two hours. No purchase or credit row is
created. AI, speech, checkout, email/push delivery and paid delivery settlement
are not enabled by this grant. Paid delivery is rejected before creating a
pending journal. Provider/client access, public intake, verification and recovery
use fresh eligibility checks; atomic writes recheck owner enrollment and expiry.
Removing the binding or disabling the owner/policy denies subsequent QA access.

## Activation and cleanup receipt — HOLD until PR merge

The user authorized two hours covering Core and coordination, synthetic live
Google QA, and revocation. This authorization persists; do not request it again.
Merge the reviewed implementation first (no automatic merge is authorized), then
deploy the exact merged main frontend and Pages Functions without the grant.
No migration or scheduled-worker deployment is needed. Verify release/health and
paused checkout before issuing the grant; do not alter unrelated bindings.

Follow the existing identity verification and private mode-0600 file procedure
in owner-core-qa-license.md. Compare the one enrolled owner's subject with the
current verified Google identity; stop on mismatch or multiple owners. Generate
only immediately before activation:

```
node scripts/prepare-owner-core-qa.mjs --identity-file /private/tmp/streamlion-owner-identity.json --out /private/tmp/streamlion-owner-coordination-qa.json --coordination
```

Set only the encrypted Production binding to that file's JSON and redeploy the
same merged revision. Verify purchased:false, owner-only QA deadline, anonymous
and other-account denial, and paused checkout. Record deployment and deadline
without printing identity/secret values. Do not create a paid purchase, add
credits, send email/push, make AI/speech calls or perform paid delivery.

Use a new private synthetic Google workbook/folder; preserve original selections.
Create an anonymous public form without email verification; keep its capability
private. Submit the realistic commercial scope, review/clarify/approve as both
roles, verify agreed fields and signed Google history, organize all tasks, save
and reopen, add a manual task and an exception, and query exact saved facts.
Use no real customer data. Verify no purchase, starter grant or spend was created.

Before removing QA: disable the test form, revoke the test coordination
connection/client access, restore original selections, and retain readback
receipts. Remove only the QA binding and redeploy the same revision. Verify QA
and coordination access deny again, checkout remains paused, and configuration
returns to its pre-activation fingerprint. Delete private identity/grant files.
Retain the synthetic workbook in private storage with the receipt. Two-hour
expiry independently denies access if cleanup is interrupted.
