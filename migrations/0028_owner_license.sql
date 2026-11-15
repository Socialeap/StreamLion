-- Closed by default. Requires the installed admin and account schemas.
CREATE TABLE streamlion_owner_licenses_v1 (
  mode TEXT NOT NULL CHECK(mode='live'),
  google_subject TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  granted_at INTEGER NOT NULL CHECK(granted_at>0),
  credit_cap_micros INTEGER NOT NULL CHECK(credit_cap_micros BETWEEN 0 AND 10000000 AND credit_cap_micros%12500=0),
  PRIMARY KEY(mode,google_subject)
);
CREATE UNIQUE INDEX streamlion_owner_license_one_active_v1 ON streamlion_owner_licenses_v1(mode) WHERE enabled=1;
CREATE TRIGGER streamlion_owner_license_identity_v1 BEFORE INSERT ON streamlion_owner_licenses_v1 BEGIN
  SELECT CASE WHEN NOT EXISTS(
    SELECT 1 FROM streamlion_admin_owners_v1 o JOIN streamlion_accounts_v1 a USING(google_subject)
    WHERE o.mode=NEW.mode AND o.google_subject=NEW.google_subject AND o.enabled=1
      AND o.email='shakoure@transcendencemedia.com' AND a.email=o.email
  ) THEN RAISE(ABORT,'owner_license_identity') END;
END;
CREATE TRIGGER streamlion_owner_license_immutable_v1 BEFORE UPDATE ON streamlion_owner_licenses_v1
WHEN NEW.mode!=OLD.mode OR NEW.google_subject!=OLD.google_subject OR NEW.granted_at!=OLD.granted_at OR NEW.credit_cap_micros!=OLD.credit_cap_micros BEGIN
  SELECT RAISE(ABORT,'owner_license_immutable');
END;
CREATE TRIGGER streamlion_owner_license_keep_history_v1 BEFORE DELETE ON streamlion_owner_licenses_v1 BEGIN
  SELECT RAISE(ABORT,'owner_license_immutable');
END;
CREATE VIEW streamlion_active_owner_licenses_v1 AS
  SELECT l.mode,l.google_subject,l.credit_cap_micros
  FROM streamlion_owner_licenses_v1 l
  JOIN streamlion_admin_owners_v1 o USING(mode,google_subject)
  JOIN streamlion_accounts_v1 a USING(google_subject)
  WHERE l.enabled=1 AND o.enabled=1 AND o.email='shakoure@transcendencemedia.com' AND a.email=o.email;

-- Use the existing audited goodwill funding path, keeping every existing
-- policy, confirmation, negative-balance and monthly limit in force.
DROP TRIGGER streamlion_admin_grant_guard_v1;
CREATE TRIGGER streamlion_admin_grant_guard_v1 BEFORE INSERT ON streamlion_admin_grants_v1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_admin_policy_v1 p JOIN streamlion_admin_owners_v1 o ON o.mode=p.mode WHERE p.mode=NEW.mode AND p.enabled=1 AND p.grants_enabled=1 AND o.google_subject=NEW.actor AND o.enabled=1) THEN RAISE(ABORT,'admin_disabled') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM streamlion_admin_authorizations_v1 a JOIN streamlion_admin_windows_v1 w ON w.id=a.window_id WHERE a.id=NEW.authorization AND a.actor=NEW.actor AND a.mode=NEW.mode AND a.payload_hash=NEW.payload_hash AND a.operation_id=NEW.id AND a.used=0 AND a.expires_at>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.google_subject=NEW.actor AND w.mode=NEW.mode AND w.last_seen_at+900000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.created_at+3600000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) AND w.verified_at+300000>MAX(NEW.created_at,CAST(unixepoch('subsec')*1000 AS INTEGER))) THEN RAISE(ABORT,'admin_authorization') END;
 SELECT CASE WHEN NEW.amount_micros>(SELECT per_grant_micros FROM streamlion_admin_policy_v1 WHERE mode=NEW.mode) THEN RAISE(ABORT,'admin_grant_cap') END;
 SELECT CASE WHEN (NOT EXISTS(SELECT 1 FROM streamlion_purchases_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND status='paid') AND NOT EXISTS(SELECT 1 FROM streamlion_active_owner_licenses_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject)) OR COALESCE((SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject),0)<0 THEN RAISE(ABORT,'admin_eligibility') END;
 SELECT CASE WHEN EXISTS(
   SELECT 1 FROM streamlion_owner_licenses_v1 l WHERE l.mode=NEW.mode AND l.google_subject=NEW.google_subject
   AND NEW.amount_micros+COALESCE((SELECT SUM(g.amount_micros) FROM streamlion_admin_grants_v1 g
     WHERE g.mode=l.mode AND g.google_subject=l.google_subject),0)>l.credit_cap_micros
 ) THEN RAISE(ABORT,'owner_license_credit_cap') END;
 SELECT CASE WHEN NEW.amount_micros+COALESCE((SELECT SUM(amount_micros) FROM streamlion_admin_grants_v1 WHERE mode=NEW.mode AND google_subject=NEW.google_subject AND month=NEW.month),0)>(SELECT account_month_micros FROM streamlion_admin_policy_v1 WHERE mode=NEW.mode) THEN RAISE(ABORT,'admin_account_cap') END;
 SELECT CASE WHEN NEW.amount_micros+COALESCE((SELECT SUM(amount_micros) FROM streamlion_admin_grants_v1 WHERE mode=NEW.mode AND month=NEW.month),0)>(SELECT month_micros FROM streamlion_admin_policy_v1 WHERE mode=NEW.mode) THEN RAISE(ABORT,'admin_month_cap') END;
END;
CREATE TABLE streamlion_owner_license_schema_v1 (version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_owner_license_schema_v1 VALUES(1);
