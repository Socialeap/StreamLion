# Saved-card credit top-ups — release held

Providers can optionally save a card while buying a credit pack, then add
credits later with one confirmed tap on the Credits page. This is closed by
default and adds no subscription, schedule or automatic recharge: a saved card
is charged only when its account holder chooses a pack and confirms **Pay**.
Packs, prices, the shared ledger, refunds and disputes are unchanged.

## Behaviour

- **Saving.** With saved cards enabled, the Credits page shows an unchecked
  **Save my card for one-tap top-ups** option. Choosing it creates (once) a
  Stripe Customer for the Google account and mode, and the Checkout Session
  uses that customer with `payment_intent_data.setup_future_usage=on_session`
  and `save_card` metadata; Checkout's submit text says the card is saved only
  for top-ups the provider starts. When the payment is reconciled as paid, the
  card's Stripe IDs, brand, last four digits and expiry are stored, but only
  while Stripe still shows the card attached to that customer. An older order
  never replaces a newer card, and a removed card stays removed.
- **One tap.** Choosing a pack with a saved card shows **Pay $X** with the
  card, plus Cancel and **Pay with another card** (ordinary Checkout).
  `/api/credits/topup` rechecks sales readiness, the checkout/owner-QA gate,
  the paid Core entitlement, rate limits, the Stripe catalog and pending orders,
  then records the order, marks it in `streamlion_credit_topups_v1` with the
  card used, and confirms a PaymentIntent server-side with
  `error_on_requires_action=true` and an idempotency key per order. Success is
  settled from the PaymentIntent and credited through the existing grant
  trigger. If the bank asks to confirm, nothing is charged and the page offers
  **Continue in Checkout** for the same pack; a decline charges nothing; a card
  Stripe can no longer use is forgotten.
- **Uncertain outcomes.** If the charge response is lost, the order stays
  pending: another top-up or Checkout is refused until it settles, and retrying
  the same pack reuses the idempotency key. A `payment_intent.succeeded` or
  `payment_intent.payment_failed` webhook settles it from the PaymentIntent.
  A saved-card order never expires on the one-hour timer: after the hour,
  StreamLion searches Stripe for a PaymentIntent with that order ID, credits it
  if found, and closes the order only when none exists (PaymentIntents read,
  which the key already has). Refund and dispute events for top-ups follow the existing proportional
  revoke and debt rules.
- **Removing.** **Remove card** detaches the payment method at Stripe and
  clears it, and works even while sales or saved cards are closed.
- **Isolation.** Cards, customers and top-ups are per Google account and
  payment mode; another account cannot use or remove them.

Terms and the privacy notice describe the saved card. Review that wording
before enabling.

## Separate release gates

1. **Review/merge:** owner review of the exact PR; this review does not
   authorize merge.
2. **Migration:** HOLD for owner authorization after merge. Take a D1 recovery
   bookmark, then check for the three markers
   `streamlion_credit_cards_v1`, `streamlion_credit_topups_v1` and
   `streamlion_credit_cards_schema_v1`. All absent: apply
   `migrations/0017_streamlion_saved_cards.sql` byte-for-byte in one
   transaction and verify the definitions and version 1. All present with
   matching definitions: skip. Partial or mismatched: stop and report. The
   migration is additive and leaves orders, wallets, policies and events as
   they are; the existing credit preflight in
   [AI credit activation](ai-credit-activation.md) still applies first.
3. **Configuration:** HOLD for separate owner approval, in this order:
   - Stripe restricted key: add **Customers write**, **PaymentIntents write**
     and **PaymentMethods write** to the existing permissions. The owner enters
     any new key directly into Cloudflare secrets.
   - Credits webhook destination (`/api/credits/webhook`): add
     `payment_intent.succeeded` and `payment_intent.payment_failed` at
     `2026-08-26.dahlia`, keeping the existing events. Record IDs only.
   - Set `STREAMLION_SAVED_CARDS_ENABLED=true` last. Absent or any other value
     keeps saving and one-tap top-ups closed (removal stays available).
4. **Server deployment:** HOLD for explicit authorization. Deploy the merged
   Pages Functions; check `/api/credits/config` reports `savedCards`, that
   anonymous and cross-account `topup`/`card` requests are refused, and that
   the paused checkout gate refuses `topup`.
5. **Frontend deployment:** the Credits page controls ship with the same
   assets; they appear only when the server reports saved cards available.
6. **Owner/device QA (test mode, $0):** with a synthetic signed-in account,
   save `4242 4242 4242 4242` at checkout, top up with one tap, replay the
   webhooks, refund partially, remove the card and confirm a late replay does
   not restore it. Use `4000 0027 6000 3184` to see **Continue in Checkout**
   and `4000 0000 0000 9995` for a decline. Repeat on a physical phone in the
   installed app. Live use needs its own explicit spend approval.

No Lovable action is involved; GitHub, Cloudflare and Stripe are the only
systems used.
