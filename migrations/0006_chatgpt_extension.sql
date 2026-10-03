-- Optional ChatGPT pilot. Apply byte-for-byte only when ALL six tables are absent.
-- No project database: drafts are encrypted, temporary review copies; Google remains authoritative.
CREATE TABLE streamlion_extension_schema_v1 (version INTEGER PRIMARY KEY CHECK (version = 1));
INSERT INTO streamlion_extension_schema_v1 VALUES (1);
CREATE TABLE streamlion_extension_codes_v1 (
  code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL,
  session_hash TEXT NOT NULL, workbook_id TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE streamlion_extension_grants_v1 (
  grant_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, session_hash TEXT NOT NULL,
  workbook_id TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE streamlion_extension_tokens_v1 (
  token_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  expires_at INTEGER NOT NULL
);
CREATE INDEX streamlion_extension_token_grant ON streamlion_extension_tokens_v1(grant_id);
CREATE TABLE streamlion_extension_drafts_v1 (
  draft_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, confirmation_hash TEXT NOT NULL,
  payload TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX streamlion_extension_draft_grant ON streamlion_extension_drafts_v1(grant_id);
CREATE TABLE streamlion_extension_locks_v1 (
  workbook_id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL
);
