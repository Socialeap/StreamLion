-- Requires complete 0001..0008 prerequisite schemas. No live feature is enabled.
CREATE TABLE streamlion_coordination_policy_v1 (
  mode TEXT PRIMARY KEY CHECK(mode IN ('test','live')),
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  project_micros INTEGER NOT NULL DEFAULT 3000000 CHECK(project_micros IN (2000000,3000000)),
  starter_micros INTEGER NOT NULL DEFAULT 7500000 CHECK(starter_micros=7500000)
);
INSERT INTO streamlion_coordination_policy_v1(mode) VALUES('test'),('live');
CREATE TABLE streamlion_coordination_connections_v1 (
  id TEXT PRIMARY KEY, google_subject TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  workbook_id TEXT NOT NULL, folder_id TEXT NOT NULL, credentials TEXT NOT NULL,
  client_brand TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  UNIQUE(mode,google_subject,workbook_id), UNIQUE(workbook_id)
);
CREATE TABLE streamlion_coordination_jobs_v1 (
  id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES streamlion_coordination_connections_v1(id),
  project_id TEXT NOT NULL UNIQUE, client_email TEXT NOT NULL,
  closed_at INTEGER, archive_at INTEGER, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_at INTEGER NOT NULL, reminder_at INTEGER, last_notified_revision INTEGER NOT NULL DEFAULT -1
);
CREATE INDEX streamlion_coordination_deadlines_v1 ON streamlion_coordination_jobs_v1(archive_at,archived);
CREATE TABLE streamlion_coordination_challenges_v1 (
  hash TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES streamlion_coordination_jobs_v1(id),
  expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
);
CREATE TABLE streamlion_coordination_sessions_v1 (
  hash TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES streamlion_coordination_jobs_v1(id),
  expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE TABLE streamlion_coordination_operations_v1 (
  id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, job_id TEXT NOT NULL,
  actor TEXT NOT NULL CHECK(actor IN ('provider','client','system')),
  fingerprint TEXT NOT NULL, payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','failed')),
  created_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE UNIQUE INDEX streamlion_coordination_one_writer_v1
  ON streamlion_coordination_operations_v1(connection_id) WHERE state='pending';
CREATE TABLE streamlion_coordination_outbox_v1 (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, payload TEXT NOT NULL,
  created_at INTEGER NOT NULL, sent_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE streamlion_coordination_rates_v1 (
  key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL
);
CREATE TABLE streamlion_promotional_wallets_v1 (
  mode TEXT NOT NULL, google_subject TEXT NOT NULL, balance_micros INTEGER NOT NULL DEFAULT 0 CHECK(balance_micros>=0),
  PRIMARY KEY(mode,google_subject)
);
CREATE TABLE streamlion_starter_grants_v1 (
  mode TEXT NOT NULL, google_subject TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount=7500000),
  created_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  PRIMARY KEY(mode,google_subject)
);
CREATE TRIGGER streamlion_starter_grant_apply_v1 AFTER INSERT ON streamlion_starter_grants_v1 BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_coordination_policy_v1 WHERE mode=NEW.mode AND active=1)
    OR NOT EXISTS(SELECT 1 FROM streamlion_purchases_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND status='paid')
    THEN RAISE(ABORT,'starter_not_eligible') END;
  INSERT OR IGNORE INTO streamlion_credit_wallets_v1 VALUES(NEW.mode,NEW.google_subject,0);
  INSERT INTO streamlion_promotional_wallets_v1 VALUES(NEW.mode,NEW.google_subject,NEW.amount)
    ON CONFLICT(mode,google_subject) DO UPDATE SET balance_micros=balance_micros+NEW.amount;
END;
CREATE TABLE streamlion_shared_spends_v1 (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')), google_subject TEXT NOT NULL, id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('ai','coordination')), amount INTEGER NOT NULL CHECK(amount>0),
  promotional INTEGER NOT NULL CHECK(promotional>=0), purchased INTEGER NOT NULL CHECK(purchased>=0),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','complete','failed')),
  created_at INTEGER NOT NULL, CHECK(amount=promotional+purchased),
  PRIMARY KEY(mode,google_subject,id)
);
-- An old in-flight AI turn has already debited purchased funds. Do not debit it twice.
INSERT INTO streamlion_shared_spends_v1
  SELECT mode,google_subject,request_id,'ai',price_micros,0,price_micros,'reserved',created_at
  FROM streamlion_credit_turns_v1 WHERE state='reserved';
CREATE TRIGGER streamlion_starter_revoke_v1 AFTER UPDATE OF status ON streamlion_purchases_v1
WHEN NEW.status!='paid' AND NOT EXISTS(SELECT 1 FROM streamlion_purchases_v1
  WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND status='paid') BEGIN
  UPDATE streamlion_starter_grants_v1 SET revoked=1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
  UPDATE streamlion_promotional_wallets_v1 SET balance_micros=0 WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
END;
CREATE TRIGGER streamlion_shared_reserve_v1 BEFORE INSERT ON streamlion_shared_spends_v1 BEGIN
  SELECT CASE WHEN NEW.state!='reserved'
    OR NEW.promotional!=MIN(NEW.amount,COALESCE((SELECT balance_micros FROM streamlion_promotional_wallets_v1
        WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0))
    OR NOT EXISTS(SELECT 1 FROM streamlion_credit_wallets_v1
        WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND balance_micros>=NEW.purchased AND balance_micros>=0)
    OR (NEW.purpose='coordination' AND NOT EXISTS(SELECT 1 FROM streamlion_coordination_policy_v1
        WHERE mode=NEW.mode AND active=1 AND project_micros=NEW.amount))
    OR (NEW.purpose='ai' AND NOT EXISTS(SELECT 1 FROM streamlion_credit_turns_v1
        WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND request_id=NEW.id AND state='reserved' AND price_micros=NEW.amount))
    THEN RAISE(ABORT,'shared_credit_capacity') END;
END;
CREATE TRIGGER streamlion_shared_debit_v1 AFTER INSERT ON streamlion_shared_spends_v1 BEGIN
  UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros-NEW.purchased
    WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
  UPDATE streamlion_promotional_wallets_v1 SET balance_micros=balance_micros-NEW.promotional
    WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
END;
CREATE TRIGGER streamlion_shared_transition_v1 BEFORE UPDATE ON streamlion_shared_spends_v1 BEGIN
  SELECT CASE WHEN OLD.state!='reserved' OR NEW.state NOT IN ('complete','failed')
    OR NEW.mode!=OLD.mode OR NEW.google_subject!=OLD.google_subject OR NEW.id!=OLD.id
    OR NEW.purpose!=OLD.purpose OR NEW.amount!=OLD.amount OR NEW.promotional!=OLD.promotional
    OR NEW.purchased!=OLD.purchased OR NEW.created_at!=OLD.created_at THEN RAISE(ABORT,'shared_credit_transition') END;
END;
CREATE TRIGGER streamlion_shared_return_v1 AFTER UPDATE OF state ON streamlion_shared_spends_v1 WHEN NEW.state='failed' BEGIN
  UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros+OLD.purchased
    WHERE mode=OLD.mode AND google_subject=OLD.google_subject;
  UPDATE streamlion_promotional_wallets_v1 SET balance_micros=balance_micros+OLD.promotional
    WHERE mode=OLD.mode AND google_subject=OLD.google_subject
      AND NOT EXISTS(SELECT 1 FROM streamlion_starter_grants_v1
        WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND revoked=1);
END;
-- Preserve model-request budget checks; extend the available funds to promotional credits.
DROP TRIGGER streamlion_credit_reserve_v1;
CREATE TRIGGER streamlion_credit_reserve_v1 BEFORE INSERT ON streamlion_credit_turns_v1 BEGIN
  SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS(
    SELECT 1 FROM streamlion_credit_policy_v1 p JOIN streamlion_credit_wallets_v1 w
      ON w.mode=p.mode AND w.google_subject=NEW.google_subject WHERE p.mode=NEW.mode AND p.active=1
      AND p.cost_micros>=NEW.reserve_micros AND NEW.price_micros=(p.cost_micros*130+99)/100
      AND w.balance_micros>=0 AND w.balance_micros+COALESCE((SELECT balance_micros FROM streamlion_promotional_wallets_v1
        WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)>=NEW.price_micros
      AND NOT EXISTS(SELECT 1 FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND state='reserved')
      AND (SELECT COUNT(*) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND created_at>NEW.created_at-60000)<6
      AND (SELECT COUNT(*) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)<p.daily_requests
      AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)+NEW.reserve_micros<=p.daily_budget_micros
      AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode)+NEW.reserve_micros<=p.total_budget_micros
  ) THEN RAISE(ABORT,'credit_capacity') END;
END;
DROP TRIGGER streamlion_credit_debit_v1;
CREATE TRIGGER streamlion_credit_debit_v1 AFTER INSERT ON streamlion_credit_turns_v1 BEGIN
  INSERT INTO streamlion_shared_spends_v1
  SELECT NEW.mode,NEW.google_subject,NEW.request_id,'ai',NEW.price_micros,
    MIN(NEW.price_micros,COALESCE(p.balance_micros,0)),
    NEW.price_micros-MIN(NEW.price_micros,COALESCE(p.balance_micros,0)),'reserved',NEW.created_at
  FROM streamlion_credit_wallets_v1 w LEFT JOIN streamlion_promotional_wallets_v1 p
    ON p.mode=w.mode AND p.google_subject=w.google_subject
  WHERE w.mode=NEW.mode AND w.google_subject=NEW.google_subject;
END;
DROP TRIGGER streamlion_credit_return_v1;
CREATE TRIGGER streamlion_credit_return_v1 AFTER UPDATE OF state ON streamlion_credit_turns_v1 BEGIN
  UPDATE streamlion_shared_spends_v1 SET state=NEW.state
    WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND id=OLD.request_id AND state='reserved';
END;
CREATE TABLE streamlion_coordination_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_coordination_schema_v1 VALUES(1);
