-- Admin portal v1. Closed by default; no owner enrollment, provider activation or external call.
-- Requires exact migrations 0009, 0022, 0024. Apply only via committed preflight.
CREATE TABLE streamlion_admin_policy_v1 (
 mode TEXT PRIMARY KEY CHECK(mode IN ('test','live')), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 grants_enabled INTEGER NOT NULL DEFAULT 0 CHECK(grants_enabled IN(0,1)),
 per_grant_micros INTEGER NOT NULL DEFAULT 10000000 CHECK(per_grant_micros BETWEEN 12500 AND 10000000),
 account_month_micros INTEGER NOT NULL DEFAULT 10000000 CHECK(account_month_micros BETWEEN 12500 AND 10000000),
 month_micros INTEGER NOT NULL DEFAULT 50000000 CHECK(month_micros BETWEEN 12500 AND 50000000)
);
INSERT INTO streamlion_admin_policy_v1(mode) VALUES('test'),('live');
CREATE TABLE streamlion_admin_owners_v1 (
 mode TEXT NOT NULL REFERENCES streamlion_admin_policy_v1(mode), google_subject TEXT NOT NULL,
 email TEXT NOT NULL CHECK(email='shakoure@transcendencemedia.com'), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
 PRIMARY KEY(mode,google_subject)
);
CREATE UNIQUE INDEX streamlion_admin_one_owner_v1 ON streamlion_admin_owners_v1(mode) WHERE enabled=1;
CREATE TABLE streamlion_admin_windows_v1 (
 id TEXT PRIMARY KEY, google_subject TEXT NOT NULL, mode TEXT NOT NULL,
 created_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,verified_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE streamlion_admin_authorizations_v1 (
 id TEXT PRIMARY KEY,mode TEXT NOT NULL,actor TEXT NOT NULL,window_id TEXT NOT NULL REFERENCES streamlion_admin_windows_v1(id),
 payload_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0 CHECK(used IN(0,1)),operation_id TEXT NOT NULL
);
CREATE INDEX streamlion_admin_authorization_operation_v1 ON streamlion_admin_authorizations_v1(mode,actor,operation_id);
CREATE TABLE streamlion_admin_grants_v1 (
 id TEXT PRIMARY KEY,mode TEXT NOT NULL REFERENCES streamlion_admin_policy_v1(mode),google_subject TEXT NOT NULL,actor TEXT NOT NULL,
 amount_micros INTEGER NOT NULL CHECK(typeof(amount_micros)='integer' AND amount_micros>0 AND amount_micros%12500=0),
 month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),created_at INTEGER NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),authorization TEXT NOT NULL,payload_hash TEXT NOT NULL,version INTEGER NOT NULL CHECK(version=1)
);
CREATE INDEX streamlion_admin_grant_month_v1 ON streamlion_admin_grants_v1(mode,month,google_subject,amount_micros);
CREATE INDEX streamlion_admin_grant_target_v1 ON streamlion_admin_grants_v1(mode,google_subject,created_at,id);
CREATE TABLE streamlion_admin_grant_balances_v1 (
 grant_id TEXT PRIMARY KEY REFERENCES streamlion_admin_grants_v1(id),remaining_micros INTEGER NOT NULL CHECK(typeof(remaining_micros)='integer' AND remaining_micros>=0)
);
CREATE TABLE streamlion_admin_reversals_v1 (
 id TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES streamlion_admin_grants_v1(id),actor TEXT NOT NULL,
 amount_micros INTEGER NOT NULL CHECK(typeof(amount_micros)='integer' AND amount_micros>0),reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 created_at INTEGER NOT NULL,authorization TEXT NOT NULL,payload_hash TEXT NOT NULL,version INTEGER NOT NULL CHECK(version=1)
);
CREATE TABLE streamlion_admin_audit_v1 (
 id TEXT PRIMARY KEY,mode TEXT NOT NULL,actor TEXT NOT NULL,target TEXT NOT NULL,action TEXT NOT NULL,
 amount_micros INTEGER NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,reference TEXT NOT NULL,
 balance_before INTEGER NOT NULL,balance_after INTEGER NOT NULL
);
CREATE INDEX streamlion_admin_audit_target_v1 ON streamlion_admin_audit_v1(mode,target,created_at,id);
CREATE TABLE streamlion_accounts_v1 (
 google_subject TEXT PRIMARY KEY,email TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',business TEXT NOT NULL DEFAULT '',
 first_known_at INTEGER NOT NULL,signup_at INTEGER,last_signin_at INTEGER,name_source TEXT NOT NULL DEFAULT 'unknown',first_known_source TEXT NOT NULL
);
CREATE INDEX streamlion_accounts_first_v1 ON streamlion_accounts_v1(first_known_at,google_subject);
CREATE INDEX streamlion_accounts_email_v1 ON streamlion_accounts_v1(email COLLATE NOCASE);
CREATE TABLE streamlion_account_activity_v1 (
 mode TEXT NOT NULL,google_subject TEXT NOT NULL,last_active_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(mode,google_subject)
);
CREATE INDEX streamlion_admin_active_v1 ON streamlion_account_activity_v1(mode,last_active_at DESC,google_subject ASC);
CREATE TABLE streamlion_account_days_v1 (
 mode TEXT NOT NULL,google_subject TEXT NOT NULL,reporting_date TEXT NOT NULL,first_received_at INTEGER NOT NULL,last_received_at INTEGER NOT NULL,
 PRIMARY KEY(mode,google_subject,reporting_date)
);
CREATE INDEX streamlion_admin_day_v1 ON streamlion_account_days_v1(mode,reporting_date,google_subject);
CREATE TABLE streamlion_admin_payment_times_v1 (kind TEXT NOT NULL,order_id TEXT NOT NULL,paid_at INTEGER NOT NULL,PRIMARY KEY(kind,order_id));
CREATE TRIGGER streamlion_admin_core_paid_v1 AFTER UPDATE OF status ON streamlion_purchases_v1 WHEN NEW.status='paid' AND OLD.status!='paid' BEGIN
 INSERT OR IGNORE INTO streamlion_admin_payment_times_v1 VALUES('core',NEW.order_id,NEW.updated_at);
