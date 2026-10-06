# Closed AI pilot reopening receipt — 2026-10-06

Verified at approximately 23:07 UTC through the authenticated Cloudflare
dashboard and the approved business account's StreamLion browser session.
This receipt proves configuration availability, not a new provider/phone test.

- Production main SHA: `ad4650dce44727a75de17aef56fa997ce6f913a6` (PR #53).
- Cloudflare production deployment: `43a3515b-3f81-4baa-a3bb-c07d1b43f4d7`,
  success at 18:55 America/New_York. Its Functions receipt includes
  `/api/ai/:path*` → `api/ai/[[path]].js:onRequest`.
- Public `/release.json` independently returned the same main revision.
- D1 preflight: all eight AI markers present; policy inactive, price 12,500,
  daily requests 30, daily reservation budget 180,000, nine lifetime attempts,
  zero pending attempts, 54,000 cumulative reserved micro-USD.
- A signed-in `/api/ai/config` recheck returned HTTP 200 with
  `enabled:false, reason:pilot_paused`. The old button performed the read but
  supplied no progress/completion feedback for that unchanged result.
- Ran only the guarded policy reopening UPDATE committed in `docs/AI_PILOT.md`.
  No migration, wallet grant/reset, account enrollment, secret/environment change,
  provider purchase or auto-recharge occurred.
- Readback: policy active; quote/daily limits unchanged; nine lifetime attempts,
  zero pending, 54,000 reserved; approved business wallet still enabled with
  262,500 internal micro-USD = 21 credits at one credit per completed answer.
- Signed-in config then returned `enabled:true`, a valid opaque preference scope,
  price 12,500 and balance 262,500. Settings visibly offered Use AI credits.
- No `/api/ai/answer` request or provider call was made for this verification.
  Attempts/balance unchanged: zero credits spent.

The existing 30-total-attempt/$1 provider allowance and closed account enrollment
remain in force. PR #53's cumulative guard permits this bounded pilot to remain
open between tests; this supersedes the pause-after-every-test instruction in the
historical setup receipt. An explicit free preference stays free until the user
chooses Use AI credits. Rechecking cannot reopen an administrator pause by itself.

The availability-feedback follow-up changes frontend code only. Review/merge it,
verify its Cloudflare production build, update the installed PWA and retest the
dialog on Android. It needs no additional D1, secret or provider configuration.
No Lovable action is required.
