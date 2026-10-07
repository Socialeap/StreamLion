-- Operational metadata only. No content cache, credit change, deletion or feature activation.
CREATE TABLE streamlion_coordination_changes_v1 (
  connection_id TEXT NOT NULL, job_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation>0),
  PRIMARY KEY(connection_id,job_id)
);
CREATE TABLE streamlion_coordination_reads_v1 (
  connection_id TEXT NOT NULL, job_id TEXT NOT NULL,
  marker TEXT NOT NULL, token TEXT NOT NULL, verified_at INTEGER NOT NULL, row_counts TEXT NOT NULL,
  PRIMARY KEY(connection_id,job_id)
);
CREATE TRIGGER streamlion_coordination_operation_change_v1 AFTER INSERT ON streamlion_coordination_operations_v1 BEGIN
  INSERT INTO streamlion_coordination_changes_v1 VALUES(NEW.connection_id,'',1)
    ON CONFLICT(connection_id,job_id) DO UPDATE SET generation=generation+1;
  INSERT INTO streamlion_coordination_changes_v1 SELECT NEW.connection_id,NEW.job_id,1
    WHERE EXISTS(SELECT 1 FROM streamlion_coordination_jobs_v1 WHERE id=NEW.job_id AND connection_id=NEW.connection_id)
    ON CONFLICT(connection_id,job_id) DO UPDATE SET generation=generation+1;
END;
CREATE TRIGGER streamlion_coordination_operation_finish_v1 AFTER UPDATE OF state ON streamlion_coordination_operations_v1 WHEN NEW.state!=OLD.state BEGIN
  INSERT INTO streamlion_coordination_changes_v1 VALUES(NEW.connection_id,'',1)
    ON CONFLICT(connection_id,job_id) DO UPDATE SET generation=generation+1;
  INSERT INTO streamlion_coordination_changes_v1 SELECT NEW.connection_id,NEW.job_id,1
    WHERE EXISTS(SELECT 1 FROM streamlion_coordination_jobs_v1 WHERE id=NEW.job_id AND connection_id=NEW.connection_id)
    ON CONFLICT(connection_id,job_id) DO UPDATE SET generation=generation+1;
END;
CREATE TRIGGER streamlion_coordination_job_change_v1 AFTER UPDATE OF closed_at,archive_at,archived ON streamlion_coordination_jobs_v1 BEGIN
  INSERT INTO streamlion_coordination_changes_v1 VALUES(NEW.connection_id,'',1)
    ON CONFLICT(connection_id,job_id) DO UPDATE SET generation=generation+1;
  INSERT INTO streamlion_coordination_changes_v1 VALUES(NEW.connection_id,NEW.id,1)
    ON CONFLICT(connection_id,job_id) DO UPDATE SET generation=generation+1;
END;
CREATE TABLE streamlion_coordination_work_schedule_v1 (
  kind TEXT NOT NULL CHECK(kind IN ('recovery','archive')), id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at INTEGER NOT NULL,
  PRIMARY KEY(kind,id)
);
CREATE INDEX streamlion_coordination_work_due_v1 ON streamlion_coordination_work_schedule_v1(next_attempt_at);
CREATE TABLE streamlion_coordination_maintenance_v1 (
  mode TEXT PRIMARY KEY CHECK(mode IN ('test','live')), next_cleanup_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO streamlion_coordination_maintenance_v1(mode) VALUES('test'),('live');
CREATE INDEX streamlion_coordination_pending_v1 ON streamlion_coordination_operations_v1(created_at) WHERE state='pending';
CREATE INDEX streamlion_coordination_completed_v1 ON streamlion_coordination_operations_v1(completed_at) WHERE state='complete';
CREATE INDEX streamlion_coordination_jobs_connection_v1 ON streamlion_coordination_jobs_v1(connection_id,archived,closed_at);
CREATE INDEX streamlion_coordination_mail_job_v1 ON streamlion_coordination_outbox_v1(job_id,status,attempts);
CREATE INDEX streamlion_coordination_reminders_v1 ON streamlion_coordination_jobs_v1(archive_at) WHERE archived=0 AND reminder_at IS NULL;
CREATE TABLE streamlion_coordination_efficiency_schema_v1 (version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_coordination_efficiency_schema_v1 VALUES(1);
