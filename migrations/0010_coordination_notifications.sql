-- Additive notification metadata only. No transport or paid feature is enabled.
ALTER TABLE streamlion_coordination_connections_v1 ADD COLUMN notification_email TEXT;
ALTER TABLE streamlion_coordination_outbox_v1 ADD COLUMN recipient_role TEXT NOT NULL DEFAULT 'client' CHECK(recipient_role IN ('client','provider'));
ALTER TABLE streamlion_coordination_outbox_v1 ADD COLUMN kind TEXT NOT NULL DEFAULT 'action' CHECK(kind IN ('invite','action','routine'));
ALTER TABLE streamlion_coordination_outbox_v1 ADD COLUMN status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','accepted','delivered','bounced','complained','failed','skipped','uncertain'));
ALTER TABLE streamlion_coordination_outbox_v1 ADD COLUMN first_attempt_at INTEGER;
ALTER TABLE streamlion_coordination_outbox_v1 ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE streamlion_coordination_outbox_v1 ADD COLUMN provider_id TEXT;
-- Historical sent_at means processed, not proven inbox delivery.
UPDATE streamlion_coordination_outbox_v1 SET status='accepted' WHERE sent_at IS NOT NULL;
CREATE INDEX streamlion_coordination_mail_due_v1 ON streamlion_coordination_outbox_v1(status,next_attempt_at,created_at);
CREATE UNIQUE INDEX streamlion_coordination_mail_receipt_v1 ON streamlion_coordination_outbox_v1(provider_id) WHERE provider_id IS NOT NULL;
CREATE TABLE streamlion_coordination_delivery_lock_v1(id INTEGER PRIMARY KEY CHECK(id=1), token TEXT, expires_at INTEGER NOT NULL DEFAULT 0);
INSERT INTO streamlion_coordination_delivery_lock_v1(id) VALUES(1);
CREATE TABLE streamlion_coordination_email_budget_v1(day INTEGER PRIMARY KEY, attempts INTEGER NOT NULL CHECK(attempts>0));
CREATE TABLE streamlion_coordination_email_events_v1(event_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('delivered','bounced','complained','failed')), created_at INTEGER NOT NULL);
CREATE INDEX streamlion_coordination_email_event_receipt_v1 ON streamlion_coordination_email_events_v1(provider_id);
CREATE TABLE streamlion_coordination_push_subscriptions_v1 (
  id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, connection_id TEXT NOT NULL,
  job_id TEXT, role TEXT NOT NULL CHECK(role IN ('client','provider')), grant_hash TEXT,
  payload TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX streamlion_coordination_push_owner_v1 ON streamlion_coordination_push_subscriptions_v1(owner_key,expires_at);
CREATE TABLE streamlion_coordination_push_outbox_v1 (
  id TEXT PRIMARY KEY, notice_id TEXT NOT NULL, subscription_id TEXT NOT NULL, job_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, sent_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0 CHECK(accepted IN (0,1))
);
CREATE INDEX streamlion_coordination_push_due_v1 ON streamlion_coordination_push_outbox_v1(sent_at,next_attempt_at);
CREATE TABLE streamlion_coordination_notifications_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_coordination_notifications_schema_v1 VALUES(1);
