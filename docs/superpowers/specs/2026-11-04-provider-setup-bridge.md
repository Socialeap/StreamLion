# Shared provider setup — implementation boundary

Owner direction: the provider wizard lives in StreamLion. F|3D/Supabase owns shared identity, branding, services and geography. StreamLion/Cloudflare owns operational setup; Google retains authoritative project records. Public profile, Directory listing and Studio entitlements remain separate.

## Audit and first deliverable

F|3D currently has `profiles`, `business_public_profiles` (one owner per public page), and `private_brief.providers` (Directory enrollment/services). These are not yet a multi-business membership model. StreamLion setup is Google-subject scoped, with local working copies and D1 snapshots, and separately saved branding/pricing. Original PR159 was merged before the owner's removal correction; this branch carries that correction forward from current main.

Increment 1: an explicit, verified, read-only profile snapshot connection. No third profile editor/store of authority. F|3D reads the existing records through the signed-in user's RLS client. Its backend signs a short-lived audience/nonce-bound snapshot; the SL backend verifies it and binds it to the initiating Google session. No F|3D session tokens or refresh credentials cross products. Snapshot conveys no roles, entitlement, credit or publication authority. Display both profile sources distinctly; missing or conflicting fields require later reconciliation, never silent writeback.

Popup messages require exact origin AND window source. Nonce created by authenticated same-origin POST; hashed pending nonce in D1 bound to exact session and Google subject/mode. Expired/replayed/foreign-session assertions rejected atomically. Ed25519 private signing key stays on F|3D; only a public verification key configured on Cloudflare. Disabled/missing config/schema fail closed. No automatic account linking by email.

Snapshot is manual refresh, not ongoing synchronization or SSO. Unlink deletes only the local snapshot. No remote grant to revoke. Snapshot freshness is visible and never used for permissions. Existing operations remain usable when bridge is unavailable. Maximum assertion lifetime 120 seconds; pending attempt 10 minutes. No publication, enrollment, trial, payment, Google write or marketing action on connect.

## Subsequent increments

Shared field/schema and service-specific coverage canonicalization; expected-version shared writes; resumable shared/SL wizard save checkpoints; durable change delivery/reconciliation; existing account migration; common sign-in. Each requires scoped tests and review before activation. They are not certified by this read-only milestone.

## Verification and release

Negative tests for bad signatures/audience/expiry, malformed or overbroad snapshots, nonce replay/session switching, missing activation/config, source/origin popup checks, and existing SL save/entitlement behavior. Run scoped checks, full SL suite, F|3D types/build/record artifacts, and fresh branch review. Merge, F|3D app/secret activation, SL D1/Worker configuration and frontend release, authenticated/device QA, provider enrollment, public Directory opening remain distinct. No activation authorized by implementation request.
