-- Speech-only is independently priced and closed by default. No existing rows change.
CREATE TABLE streamlion_speech_policy_v1 (
 mode TEXT PRIMARY KEY CHECK(mode IN ('test','live')),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
 cost_micros INTEGER NOT NULL DEFAULT 0 CHECK(cost_micros BETWEEN 0 AND 1000000),
 daily_budget_micros INTEGER NOT NULL DEFAULT 0 CHECK(daily_budget_micros BETWEEN 0 AND 10000000),
 total_budget_micros INTEGER NOT NULL DEFAULT 0 CHECK(total_budget_micros BETWEEN 0 AND 100000000),
 daily_requests INTEGER NOT NULL DEFAULT 0 CHECK(daily_requests BETWEEN 0 AND 1000)
);
INSERT INTO streamlion_speech_policy_v1(mode) VALUES('test'),('live');
CREATE TABLE streamlion_speech_turns_v1 (
 mode TEXT NOT NULL CHECK(mode IN ('test','live')), google_subject TEXT NOT NULL, request_id TEXT NOT NULL,
 scope TEXT NOT NULL, input_hash TEXT NOT NULL,
 price_micros INTEGER NOT NULL CHECK(price_micros>0), reserve_micros INTEGER NOT NULL CHECK(reserve_micros>0),
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','complete','failed')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(mode,google_subject,request_id)
);
CREATE UNIQUE INDEX idx_streamlion_speech_pending ON streamlion_speech_turns_v1(mode,google_subject) WHERE state='reserved';
CREATE INDEX idx_streamlion_speech_capacity ON streamlion_speech_turns_v1(mode,created_at);
CREATE TRIGGER streamlion_speech_reserve_v1 BEFORE INSERT ON streamlion_speech_turns_v1 BEGIN
 SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS (
  SELECT 1 FROM streamlion_speech_policy_v1 p JOIN streamlion_credit_wallets_v1 w
  ON w.mode=p.mode AND w.google_subject=NEW.google_subject
  WHERE p.mode=NEW.mode AND p.active=1 AND p.cost_micros>0 AND p.cost_micros=NEW.reserve_micros
  AND NEW.price_micros=(p.cost_micros*130+99)/100 AND w.balance_micros>=NEW.price_micros
  AND (SELECT COUNT(*) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND created_at>NEW.created_at-60000)<3
  AND (SELECT COUNT(*) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)<p.daily_requests
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)+NEW.reserve_micros<=p.daily_budget_micros
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode)+NEW.reserve_micros<=p.total_budget_micros
 ) THEN RAISE(ABORT,'speech_capacity') END;
END;
CREATE TRIGGER streamlion_speech_debit_v1 AFTER INSERT ON streamlion_speech_turns_v1 BEGIN
 UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros-NEW.price_micros WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
END;
CREATE TRIGGER streamlion_speech_transition_v1 BEFORE UPDATE ON streamlion_speech_turns_v1 BEGIN
 SELECT CASE WHEN OLD.state!='reserved' OR NEW.state NOT IN ('complete','failed') OR NEW.mode!=OLD.mode
 OR NEW.google_subject!=OLD.google_subject OR NEW.request_id!=OLD.request_id OR NEW.scope!=OLD.scope
 OR NEW.input_hash!=OLD.input_hash OR NEW.price_micros!=OLD.price_micros OR NEW.reserve_micros!=OLD.reserve_micros
 OR NEW.created_at!=OLD.created_at THEN RAISE(ABORT,'speech_transition') END;
END;
CREATE TRIGGER streamlion_speech_refund_v1 AFTER UPDATE OF state ON streamlion_speech_turns_v1 WHEN NEW.state='failed' BEGIN
 UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros+OLD.price_micros WHERE mode=OLD.mode AND google_subject=OLD.google_subject;
END;
CREATE TABLE streamlion_speech_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_speech_schema_v1 VALUES(1);
