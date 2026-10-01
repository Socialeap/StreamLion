-- Apply only when folder_id AND streamlion_google_folder_schema_v1 are absent.
ALTER TABLE streamlion_google_sessions_v1 ADD COLUMN folder_id TEXT NOT NULL DEFAULT '';
CREATE TABLE streamlion_google_folder_schema_v1 (version INTEGER PRIMARY KEY CHECK (version = 1));
INSERT INTO streamlion_google_folder_schema_v1 VALUES (1);
