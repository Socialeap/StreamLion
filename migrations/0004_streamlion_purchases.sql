-- Apply byte-for-byte only when all markers named in docs/stripe-activation.md are absent.
-- Financial/license records only. Project content remains in Google.
CREATE TABLE streamlion_purchases_v1 (
  order_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  google_subject TEXT NOT NULL,
  checkout_email TEXT NOT NULL,
  price_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'usd'),
  promo_slot INTEGER CHECK (promo_slot BETWEEN 1 AND 100),
  checkout_session TEXT UNIQUE,
  checkout_url TEXT,
  payment_intent TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','paid','expired','failed','refunded','disputed')),
  amount_refunded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE (mode, promo_slot)
);
CREATE INDEX streamlion_purchase_owner_v1 ON streamlion_purchases_v1(mode, google_subject, status);
CREATE UNIQUE INDEX streamlion_purchase_pending_v1 ON streamlion_purchases_v1(mode, google_subject) WHERE status IN ('pending','processing');
CREATE TABLE streamlion_stripe_events_v1 (
  event_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
CREATE TABLE streamlion_purchase_limits_v1 (
  identity TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL
);
CREATE INDEX streamlion_purchase_limit_expiry_v1 ON streamlion_purchase_limits_v1(window);
CREATE TABLE streamlion_purchase_schema_v1 (version INTEGER PRIMARY KEY CHECK (version = 1));
INSERT INTO streamlion_purchase_schema_v1 VALUES (1);
