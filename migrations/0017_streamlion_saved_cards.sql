-- Additive only. One optional saved card per Google account and payment mode,
-- for top-ups the account holder starts. Card numbers stay with Stripe; this
-- table keeps the Stripe customer and payment method IDs plus the brand, last
-- four digits and expiry shown on the Credits page. No balances, orders,
-- policies or webhooks change, and nothing here charges a card on its own.
CREATE TABLE streamlion_credit_cards_v1 (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  google_subject TEXT NOT NULL,
  customer_id TEXT NOT NULL UNIQUE CHECK(customer_id GLOB 'cus_*'),
  payment_method TEXT UNIQUE CHECK(payment_method IS NULL OR payment_method GLOB 'pm_*'),
  brand TEXT CHECK(brand IS NULL OR length(brand) <= 20),
  last4 TEXT CHECK(last4 IS NULL OR (length(last4) = 4 AND last4 NOT GLOB '*[^0-9]*')),
  exp_month INTEGER CHECK(exp_month IS NULL OR exp_month BETWEEN 1 AND 12),
  exp_year INTEGER CHECK(exp_year IS NULL OR exp_year BETWEEN 2000 AND 2200),
  saved_order_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK((payment_method IS NULL) = (last4 IS NULL)),
  PRIMARY KEY(mode,google_subject)
);
-- Marks orders paid with a saved card (the existing orders table is unchanged)
-- and records which customer and card each top-up used.
CREATE TABLE streamlion_credit_topups_v1 (
  order_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL CHECK(customer_id GLOB 'cus_*'),
  payment_method TEXT NOT NULL CHECK(payment_method GLOB 'pm_*'),
  created_at INTEGER NOT NULL
);
CREATE TABLE streamlion_credit_cards_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_credit_cards_schema_v1 VALUES(1);
