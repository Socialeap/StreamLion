-- Additive only: old orders retain their original Checkout/reconciliation contract.
ALTER TABLE streamlion_purchases_v1 ADD COLUMN checkout_business_policy INTEGER NOT NULL DEFAULT 0 CHECK(checkout_business_policy IN (0,1));
ALTER TABLE streamlion_credit_orders_v1 ADD COLUMN checkout_business_policy INTEGER NOT NULL DEFAULT 0 CHECK(checkout_business_policy IN (0,1));
CREATE TABLE streamlion_checkout_business_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_checkout_business_schema_v1(version) VALUES(1);
