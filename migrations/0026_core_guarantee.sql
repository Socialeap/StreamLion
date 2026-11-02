-- Additive only. Preserve historical purchases, prices, trials and promises.
ALTER TABLE streamlion_purchases_v1 ADD COLUMN core_offer TEXT;
ALTER TABLE streamlion_purchases_v1 ADD COLUMN refund_days INTEGER CHECK(refund_days IS NULL OR refund_days IN(7,14,30));
ALTER TABLE streamlion_purchases_v1 ADD COLUMN paid_at INTEGER;
CREATE TABLE streamlion_core_refund_requests_v1 (
 order_id TEXT PRIMARY KEY REFERENCES streamlion_purchases_v1(order_id),
 mode TEXT NOT NULL CHECK(mode IN('test','live')),
 received_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN('requested','pending','succeeded','failed','ineligible')),
 refund_id TEXT UNIQUE,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX streamlion_core_refund_due_v1 ON streamlion_core_refund_requests_v1(mode,next_attempt_at);
CREATE TABLE streamlion_core_guarantee_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_core_guarantee_schema_v1 VALUES(1);
