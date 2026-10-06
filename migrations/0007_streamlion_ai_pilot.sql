-- Pilot credits are owner-granted, not paid top-ups. Monetary units are micro-USD.
CREATE TABLE streamlion_ai_policy_v1 (
  id INTEGER PRIMARY KEY CHECK(id=1), active INTEGER NOT NULL DEFAULT 0 CHECK(active IN(0,1)),
  price_micros INTEGER NOT NULL DEFAULT 12500 CHECK(price_micros BETWEEN 1000 AND 1000000),
  daily_budget_micros INTEGER NOT NULL DEFAULT 0 CHECK(daily_budget_micros BETWEEN 0 AND 10000000),
  daily_requests INTEGER NOT NULL DEFAULT 100 CHECK(daily_requests BETWEEN 1 AND 1000)
);
INSERT INTO streamlion_ai_policy_v1(id) VALUES(1);
CREATE TABLE streamlion_ai_wallets_v1 (
  google_subject TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
  balance_micros INTEGER NOT NULL CHECK(balance_micros>=0)
);
CREATE TABLE streamlion_ai_turns_v1 (
  google_subject TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  price_micros INTEGER NOT NULL CHECK(price_micros>0), reserve_micros INTEGER NOT NULL CHECK(reserve_micros=6000),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','complete','failed')),
  PRIMARY KEY(google_subject,request_id)
);
CREATE INDEX streamlion_ai_turns_time_v1 ON streamlion_ai_turns_v1(created_at);
CREATE TRIGGER streamlion_ai_reserve_v1 BEFORE INSERT ON streamlion_ai_turns_v1 BEGIN
  SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS(
    SELECT 1 FROM streamlion_ai_policy_v1 p JOIN streamlion_ai_wallets_v1 w
    ON w.google_subject=NEW.google_subject WHERE p.id=1 AND p.active=1 AND w.enabled=1
    AND w.balance_micros>=NEW.price_micros AND p.price_micros=NEW.price_micros
    AND (SELECT COUNT(*) FROM streamlion_ai_turns_v1 WHERE google_subject=NEW.google_subject AND created_at>NEW.created_at-60000)<6
    AND NOT EXISTS(SELECT 1 FROM streamlion_ai_turns_v1 WHERE google_subject=NEW.google_subject AND state='reserved')
    AND (SELECT COUNT(*) FROM streamlion_ai_turns_v1 WHERE created_at>=NEW.created_at-NEW.created_at%86400000)<p.daily_requests
    AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_ai_turns_v1 WHERE created_at>=NEW.created_at-NEW.created_at%86400000)+NEW.reserve_micros<=p.daily_budget_micros
  ) THEN RAISE(ABORT,'ai_capacity') END;
END;
CREATE TRIGGER streamlion_ai_debit_v1 AFTER INSERT ON streamlion_ai_turns_v1 BEGIN
  UPDATE streamlion_ai_wallets_v1 SET balance_micros=balance_micros-NEW.price_micros WHERE google_subject=NEW.google_subject;
END;
CREATE TRIGGER streamlion_ai_transition_v1 BEFORE UPDATE ON streamlion_ai_turns_v1 BEGIN
  SELECT CASE WHEN OLD.state!='reserved' OR NEW.state NOT IN('complete','failed')
    OR NEW.google_subject!=OLD.google_subject OR NEW.request_id!=OLD.request_id OR NEW.created_at!=OLD.created_at
    OR NEW.price_micros!=OLD.price_micros OR NEW.reserve_micros!=OLD.reserve_micros
    THEN RAISE(ABORT,'ai_transition') END;
END;
CREATE TRIGGER streamlion_ai_refund_v1 AFTER UPDATE OF state ON streamlion_ai_turns_v1 WHEN NEW.state='failed' BEGIN
  UPDATE streamlion_ai_wallets_v1 SET balance_micros=balance_micros+OLD.price_micros WHERE google_subject=OLD.google_subject;
END;
