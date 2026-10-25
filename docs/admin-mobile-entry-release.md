# Admin entry for previously installed PWAs

An older installed worker can serve the offline workspace for `/admin/` before any current admin routing code runs. Refresh and Google sign-in do not reliably replace a waiting worker. This was observed during initial activation and reported on Android.

The canonical admin entry is `/api/admin-portal`. The API navigation exclusion already shipped in pre-admin workers sends this path to the network on its first visit. The static HTML is excluded from Pages Functions routing and service-worker precache, with no-store/noindex headers. Both the original admin entry and the network entry use the same admin bundle. `/admin/` remains available for current workers and desktop bookmarks.

Google sign-in accepts only the exact original and canonical admin continuations, maps both to `/api/admin-portal`, and preserves the admin nonce/auth_time/amr request. The sign-in link and admin home link use the canonical path. Ordinary sign-in destinations, server owner checks, idle/absolute windows and credit policy checks remain unchanged. No role, schema, provider, secret, permission or Google scope change is required.

## Validation

- Four regression assertions failed before the fix and passed afterwards: canonical Google return, assurance nonce for the new entry, legacy continuation canonicalization and rendered sign-in link.
- Full suite: **1,126 tests passed**, zero failed/skipped. App build, Pages Functions compile and diff checks passed.
- Actual Workbox NavigationRoute tests reproduce the original interception with the previously shipped denylist and verify the new entry bypasses it; ordinary workspace routes remain offline-capable.
- Synthetic browser fixture with an old worker controlling the page: original `/admin/` rendered the offline workspace, then first navigation to `/api/admin-portal` rendered the built admin entry at 390 px. Its sign-in link used the canonical continuation. This is browser proof, not physical Android acceptance. No live Google/provider calls or customer data were used. Only the synthetic localhost worker was removed afterwards; production storage was untouched.
- Built artifact checks verify both HTML entries share the same bundle, neither is precached, normal index.html remains precached, and only static shell routes bypass Functions. All protected admin API paths still invoke Functions.

## Held release steps

1. Review and explicitly approve merge of this fix. No live state has changed for this correction.
2. Deploy the approved merged SHA through the existing Cloudflare Pages project. This includes the Google callback Function and static frontend in the same scoped release; preserve all existing environment/bindings. No SQL migration, owner reenrollment, Google settings change, service-worker unregistration, storage clearing, provider attempt or credit write is needed.
3. Verify `/release.json`, the network admin entry's HTML/no-store/noindex headers, unauthenticated admin API denial, and the canonical Google return with synthetic tests. Confirm live read access remains enabled only for the existing enrolled owner and `grants_enabled=0` in both modes. Never change policies to obtain a passing result.
4. Owner opens `https://streamlion.transcendencemedia.com/api/admin-portal` on Android, signs in with the enrolled email and confirms reporting on the actual device. Replace the old mobile bookmark with this entry. Keep grants disabled. Owner sign-in is a separate manual acceptance step; no real provider request is needed for the source/build checks.

The correction has not been deployed. Physical Android first navigation and owner OAuth acceptance remain pending until the approved release. Do not report a local fixture as live phone acceptance.