END;
CREATE TRIGGER streamlion_admin_credit_paid_v1 AFTER UPDATE OF status ON streamlion_credit_orders_v1 WHEN NEW.status='paid' AND OLD.status!='paid' BEGIN
 INSERT OR IGNORE INTO streamlion_admin_payment_times_v1 VALUES('credits',NEW.order_id,NEW.updated_at);
END;
CREATE TABLE streamlion_spend_funding_v1 (
 mode TEXT NOT NULL,google_subject TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('ai','coordination','speech')),request_id TEXT NOT NULL,
 starter INTEGER NOT NULL CHECK(starter>=0),goodwill INTEGER NOT NULL CHECK(goodwill>=0),purchased INTEGER NOT NULL CHECK(purchased>=0),
 state TEXT NOT NULL CHECK(state IN('reserved','complete','failed')),created_at INTEGER NOT NULL,PRIMARY KEY(mode,google_subject,kind,request_id)
);
-- Preserve existing reservations: their wallets were already debited. No trigger yet.
INSERT INTO streamlion_spend_funding_v1 SELECT mode,google_subject,purpose,id,promotional,0,purchased,state,created_at FROM streamlion_shared_spends_v1 WHERE state='reserved';
INSERT INTO streamlion_spend_funding_v1 SELECT mode,google_subject,'speech',request_id,0,0,price_micros,state,created_at FROM streamlion_speech_turns_v1 WHERE state='reserved';
CREATE TABLE streamlion_goodwill_allocations_v1 (
 mode TEXT NOT NULL,google_subject TEXT NOT NULL,kind TEXT NOT NULL,request_id TEXT NOT NULL,
 grant_id TEXT NOT NULL REFERENCES streamlion_admin_grants_v1(id),amount_micros INTEGER NOT NULL CHECK(amount_micros>0),
 state TEXT NOT NULL CHECK(state IN('reserved','complete','failed')),PRIMARY KEY(mode,google_subject,kind,request_id,grant_id)
);
CREATE VIEW streamlion_goodwill_available_v1 AS SELECT g.mode,g.google_subject,COALESCE(SUM(b.remaining_micros),0) balance_micros
 FROM streamlion_admin_grants_v1 g JOIN streamlion_admin_grant_balances_v1 b ON b.grant_id=g.id GROUP BY g.mode,g.google_subject;
