# Provider profile snapshot bridge — review and release gates

This is increment1, a verified READ-ONLY snapshot connection. Shared account creation, shared saves, canonical service/geography reconciliation, continuous synchronization and SSO remain later increments. It grants no entitlement and changes no project, credit, license, public visibility or enrollment record.

## Cross-repository contract

F3D `src/lib/f3d-profile.mjs` and SL `src/f3d-profile.js` must be byte-identical. Signature issuer `https://www.frontiers3d.com`; sole audience `https://streamlion.transcendencemedia.com`. Existing F3D owner-only reads: `business_public_profiles` explicit projection and `private_brief_profile()` (verified-session RPC). No new F3D table/RPC/Edge function. The public and Directory profiles remain separately identified, not silently merged. No new API sends SL private work to F3D.

Owner opens F3D consent popup from SL Account or setup. Exact-origin/source handshake carries a random pending nonce. F3D signs owner-visible projection only after explicit approval. SL accepts a two-minute assertion only with its same-session, same-subject, same-mode pending nonce; D1 atomically consumes it. Only snapshot and verification timestamp persist. No remote session credential, JWT, password or refresh token is stored. Unlink removes only local cache/attempt. Snapshot is not an authorization source.

## Ordered release gates — all held

1. Review/merge both companion PRs. Preserve SL's correction removing local public-branding controls. No release is implied by merge.
2. Owner-authorized F3D release promotion of the exact reviewed feature through its existing controlled release mechanism. Do not bypass Studio rollout locks or deploy unrelated functions. Confirm promoted source markers before configuration.
3. Owner prepares the purpose-specific Ed25519 key pair locally, once, using the committed script: `node scripts/create-provider-profile-key.mjs PRIVATE_JWK_FILE PUBLIC_JWK_FILE`. Files are exclusive-create with mode0600; private values are never printed. No key has been generated/provisioned by Codex for this release. Transfer private JSON out of band to F3D server secret `F3D_PROVIDER_PROFILE_PRIVATE_JWK`. Set server flag `ENABLE_STREAMLION_PROFILE_BRIDGE=true` only with that key and authorized application activation. Never expose it through VITE or return it from an API. Share activation receipt, not key values.
4. Cloudflare: verify `streamlion_f3d_profile_v1` is wholly absent before applying ONLY committed `migrations/0027_f3d_profile_snapshot.sql` to `streamlion-google-sessions` (GOOGLE_SESSIONS). If wholly present verify all columns/constraints; if partial STOP, never recreate or substitute SQL. Use an isolated test D1 first; migration does not alter existing tables. Do not blindly apply all pending migrations.
5. Configure Pages/Functions `F3D_PROVIDER_PROFILE_PUBLIC_JWK` with public JSON (must not contain `d`). Keep `ENABLE_F3D_PROFILE_BRIDGE` off until migration, F3D signing and exact-source frontend/server release are ready. Set it true only under separate owner authorization. No payment/Google/AI settings change, new service subscription or AI spend. No SL Lovable action.
6. Separate Cloudflare frontend/Functions release and served-artifact verification. GET /api/f3d-profile anonymously must return401; signed-in but disabled/missing-schema must fail closed. Real authenticated linkage requires owner/device QA: right Google owner, right F3D owner, popup/login return, source values, no private-field overexport, refresh/unlink/reconnect, timeout and account switching. No success claim from CI alone.
7. Provider enrollment/public Directory discovery opening remain separate approvals. This feature cannot publish/enroll/upgrade.

## Operating limits

No automatic sync promise: display verified timestamp, require manual refresh. Display name conflicts separately. If either backend fails, preserve existing local setup and report pending/failure. New F3D signup follows its existing free-provider flow; after signup return to SL and restart linking. Existing-account linkage is tested locally; new shared registration is not delivered by increment1.

## Rollback and diagnostics

Disable either bridge flag to stop new approvals/acceptance; existing operational setup remains available. Do not delete source profiles, D1 project/license/credit/Google tables or Google records. Re-enable only after key/version/config matching. A signature problem is a configuration failure, never a reason to bypass verification. Never log assertions, nonces or private keys. Log only coarse counts/status if later diagnostics are added.

## Source validation receipt

StreamLion1285tests PASS, production build PASS. F3D4963tests PASS (task-local dependencies include the existing committed auth-js patch; pinned rollout commits fetched for historical regression fixtures), production build PASS, scoped profile tests PASS. Independent source review raised and verified fixes for uncertain completion response reconciliation and existing Directory text whitespace. Source contract parity checked byte-for-byte. These tests use synthetic identities and ephemeral test signing keys only, not live accounts/configuration. No production keys were generated and no authenticated deployment acceptance is claimed.
