-- Requires exact 0023. Preserve both closed/default policy rows and all grants.
ALTER TABLE streamlion_free_pilot_policy_v1 ADD COLUMN admission_mode TEXT NOT NULL DEFAULT 'manual' CHECK(admission_mode IN ('manual','instant'));
ALTER TABLE streamlion_free_pilot_policy_v1 ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE streamlion_free_pilot_policy_v1 ADD COLUMN reopen_at INTEGER;
ALTER TABLE streamlion_free_pilot_policy_v1 ADD COLUMN reopen_slots INTEGER NOT NULL DEFAULT 0 CHECK(reopen_slots BETWEEN 0 AND 20);
ALTER TABLE streamlion_free_pilot_policy_v1 ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE streamlion_free_pilot_policy_v1 ADD COLUMN updated_by TEXT NOT NULL DEFAULT 'migration';
ALTER TABLE streamlion_free_pilot_policy_v1 ADD COLUMN update_reason TEXT NOT NULL DEFAULT '' CHECK(length(update_reason)<=500);
CREATE TABLE streamlion_free_pilot_policy_audit_v1 (
 id INTEGER PRIMARY KEY,mode TEXT NOT NULL,revision INTEGER NOT NULL,
 actor TEXT NOT NULL,at INTEGER NOT NULL,reason TEXT NOT NULL,policy TEXT NOT NULL,
 UNIQUE(mode,revision)
);
CREATE TRIGGER streamlion_free_pilot_policy_guard_v1 BEFORE UPDATE ON streamlion_free_pilot_policy_v1 BEGIN
 SELECT CASE WHEN NEW.admission_cap+NEW.reopen_slots>20
  OR (NEW.reopen_at IS NULL AND NEW.reopen_slots!=0)
  OR (NEW.reopen_at IS NOT NULL AND NEW.reopen_slots=0)
  OR NEW.admission_cap<(SELECT COUNT(*) FROM streamlion_free_pilot_accounts_v1 WHERE mode=NEW.mode AND admitted_at IS NOT NULL)
 THEN RAISE(ABORT,'pilot_policy_limits') END;
END;
CREATE TRIGGER streamlion_free_pilot_policy_log_v1 AFTER UPDATE ON streamlion_free_pilot_policy_v1
 WHEN NEW.revision!=OLD.revision BEGIN
 INSERT INTO streamlion_free_pilot_policy_audit_v1(mode,revision,actor,at,reason,policy)
 VALUES(NEW.mode,NEW.revision,NEW.updated_by,NEW.updated_at,NEW.update_reason,
 json_object('interestOpen',NEW.interest_open,'admissionsOpen',NEW.admissions_open,
 'activeCap',NEW.active_cap,'admissionCap',NEW.admission_cap,'durationDays',NEW.duration_days,
 'applicationStart',NEW.application_start,'applicationEnd',NEW.application_end,'closesAt',NEW.closes_at,
 'admissionMode',NEW.admission_mode,'reopenAt',NEW.reopen_at,'reopenSlots',NEW.reopen_slots));
END;
CREATE TABLE streamlion_free_pilot_instant_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_free_pilot_instant_schema_v1 VALUES(1);
