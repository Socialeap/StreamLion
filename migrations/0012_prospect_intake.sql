-- Additive, inactive until Pages Functions deploy. Existing email invitations remain unchanged.
CREATE TABLE streamlion_prospect_links_v1 (
  job_id TEXT PRIMARY KEY REFERENCES streamlion_coordination_jobs_v1(id),
  token_hash TEXT NOT NULL UNIQUE, token_cipher TEXT NOT NULL,
  public_intake TEXT NOT NULL, expected_email_hash TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  opened_at INTEGER, claimed_at INTEGER, claimed_email_hash TEXT,
  claim_payload TEXT, claim_operation TEXT, synced_at INTEGER
);
CREATE TABLE streamlion_prospect_challenges_v1 (
  hash TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES streamlion_prospect_links_v1(job_id),
  email_hash TEXT NOT NULL, email_cipher TEXT NOT NULL, payload TEXT NOT NULL,
  operation TEXT NOT NULL, expires_at INTEGER NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
);
CREATE INDEX streamlion_prospect_challenge_expiry_v1 ON streamlion_prospect_challenges_v1(expires_at);
CREATE INDEX streamlion_prospect_claim_pending_v1 ON streamlion_prospect_links_v1(claimed_at) WHERE claimed_at IS NOT NULL AND synced_at IS NULL;
CREATE TABLE streamlion_prospect_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_prospect_schema_v1 VALUES(1);
