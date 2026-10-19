-- Additive only. Existing orders keep their original untaxed Checkout contract.
ALTER TABLE streamlion_purchases_v1 ADD COLUMN checkout_tax_mode TEXT NOT NULL DEFAULT 'off' CHECK(checkout_tax_mode IN ('off','stripe'));
ALTER TABLE streamlion_credit_orders_v1 ADD COLUMN checkout_tax_mode TEXT NOT NULL DEFAULT 'off' CHECK(checkout_tax_mode IN ('off','stripe'));
CREATE TABLE streamlion_checkout_tax_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_checkout_tax_schema_v1(version) VALUES(1);
