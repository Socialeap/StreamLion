-- Marker: streamlion_google_sessions_v1. Apply only when BOTH tables are absent.
CREATE TABLE streamlion_google_sessions_v1 (
  session_hash TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  credentials TEXT NOT NULL,
  workbook_id TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL
);
CREATE INDEX streamlion_google_session_expiry ON streamlion_google_sessions_v1(expires_at);
CREATE TABLE streamlion_auth_schema_v1 (version INTEGER PRIMARY KEY CHECK (version = 1));
INSERT INTO streamlion_auth_schema_v1 VALUES (1);
