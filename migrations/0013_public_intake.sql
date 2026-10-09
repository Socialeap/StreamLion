-- Reusable public forms. No feature, grant, email allowance or spending is enabled.
CREATE TABLE streamlion_public_forms_v1 (
  id TEXT PRIMARY KEY, connection_id TEXT NOT NULL REFERENCES streamlion_coordination_connections_v1(id),
  token_hash TEXT NOT NULL UNIQUE, token_cipher TEXT NOT NULL, descriptor TEXT NOT NULL,
  verification_required INTEGER NOT NULL DEFAULT 0 CHECK(verification_required IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at INTEGER NOT NULL, opened_at INTEGER
);
CREATE TABLE streamlion_public_submissions_v1 (
  job_id TEXT PRIMARY KEY REFERENCES streamlion_coordination_jobs_v1(id),
  form_id TEXT NOT NULL REFERENCES streamlion_public_forms_v1(id), operation TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL, access_hash TEXT NOT NULL, payload TEXT,
  state TEXT NOT NULL CHECK(state IN ('verification','pending','complete','expired')),
  challenge_hash TEXT UNIQUE, challenge_token TEXT, challenge_expires INTEGER, verified_at INTEGER, verified_session_hash TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX streamlion_public_pending_v1 ON streamlion_public_submissions_v1(state,expires_at);
CREATE TABLE streamlion_public_intake_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_public_intake_schema_v1 VALUES(1);
