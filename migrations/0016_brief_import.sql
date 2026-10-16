-- Additive only. No existing policies, records, balances or pilot modes change.
-- Both rows are inactive and unpriced. Applying this migration cannot enable AI.
CREATE TABLE streamlion_brief_policy_v1 (
  mode TEXT PRIMARY KEY CHECK(mode IN ('test','live')),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  price_micros INTEGER NOT NULL DEFAULT 0 CHECK(price_micros BETWEEN 0 AND 5000000 AND price_micros%50000=0),
  reserve_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserve_micros=0 OR reserve_micros BETWEEN 100000 AND 1000000),
  daily_budget_micros INTEGER NOT NULL DEFAULT 0 CHECK(daily_budget_micros BETWEEN 0 AND 10000000),
  total_budget_micros INTEGER NOT NULL DEFAULT 0 CHECK(total_budget_micros BETWEEN 0 AND 100000000),
  daily_requests INTEGER NOT NULL DEFAULT 0 CHECK(daily_requests BETWEEN 0 AND 1000)
);
INSERT INTO streamlion_brief_policy_v1(mode) VALUES('test'),('live');
CREATE TABLE streamlion_brief_jobs_v1 (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')), google_subject TEXT NOT NULL, request_id TEXT NOT NULL,
  scope TEXT NOT NULL, input_hash TEXT NOT NULL, quote_key TEXT NOT NULL,
  price_micros INTEGER NOT NULL CHECK(price_micros>0), reserve_micros INTEGER NOT NULL CHECK(reserve_micros BETWEEN 100000 AND 1000000),
  promotional INTEGER NOT NULL CHECK(promotional>=0), purchased INTEGER NOT NULL CHECK(purchased>=0),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','failed')),
  result TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  CHECK(price_micros=promotional+purchased), CHECK(expires_at=created_at+86400000),
  PRIMARY KEY(mode,google_subject,request_id)
);
CREATE UNIQUE INDEX idx_streamlion_brief_pending ON streamlion_brief_jobs_v1(mode,google_subject) WHERE state='pending';
CREATE INDEX idx_streamlion_brief_capacity ON streamlion_brief_jobs_v1(mode,created_at,reserve_micros);
CREATE INDEX idx_streamlion_brief_cleanup ON streamlion_brief_jobs_v1(state,expires_at);
CREATE TRIGGER streamlion_brief_reserve_v1 BEFORE INSERT ON streamlion_brief_jobs_v1 BEGIN
  SELECT CASE WHEN NEW.state!='pending' OR NEW.result IS NOT NULL OR NOT EXISTS(
    SELECT 1 FROM streamlion_brief_policy_v1 p JOIN streamlion_credit_wallets_v1 w
    ON w.mode=p.mode AND w.google_subject=NEW.google_subject
    WHERE p.mode=NEW.mode AND p.active=1 AND p.reserve_micros=NEW.reserve_micros AND p.price_micros=NEW.price_micros
    AND NEW.price_micros>=NEW.reserve_micros AND w.balance_micros>=0 AND w.balance_micros>=NEW.purchased
    AND NEW.promotional=MIN(NEW.price_micros,COALESCE((SELECT balance_micros FROM streamlion_promotional_wallets_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0))
    AND (SELECT COUNT(*) FROM streamlion_brief_jobs_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND created_at>NEW.created_at-86400000)<10
    AND (SELECT COUNT(*) FROM streamlion_brief_jobs_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)<p.daily_requests
    AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_brief_jobs_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)+NEW.reserve_micros<=p.daily_budget_micros
    AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_brief_jobs_v1 WHERE mode=NEW.mode)+NEW.reserve_micros<=p.total_budget_micros
  ) THEN RAISE(ABORT,'brief_capacity') END;
END;
CREATE TRIGGER streamlion_brief_debit_v1 AFTER INSERT ON streamlion_brief_jobs_v1 BEGIN
  UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros-NEW.purchased WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
  UPDATE streamlion_promotional_wallets_v1 SET balance_micros=balance_micros-NEW.promotional WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
END;
CREATE TRIGGER streamlion_brief_transition_v1 BEFORE UPDATE ON streamlion_brief_jobs_v1 BEGIN
  SELECT CASE WHEN NEW.mode!=OLD.mode OR NEW.google_subject!=OLD.google_subject OR NEW.request_id!=OLD.request_id
    OR NEW.scope!=OLD.scope OR NEW.input_hash!=OLD.input_hash OR NEW.quote_key!=OLD.quote_key
    OR NEW.price_micros!=OLD.price_micros OR NEW.reserve_micros!=OLD.reserve_micros
    OR NEW.promotional!=OLD.promotional OR NEW.purchased!=OLD.purchased OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
    OR NOT ((OLD.state='pending' AND NEW.state IN ('complete','failed') AND ((NEW.state='complete' AND NEW.result IS NOT NULL) OR (NEW.state='failed' AND NEW.result IS NULL)))
      OR (OLD.state='complete' AND NEW.state='complete' AND NEW.result IS NULL))
    THEN RAISE(ABORT,'brief_transition') END;
END;
CREATE TRIGGER streamlion_brief_return_v1 AFTER UPDATE OF state ON streamlion_brief_jobs_v1 WHEN OLD.state='pending' AND NEW.state='failed' BEGIN
  UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros+OLD.purchased WHERE mode=OLD.mode AND google_subject=OLD.google_subject;
  UPDATE streamlion_promotional_wallets_v1 SET balance_micros=balance_micros+OLD.promotional
    WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND NOT EXISTS(SELECT 1 FROM streamlion_starter_grants_v1 WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND revoked=1);
END;
CREATE TABLE streamlion_brief_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_brief_schema_v1 VALUES(1);
