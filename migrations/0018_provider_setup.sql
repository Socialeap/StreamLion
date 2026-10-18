-- Additive only. The provider setup assistant's answers, kept with the Google
-- account so they follow the provider to every device. Business details only;
-- no credentials, tokens, balances or project records.
CREATE TABLE streamlion_provider_setup_v1 (
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  google_subject TEXT NOT NULL,
  state TEXT NOT NULL CHECK(length(state) <= 250000 AND json_valid(state)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(mode,google_subject)
);