CREATE TRIGGER streamlion_admin_grant_guard_v1 BEFORE INSERT ON streamlion_admin_grants_v1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_admin_policy_v1 p JOIN streamlion_admin_owners_v1 o ON o.mode=p.mode WHERE p.mode=NEW.mode AND p.enabled=1 AND p.grants_enabled=1 AND o.google_subject=NEW.actor AND o.enabled=1) THEN RAISE(ABORT,'admin_disabled') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_admin_authorizations_v1 a JOIN streamlion_admin_windows_v1 w ON w.id=a.window_id WHERE a.id=NEW.authorization AND a.actor=NEW.actor AND a.mode=NEW.mode AND a.payload_hash=NEW.payload_hash AND a.operation_id=NEW.id AND a.used=0 AND a.expires_at>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.google_subject=NEW.actor AND w.mode=NEW.mode AND w.last_seen_at+900000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.created_at+3600000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.verified_at+300000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER))) THEN RAISE(ABORT,'admin_authorization') END;
 SELECT CASE WHEN NEW.amount_micros>(SELECT per_grant_micros FROM streamlion_admin_policy_v1 WHERE mode=NEW.mode) THEN RAISE(ABORT,'admin_grant_cap') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_purchases_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND status='paid') OR COALESCE((SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)<0 THEN RAISE(ABORT,'admin_eligibility') END;
 SELECT CASE WHEN NEW.amount_micros+COALESCE((SELECT SUM(amount_micros) FROM streamlion_admin_grants_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND month=NEW.month),0)>(SELECT account_month_micros FROM streamlion_admin_policy_v1 WHERE mode=NEW.mode) THEN RAISE(ABORT,'admin_account_cap') END;
 SELECT CASE WHEN NEW.amount_micros+COALESCE((SELECT SUM(amount_micros) FROM streamlion_admin_grants_v1 WHERE mode=NEW.mode AND month=NEW.month),0)>(SELECT month_micros FROM streamlion_admin_policy_v1 WHERE mode=NEW.mode) THEN RAISE(ABORT,'admin_month_cap') END;
END;
CREATE TRIGGER streamlion_admin_grant_apply_v1 AFTER INSERT ON streamlion_admin_grants_v1 BEGIN
 INSERT INTO streamlion_admin_grant_balances_v1 VALUES(NEW.id,NEW.amount_micros);
 INSERT OR IGNORE INTO streamlion_credit_wallets_v1 VALUES(NEW.mode,NEW.google_subject,0);
 UPDATE streamlion_admin_authorizations_v1 SET used=1 WHERE id=NEW.authorization;
 INSERT INTO streamlion_admin_audit_v1 SELECT 'grant:'||NEW.id,NEW.mode,NEW.actor,NEW.google_subject,'grant',NEW.amount_micros,NEW.reason,NEW.created_at,NEW.id,balance_micros-NEW.amount_micros,balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
END;
CREATE TRIGGER streamlion_admin_reversal_guard_v1 BEFORE INSERT ON streamlion_admin_reversals_v1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_admin_grants_v1 g JOIN streamlion_admin_policy_v1 p ON p.mode=g.mode JOIN streamlion_admin_owners_v1 o ON o.mode=g.mode WHERE g.id=NEW.grant_id AND o.google_subject=NEW.actor AND o.enabled=1 AND p.enabled=1 AND p.grants_enabled=1) THEN RAISE(ABORT,'admin_disabled') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_admin_authorizations_v1 a JOIN streamlion_admin_windows_v1 w ON w.id=a.window_id JOIN streamlion_admin_grants_v1 g ON g.mode=a.mode WHERE g.id=NEW.grant_id AND a.id=NEW.authorization AND a.actor=NEW.actor AND a.payload_hash=NEW.payload_hash AND a.operation_id=NEW.id AND a.used=0 AND a.expires_at>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.google_subject=NEW.actor AND w.mode=a.mode AND w.last_seen_at+900000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.created_at+3600000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.verified_at+300000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER))) THEN RAISE(ABORT,'admin_authorization') END;
 SELECT CASE WHEN NEW.amount_micros>COALESCE((SELECT remaining_micros FROM streamlion_admin_grant_balances_v1 WHERE grant_id=NEW.grant_id),0) THEN RAISE(ABORT,'admin_reversal_balance') END;
