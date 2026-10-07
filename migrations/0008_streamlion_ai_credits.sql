-- Paid credits have their own mode-scoped ledger. Pilot grants never become money.
-- No expiration, subscription, automatic recharge, or provider call is installed.
CREATE TABLE streamlion_credit_policy_v1 (
  mode TEXT PRIMARY KEY CHECK(mode IN ('test','live')),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  cost_micros INTEGER NOT NULL DEFAULT 0 CHECK(cost_micros BETWEEN 0 AND 1000000),
  daily_budget_micros INTEGER NOT NULL DEFAULT 0 CHECK(daily_budget_micros BETWEEN 0 AND 10000000),
  total_budget_micros INTEGER NOT NULL DEFAULT 0 CHECK(total_budget_micros BETWEEN 0 AND 100000000),
  daily_requests INTEGER NOT NULL DEFAULT 0 CHECK(daily_requests BETWEEN 0 AND 1000)
);
INSERT INTO streamlion_credit_policy_v1(mode) VALUES ('test'),('live');
CREATE TABLE streamlion_credit_wallets_v1 (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')), google_subject TEXT NOT NULL,
  balance_micros INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(mode,google_subject)
);
CREATE TABLE streamlion_credit_orders_v1 (
  order_id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  google_subject TEXT NOT NULL, checkout_email TEXT NOT NULL,
  price_id TEXT NOT NULL, product_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount IN (1000,2500,5000)),
  currency TEXT NOT NULL CHECK(currency='usd'), credits_micros INTEGER NOT NULL CHECK(credits_micros=amount*10000),
  checkout_session TEXT UNIQUE, checkout_url TEXT, payment_intent TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','paid','expired','failed','refunded','disputed')),
  credited_micros INTEGER NOT NULL DEFAULT 0 CHECK(credited_micros BETWEEN 0 AND credits_micros),
  amount_refunded INTEGER NOT NULL DEFAULT 0 CHECK(amount_refunded>=0),
  revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX streamlion_credit_pending_v1 ON streamlion_credit_orders_v1(mode,google_subject) WHERE status IN ('pending','processing');
CREATE TRIGGER streamlion_credit_grant_v1 AFTER UPDATE OF credited_micros ON streamlion_credit_orders_v1
WHEN NEW.credited_micros != OLD.credited_micros BEGIN
  INSERT INTO streamlion_credit_wallets_v1(mode,google_subject,balance_micros)
  VALUES(NEW.mode,NEW.google_subject,NEW.credited_micros-OLD.credited_micros)
  ON CONFLICT(mode,google_subject) DO UPDATE SET balance_micros=balance_micros+excluded.balance_micros;
END;
CREATE TABLE streamlion_credit_turns_v1 (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')), google_subject TEXT NOT NULL, request_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, price_micros INTEGER NOT NULL CHECK(price_micros>0),
  reserve_micros INTEGER NOT NULL CHECK(reserve_micros=6000),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','complete','failed')),
  PRIMARY KEY(mode,google_subject,request_id)
);
CREATE INDEX streamlion_credit_turns_time_v1 ON streamlion_credit_turns_v1(mode,created_at);
CREATE TRIGGER streamlion_credit_reserve_v1 BEFORE INSERT ON streamlion_credit_turns_v1 BEGIN
  SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS(
    SELECT 1 FROM streamlion_credit_policy_v1 p JOIN streamlion_credit_wallets_v1 w
    ON w.mode=p.mode AND w.google_subject=NEW.google_subject WHERE p.mode=NEW.mode AND p.active=1
    AND p.cost_micros>=NEW.reserve_micros AND NEW.price_micros=(p.cost_micros*130+99)/100
    AND w.balance_micros>=NEW.price_micros
    AND NOT EXISTS(SELECT 1 FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND state='reserved')
    AND (SELECT COUNT(*) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND created_at>NEW.created_at-60000)<6
    AND (SELECT COUNT(*) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)<p.daily_requests
    AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)+NEW.reserve_micros<=p.daily_budget_micros
    AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode)+NEW.reserve_micros<=p.total_budget_micros
  ) THEN RAISE(ABORT,'credit_capacity') END;
END;
CREATE TRIGGER streamlion_credit_debit_v1 AFTER INSERT ON streamlion_credit_turns_v1 BEGIN
  UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros-NEW.price_micros WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
END;
CREATE TRIGGER streamlion_credit_transition_v1 BEFORE UPDATE ON streamlion_credit_turns_v1 BEGIN
  SELECT CASE WHEN OLD.state!='reserved' OR NEW.state NOT IN ('complete','failed')
    OR NEW.mode!=OLD.mode OR NEW.google_subject!=OLD.google_subject OR NEW.request_id!=OLD.request_id OR NEW.created_at!=OLD.created_at
    OR NEW.price_micros!=OLD.price_micros OR NEW.reserve_micros!=OLD.reserve_micros
    THEN RAISE(ABORT,'credit_transition') END;
END;
CREATE TRIGGER streamlion_credit_return_v1 AFTER UPDATE OF state ON streamlion_credit_turns_v1 WHEN NEW.state='failed' BEGIN
  UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros+OLD.price_micros WHERE mode=OLD.mode AND google_subject=OLD.google_subject;
END;
CREATE TABLE streamlion_credit_events_v1(event_id TEXT PRIMARY KEY,mode TEXT NOT NULL,event_type TEXT NOT NULL,processed_at INTEGER NOT NULL);
CREATE TABLE streamlion_credit_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_credit_schema_v1 VALUES(1);
