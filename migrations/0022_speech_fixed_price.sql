-- Requires exact migration 0021. Retail price is 1 credit; cost_micros
-- remains an independent provider-cost reserve. No activation, budget,
-- wallet or historical ledger values are changed.
ALTER TABLE streamlion_speech_policy_v1 ADD COLUMN price_micros INTEGER NOT NULL DEFAULT 12500 CHECK(price_micros=12500);
DROP TRIGGER streamlion_speech_reserve_v1;
CREATE TRIGGER streamlion_speech_reserve_v2 BEFORE INSERT ON streamlion_speech_turns_v1 BEGIN
 SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS (
  SELECT 1 FROM streamlion_speech_policy_v1 p JOIN streamlion_credit_wallets_v1 w
  ON w.mode=p.mode AND w.google_subject=NEW.google_subject
  WHERE p.mode=NEW.mode AND p.active=1 AND p.cost_micros>0 AND p.cost_micros=NEW.reserve_micros
  AND NEW.price_micros=p.price_micros AND p.price_micros=12500 AND w.balance_micros>=NEW.price_micros
  AND (SELECT COUNT(*) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND created_at>NEW.created_at-60000)<3
  AND (SELECT COUNT(*) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)<p.daily_requests
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)+NEW.reserve_micros<=p.daily_budget_micros
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode)+NEW.reserve_micros<=p.total_budget_micros
 ) THEN RAISE(ABORT,'speech_capacity') END;
END;
CREATE TABLE streamlion_speech_pricing_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_speech_pricing_schema_v1 VALUES(1);