END;
CREATE TRIGGER streamlion_admin_reversal_apply_v1 AFTER INSERT ON streamlion_admin_reversals_v1 BEGIN
 UPDATE streamlion_admin_grant_balances_v1 SET remaining_micros=remaining_micros-NEW.amount_micros WHERE grant_id=NEW.grant_id;
 UPDATE streamlion_admin_authorizations_v1 SET used=1 WHERE id=NEW.authorization;
 INSERT INTO streamlion_admin_audit_v1 SELECT 'reverse:'||NEW.id,g.mode,NEW.actor,g.google_subject,'reversal',-NEW.amount_micros,NEW.reason,NEW.created_at,g.id,a.balance_micros+NEW.amount_micros,a.balance_micros FROM streamlion_admin_grants_v1 g JOIN streamlion_goodwill_available_v1 a ON a.mode=g.mode AND a.google_subject=g.google_subject WHERE g.id=NEW.grant_id;
END;
CREATE TRIGGER streamlion_admin_grants_v1_update BEFORE UPDATE ON streamlion_admin_grants_v1 BEGIN SELECT RAISE(ABORT,'admin_immutable'); END;
CREATE TRIGGER streamlion_admin_grants_v1_delete BEFORE DELETE ON streamlion_admin_grants_v1 BEGIN SELECT RAISE(ABORT,'admin_immutable'); END;
CREATE TRIGGER streamlion_admin_reversals_v1_update BEFORE UPDATE ON streamlion_admin_reversals_v1 BEGIN SELECT RAISE(ABORT,'admin_immutable'); END;
CREATE TRIGGER streamlion_admin_reversals_v1_delete BEFORE DELETE ON streamlion_admin_reversals_v1 BEGIN SELECT RAISE(ABORT,'admin_immutable'); END;
CREATE TRIGGER streamlion_admin_audit_v1_update BEFORE UPDATE ON streamlion_admin_audit_v1 BEGIN SELECT RAISE(ABORT,'admin_immutable'); END;
CREATE TRIGGER streamlion_admin_audit_v1_delete BEFORE DELETE ON streamlion_admin_audit_v1 BEGIN SELECT RAISE(ABORT,'admin_immutable'); END;
CREATE TRIGGER streamlion_goodwill_allocation_guard_v1 BEFORE INSERT ON streamlion_goodwill_allocations_v1 BEGIN
 SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS(SELECT 1 FROM streamlion_admin_grants_v1 g JOIN streamlion_admin_grant_balances_v1 b ON b.grant_id=g.id WHERE g.id=NEW.grant_id AND g.mode=NEW.mode AND g.google_subject=NEW.google_subject AND b.remaining_micros>=NEW.amount_micros) THEN RAISE(ABORT,'goodwill_allocation') END;
END;
CREATE TRIGGER streamlion_goodwill_allocation_debit_v1 AFTER INSERT ON streamlion_goodwill_allocations_v1 BEGIN
 UPDATE streamlion_admin_grant_balances_v1 SET remaining_micros=remaining_micros-NEW.amount_micros WHERE grant_id=NEW.grant_id;
END;
CREATE TRIGGER streamlion_goodwill_allocation_transition_v1 BEFORE UPDATE ON streamlion_goodwill_allocations_v1 BEGIN
 SELECT CASE WHEN OLD.state!='reserved' OR NEW.state NOT IN('complete','failed') OR NEW.mode!=OLD.mode OR NEW.google_subject!=OLD.google_subject OR NEW.kind!=OLD.kind OR NEW.request_id!=OLD.request_id OR NEW.grant_id!=OLD.grant_id OR NEW.amount_micros!=OLD.amount_micros THEN RAISE(ABORT,'goodwill_transition') END;
END;
CREATE TRIGGER streamlion_goodwill_allocation_restore_v1 AFTER UPDATE OF state ON streamlion_goodwill_allocations_v1 WHEN NEW.state='failed' BEGIN
 UPDATE streamlion_admin_grant_balances_v1 SET remaining_micros=remaining_micros+OLD.amount_micros WHERE grant_id=OLD.grant_id;
