-- Public business identity only. Does not alter connections, jobs, credits or pilot policy.
CREATE TABLE streamlion_provider_branding_v1 (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  google_subject TEXT NOT NULL,
  profile TEXT NOT NULL CHECK(length(profile) <= 120000 AND json_valid(profile)),
  version INTEGER NOT NULL CHECK(version > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(mode,google_subject)
);
