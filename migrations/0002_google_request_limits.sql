-- Apply byte-for-byte only when BOTH named objects are absent.
CREATE TABLE streamlion_google_request_limits_v1 (
  scope TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0)
);
CREATE INDEX streamlion_google_limit_expiry ON streamlion_google_request_limits_v1(window_start);