END;
CREATE TRIGGER streamlion_funding_guard_v1 BEFORE INSERT ON streamlion_spend_funding_v1 BEGIN
 SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS(SELECT 1 FROM streamlion_credit_wallets_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND balance_micros>=0 AND balance_micros>=NEW.purchased)
 OR NEW.starter>COALESCE((SELECT balance_micros FROM streamlion_promotional_wallets_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)
 OR NEW.goodwill>COALESCE((SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)
 OR (NEW.kind='speech' AND NEW.starter!=0) THEN RAISE(ABORT,'funding_capacity') END;
END;
CREATE TRIGGER streamlion_funding_debit_v1 AFTER INSERT ON streamlion_spend_funding_v1 BEGIN
 UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros-NEW.purchased WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
 UPDATE streamlion_promotional_wallets_v1 SET balance_micros=balance_micros-NEW.starter WHERE mode=NEW.mode AND google_subject=NEW.google_subject;
 INSERT INTO streamlion_goodwill_allocations_v1
 SELECT NEW.mode,NEW.google_subject,NEW.kind,NEW.request_id,id,MIN(remaining_micros,MAX(0,NEW.goodwill-prior)),'reserved'
 FROM (SELECT g.id,b.remaining_micros,COALESCE(SUM(b.remaining_micros) OVER(ORDER BY g.created_at,g.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) prior FROM streamlion_admin_grants_v1 g JOIN streamlion_admin_grant_balances_v1 b ON b.grant_id=g.id WHERE g.mode=NEW.mode AND g.google_subject=NEW.google_subject AND b.remaining_micros>0)
 WHERE NEW.goodwill>prior;
 SELECT CASE WHEN COALESCE((SELECT SUM(amount_micros) FROM streamlion_goodwill_allocations_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND kind=NEW.kind AND request_id=NEW.request_id),0)!=NEW.goodwill THEN RAISE(ABORT,'funding_incomplete') END;
END;
CREATE TRIGGER streamlion_funding_transition_v1 BEFORE UPDATE ON streamlion_spend_funding_v1 BEGIN
 SELECT CASE WHEN OLD.state!='reserved' OR NEW.state NOT IN('complete','failed') OR NEW.mode!=OLD.mode OR NEW.google_subject!=OLD.google_subject OR NEW.kind!=OLD.kind OR NEW.request_id!=OLD.request_id OR NEW.starter!=OLD.starter OR NEW.goodwill!=OLD.goodwill OR NEW.purchased!=OLD.purchased OR NEW.created_at!=OLD.created_at THEN RAISE(ABORT,'funding_transition') END;
END;
CREATE TRIGGER streamlion_funding_finish_v1 AFTER UPDATE OF state ON streamlion_spend_funding_v1 BEGIN
 UPDATE streamlion_goodwill_allocations_v1 SET state=NEW.state WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND kind=OLD.kind AND request_id=OLD.request_id AND state='reserved';
 UPDATE streamlion_credit_wallets_v1 SET balance_micros=balance_micros+OLD.purchased WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND NEW.state='failed';
 UPDATE streamlion_promotional_wallets_v1 SET balance_micros=balance_micros+OLD.starter WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND NEW.state='failed' AND NOT EXISTS(SELECT 1 FROM streamlion_starter_grants_v1 WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND revoked=1);
END;
DROP TRIGGER streamlion_shared_reserve_v1;
CREATE TRIGGER streamlion_shared_reserve_v1 BEFORE INSERT ON streamlion_shared_spends_v1 BEGIN
  SELECT CASE WHEN NEW.state!='reserved'
    OR NEW.promotional!=MIN(NEW.amount,(COALESCE((SELECT balance_micros FROM streamlion_promotional_wallets_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)+COALESCE((SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)))
    OR NOT EXISTS(SELECT 1 FROM streamlion_credit_wallets_v1
        WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND balance_micros>=NEW.purchased AND balance_micros>=0)
    OR (NEW.purpose='coordination' AND NOT EXISTS(SELECT 1 FROM streamlion_coordination_policy_v1
        WHERE mode=NEW.mode AND active=1 AND project_micros=NEW.amount))
    OR (NEW.purpose='ai' AND NOT EXISTS(SELECT 1 FROM streamlion_credit_turns_v1
        WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND request_id=NEW.id AND state='reserved' AND price_micros=NEW.amount))
    THEN RAISE(ABORT,'shared_credit_capacity') END;
END;
DROP TRIGGER streamlion_shared_debit_v1;
CREATE TRIGGER streamlion_shared_debit_v1 AFTER INSERT ON streamlion_shared_spends_v1 BEGIN
 INSERT INTO streamlion_spend_funding_v1 SELECT NEW.mode,NEW.google_subject,NEW.purpose,NEW.id,MIN(NEW.promotional,COALESCE(p.balance_micros,0)),NEW.promotional-MIN(NEW.promotional,COALESCE(p.balance_micros,0)),NEW.purchased,'reserved',NEW.created_at FROM streamlion_credit_wallets_v1 w LEFT JOIN streamlion_promotional_wallets_v1 p ON p.mode=w.mode AND p.google_subject=w.google_subject WHERE w.mode=NEW.mode AND w.google_subject=NEW.google_subject;
END;
DROP TRIGGER streamlion_shared_return_v1;
CREATE TRIGGER streamlion_shared_return_v1 AFTER UPDATE OF state ON streamlion_shared_spends_v1 BEGIN
 UPDATE streamlion_spend_funding_v1 SET state=NEW.state WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND kind=OLD.purpose AND request_id=OLD.id AND state='reserved';
END;
DROP TRIGGER streamlion_credit_reserve_v1;
CREATE TRIGGER streamlion_credit_reserve_v1 BEFORE INSERT ON streamlion_credit_turns_v1 BEGIN
  SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS(
    SELECT 1 FROM streamlion_credit_policy_v1 p JOIN streamlion_credit_wallets_v1 w
      ON w.mode=p.mode AND w.google_subject=NEW.google_subject WHERE p.mode=NEW.mode AND p.active=1
      AND p.cost_micros>=NEW.reserve_micros AND NEW.price_micros=(p.cost_micros*130+99)/100
      AND w.balance_micros>=0 AND w.balance_micros+(COALESCE((SELECT balance_micros FROM streamlion_promotional_wallets_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)+COALESCE((SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0))>=NEW.price_micros
      AND NOT EXISTS(SELECT 1 FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND state='reserved')
      AND (SELECT COUNT(*) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND created_at>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER))-60000)<6
      AND (SELECT COUNT(*) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)<p.daily_requests
      AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)+NEW.reserve_micros<=p.daily_budget_micros
      AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_credit_turns_v1 WHERE mode=NEW.mode)+NEW.reserve_micros<=p.total_budget_micros
  ) THEN RAISE(ABORT,'credit_capacity') END;
END;
DROP TRIGGER streamlion_credit_debit_v1;
CREATE TRIGGER streamlion_credit_debit_v1 AFTER INSERT ON streamlion_credit_turns_v1 BEGIN
  INSERT INTO streamlion_shared_spends_v1
  SELECT NEW.mode,NEW.google_subject,NEW.request_id,'ai',NEW.price_micros,
    MIN(NEW.price_micros,(COALESCE(p.balance_micros,0)+COALESCE((SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0))),
    NEW.price_micros-MIN(NEW.price_micros,(COALESCE(p.balance_micros,0)+COALESCE((SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0))),'reserved',NEW.created_at
  FROM streamlion_credit_wallets_v1 w LEFT JOIN streamlion_promotional_wallets_v1 p
    ON p.mode=w.mode AND p.google_subject=w.google_subject
  WHERE w.mode=NEW.mode AND w.google_subject=NEW.google_subject;
END;
DROP TRIGGER streamlion_speech_reserve_v2;
CREATE TRIGGER streamlion_speech_reserve_v2 BEFORE INSERT ON streamlion_speech_turns_v1 BEGIN
 SELECT CASE WHEN NEW.state!='reserved' OR NOT EXISTS (
  SELECT 1 FROM streamlion_speech_policy_v1 p JOIN streamlion_credit_wallets_v1 w
  ON w.mode=p.mode AND w.google_subject=NEW.google_subject
  WHERE p.mode=NEW.mode AND p.active=1 AND p.cost_micros>0 AND p.cost_micros=NEW.reserve_micros
  AND NEW.price_micros=p.price_micros AND p.price_micros=12500 AND w.balance_micros>=0 AND w.balance_micros+COALESCE((SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)>=NEW.price_micros
  AND (SELECT COUNT(*) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND created_at>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER))-60000)<3
  AND (SELECT COUNT(*) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)<p.daily_requests
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode AND created_at>=NEW.created_at-NEW.created_at%86400000)+NEW.reserve_micros<=p.daily_budget_micros
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_speech_turns_v1 WHERE mode=NEW.mode)+NEW.reserve_micros<=p.total_budget_micros
 ) THEN RAISE(ABORT,'speech_capacity') END;
END;
DROP TRIGGER streamlion_speech_debit_v1;
CREATE TRIGGER streamlion_speech_debit_v1 AFTER INSERT ON streamlion_speech_turns_v1 BEGIN
 INSERT INTO streamlion_spend_funding_v1 SELECT NEW.mode,NEW.google_subject,'speech',NEW.request_id,0,MIN(NEW.price_micros,COALESCE(g.balance_micros,0)),NEW.price_micros-MIN(NEW.price_micros,COALESCE(g.balance_micros,0)),'reserved',NEW.created_at FROM streamlion_credit_wallets_v1 w LEFT JOIN streamlion_goodwill_available_v1 g ON g.mode=w.mode AND g.google_subject=w.google_subject WHERE w.mode=NEW.mode AND w.google_subject=NEW.google_subject;
END;
DROP TRIGGER streamlion_speech_refund_v1;
CREATE TRIGGER streamlion_speech_refund_v1 AFTER UPDATE OF state ON streamlion_speech_turns_v1 BEGIN
 UPDATE streamlion_spend_funding_v1 SET state=NEW.state WHERE mode=OLD.mode AND google_subject=OLD.google_subject AND kind='speech' AND request_id=OLD.request_id AND state='reserved';
END;
CREATE TRIGGER streamlion_admin_starter_revoked_v1 AFTER UPDATE OF balance_micros ON streamlion_promotional_wallets_v1 WHEN NEW.balance_micros=0 AND OLD.balance_micros>0 AND EXISTS(SELECT 1 FROM streamlion_starter_grants_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND revoked=1) AND NOT EXISTS(SELECT 1 FROM streamlion_purchases_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND status='paid') BEGIN
 INSERT INTO streamlion_admin_audit_v1 VALUES('starter:'||NEW.mode||':'||NEW.google_subject||':'||CAST(unixepoch('subsec')*1000 AS INTEGER),NEW.mode,'system',NEW.google_subject,'starter_revoked',-OLD.balance_micros,'Core access revoked',CAST(unixepoch('subsec')*1000 AS INTEGER),'starter',OLD.balance_micros,0);
END;
-- Retained evidence establishes first-known dates, never reconstructed signup dates.
INSERT OR IGNORE INTO streamlion_accounts_v1(google_subject,email,first_known_at,first_known_source)
 SELECT google_subject,MAX(email),MIN(at),'retained_operational_evidence' FROM (
 SELECT google_subject,checkout_email email,created_at at FROM streamlion_purchases_v1
 UNION ALL SELECT google_subject,checkout_email,created_at FROM streamlion_credit_orders_v1
 UNION ALL SELECT google_subject,email,applied_at FROM streamlion_free_pilot_accounts_v1
 UNION ALL SELECT google_subject,email,CAST(unixepoch('subsec')*1000 AS INTEGER) FROM streamlion_google_sessions_v1
 ) GROUP BY google_subject;
INSERT OR IGNORE INTO streamlion_account_activity_v1 SELECT mode,google_subject,0 FROM streamlion_purchases_v1;
INSERT OR IGNORE INTO streamlion_account_activity_v1 SELECT mode,google_subject,0 FROM streamlion_credit_orders_v1;
INSERT OR IGNORE INTO streamlion_account_activity_v1 SELECT mode,google_subject,0 FROM streamlion_free_pilot_accounts_v1;
CREATE INDEX streamlion_admin_allocation_grant_v1 ON streamlion_goodwill_allocations_v1(grant_id,state);
CREATE INDEX streamlion_admin_shared_time_v1 ON streamlion_shared_spends_v1(mode,created_at);
CREATE TABLE streamlion_admin_metadata_v1(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
INSERT INTO streamlion_admin_metadata_v1 VALUES('tracking_since',CAST(unixepoch('subsec')*1000 AS INTEGER));
CREATE TABLE streamlion_admin_operator_requests_v1 (
 id TEXT PRIMARY KEY,action TEXT NOT NULL CHECK(action IN('bootstrap','recover')),mode TEXT NOT NULL REFERENCES streamlion_admin_policy_v1(mode),
 google_subject TEXT NOT NULL,prior_subject TEXT,main_sha TEXT NOT NULL CHECK(length(main_sha)=40 AND main_sha NOT GLOB '*[^0-9a-f]*'),created_at INTEGER NOT NULL
);
CREATE TRIGGER streamlion_admin_operator_guard_v1 BEFORE INSERT ON streamlion_admin_operator_requests_v1 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM streamlion_admin_operator_requests_v1 o WHERE o.id=NEW.id AND (o.action!=NEW.action OR o.mode!=NEW.mode OR o.google_subject!=NEW.google_subject OR COALESCE(o.prior_subject,'')!=COALESCE(NEW.prior_subject,'') OR o.main_sha!=NEW.main_sha)) THEN RAISE(ABORT,'admin_operator_replay') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM streamlion_admin_operator_requests_v1 WHERE id=NEW.id) THEN RAISE(IGNORE) END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_accounts_v1 u JOIN streamlion_google_sessions_v1 s ON s.google_subject=u.google_subject WHERE u.google_subject=NEW.google_subject AND u.email='shakoure@transcendencemedia.com' AND s.email=u.email AND s.expires_at>NEW.created_at) THEN RAISE(ABORT,'admin_operator_identity') END;
 SELECT CASE WHEN (NEW.action='bootstrap' AND EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 WHERE mode=NEW.mode AND enabled=1)) OR (NEW.action='recover' AND (NEW.google_subject=NEW.prior_subject OR NOT EXISTS(SELECT 1 FROM streamlion_admin_owners_v1 WHERE mode=NEW.mode AND google_subject=NEW.prior_subject AND enabled=1))) THEN RAISE(ABORT,'admin_operator_prior_owner') END;
