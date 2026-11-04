-- Read-only cross-product profile cache, not canonical profile/identity authority.
-- Additive. No license, credit, Google credential or project ownership changes.
CREATE TABLE streamlion_f3d_profile_v1 (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  google_subject TEXT NOT NULL,
  f3d_account_id TEXT,
  snapshot TEXT CHECK(snapshot IS NULL OR (json_valid(snapshot) AND length(snapshot)<=12000)),
  verified_at INTEGER,
  pending_nonce_hash TEXT,
  pending_session_hash TEXT,
  pending_expires_at INTEGER,
  PRIMARY KEY(mode,google_subject),
  CHECK((snapshot IS NULL AND f3d_account_id IS NULL AND verified_at IS NULL)
     OR (snapshot IS NOT NULL AND f3d_account_id IS NOT NULL AND verified_at IS NOT NULL))
);
