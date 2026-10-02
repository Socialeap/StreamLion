-- Apply byte-for-byte in one transaction only after the 0004 markers match,
-- and while the v2 stamp and staging table are both absent. See stripe-activation.md.
-- Rebuild only the purchase table to widen its CHECK; retain every financial record.
CREATE TABLE streamlion_purchases_200_stage (
  order_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('test', 'live')),
  google_subject TEXT NOT NULL,
  checkout_email TEXT NOT NULL,
  price_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency = 'usd'),
  promo_slot INTEGER CHECK (promo_slot BETWEEN 1 AND 200),
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
INSERT INTO streamlion_purchases_200_stage (
  order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,
  promo_slot,checkout_session,checkout_url,payment_intent,status,amount_refunded,
  created_at,expires_at,updated_at,revision
)
SELECT order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,
  promo_slot,checkout_session,checkout_url,payment_intent,status,amount_refunded,
  created_at,expires_at,updated_at,revision
FROM streamlion_purchases_v1;
DROP TABLE streamlion_purchases_v1;
ALTER TABLE streamlion_purchases_200_stage RENAME TO streamlion_purchases_v1;
CREATE INDEX streamlion_purchase_owner_v1 ON streamlion_purchases_v1(mode, google_subject, status);
CREATE UNIQUE INDEX streamlion_purchase_pending_v1 ON streamlion_purchases_v1(mode, google_subject) WHERE status IN ('pending','processing');
CREATE TABLE streamlion_purchase_schema_v2 (version INTEGER PRIMARY KEY CHECK (version = 2));
INSERT INTO streamlion_purchase_schema_v2 VALUES (2);