END;
CREATE TRIGGER streamlion_admin_operator_apply_v1 AFTER INSERT ON streamlion_admin_operator_requests_v1 BEGIN
 UPDATE streamlion_admin_owners_v1 SET enabled=0 WHERE NEW.action='recover' AND mode=NEW.mode AND google_subject=NEW.prior_subject;
 INSERT INTO streamlion_admin_owners_v1 VALUES(NEW.mode,NEW.google_subject,'shakoure@transcendencemedia.com',1) ON CONFLICT(mode,google_subject) DO UPDATE SET enabled=1;
 UPDATE streamlion_admin_policy_v1 SET enabled=1,grants_enabled=0 WHERE mode=NEW.mode;
 DELETE FROM streamlion_admin_authorizations_v1 WHERE window_id IN(SELECT id FROM streamlion_admin_windows_v1 WHERE mode=NEW.mode AND google_subject=NEW.prior_subject);
 DELETE FROM streamlion_admin_windows_v1 WHERE NEW.action='recover' AND mode=NEW.mode AND google_subject=NEW.prior_subject;
 INSERT INTO streamlion_admin_audit_v1 VALUES('operator:'||NEW.id,NEW.mode,'operator',NEW.google_subject,NEW.action,0,'Owner-authorized main '||NEW.main_sha,NEW.created_at,COALESCE(NEW.prior_subject,NEW.google_subject),0,0);
END;
CREATE TRIGGER streamlion_admin_operator_immutable_update_v1 BEFORE UPDATE ON streamlion_admin_operator_requests_v1 BEGIN SELECT RAISE(ABORT,'admin_immutable'); END;
CREATE TRIGGER streamlion_admin_operator_immutable_delete_v1 BEFORE DELETE ON streamlion_admin_operator_requests_v1 BEGIN SELECT RAISE(ABORT,'admin_immutable'); END;
CREATE TABLE streamlion_admin_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_admin_schema_v1 VALUES(1);
