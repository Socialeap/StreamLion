-- Additive, closed by default. No purchase, wallet, Google file or session writes.
CREATE TABLE streamlion_free_pilot_policy_v1 (
 mode TEXT PRIMARY KEY CHECK(mode IN ('test','live')),
 interest_open INTEGER NOT NULL DEFAULT 0 CHECK(interest_open IN (0,1)),
 admissions_open INTEGER NOT NULL DEFAULT 0 CHECK(admissions_open IN (0,1)),
 active_cap INTEGER NOT NULL DEFAULT 5 CHECK(active_cap BETWEEN 1 AND 20),
 admission_cap INTEGER NOT NULL DEFAULT 5 CHECK(admission_cap BETWEEN 1 AND 20),
 duration_days INTEGER NOT NULL DEFAULT 14 CHECK(duration_days IN (7,14)),
 application_start INTEGER, application_end INTEGER, closes_at INTEGER,
 CHECK(admission_cap>=active_cap),
 CHECK(application_start IS NULL OR (application_start<application_end AND application_end<closes_at))
);
INSERT INTO streamlion_free_pilot_policy_v1(mode) VALUES('test'),('live');
CREATE TABLE streamlion_free_pilot_admins_v1 (
 mode TEXT NOT NULL REFERENCES streamlion_free_pilot_policy_v1(mode),
 google_subject TEXT NOT NULL, PRIMARY KEY(mode,google_subject)
);
CREATE TABLE streamlion_free_pilot_accounts_v1 (
 mode TEXT NOT NULL REFERENCES streamlion_free_pilot_policy_v1(mode),
 google_subject TEXT NOT NULL, email TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 business TEXT NOT NULL CHECK(length(business)<=100),
 fit TEXT NOT NULL CHECK(length(fit) BETWEEN 1 AND 500),
 contact INTEGER NOT NULL CHECK(contact=1),
 marketing INTEGER NOT NULL DEFAULT 0 CHECK(marketing IN (0,1)),
 applied_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'applied' CHECK(state IN ('applied','approved','invited','active','revoked')),
 admitted_at INTEGER, invite_until INTEGER, duration_days INTEGER CHECK(duration_days IN (7,14)),
 starts_at INTEGER, ends_at INTEGER, original_end INTEGER, terms TEXT,
 onboarding INTEGER NOT NULL DEFAULT 0 CHECK(onboarding IN (0,1)),
 workflow INTEGER NOT NULL DEFAULT 0 CHECK(workflow IN (0,1)),
 feedback TEXT NOT NULL DEFAULT '' CHECK(length(feedback)<=1000),
 willingness TEXT NOT NULL DEFAULT 'unanswered' CHECK(willingness IN ('unanswered','yes','maybe','no')),
 support TEXT NOT NULL DEFAULT '' CHECK(length(support)<=1000),
 updated_at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason)<=500),
 PRIMARY KEY(mode,google_subject), CHECK(ends_at IS NULL OR starts_at<ends_at)
);
CREATE INDEX streamlion_free_pilot_capacity_v1 ON streamlion_free_pilot_accounts_v1(mode,state,ends_at,invite_until);
CREATE TABLE streamlion_free_pilot_audit_v1 (
 id INTEGER PRIMARY KEY, mode TEXT NOT NULL, google_subject TEXT NOT NULL,
 actor TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL,
 state TEXT NOT NULL, starts_at INTEGER, ends_at INTEGER, reason TEXT NOT NULL
);
CREATE TRIGGER streamlion_free_pilot_insert_audit_v1 AFTER INSERT ON streamlion_free_pilot_accounts_v1 BEGIN
 INSERT INTO streamlion_free_pilot_audit_v1(mode,google_subject,actor,action,at,state,starts_at,ends_at,reason)
 VALUES(NEW.mode,NEW.google_subject,NEW.actor,NEW.action,NEW.updated_at,NEW.state,NEW.starts_at,NEW.ends_at,NEW.reason);
END;
CREATE TRIGGER streamlion_free_pilot_update_audit_v1 AFTER UPDATE ON streamlion_free_pilot_accounts_v1
 WHEN NEW.state!=OLD.state OR NEW.ends_at IS NOT OLD.ends_at BEGIN
 INSERT INTO streamlion_free_pilot_audit_v1(mode,google_subject,actor,action,at,state,starts_at,ends_at,reason)
 VALUES(NEW.mode,NEW.google_subject,NEW.actor,NEW.action,NEW.updated_at,NEW.state,NEW.starts_at,NEW.ends_at,NEW.reason);
END;
CREATE TABLE streamlion_free_pilot_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_free_pilot_schema_v1 VALUES(1);
