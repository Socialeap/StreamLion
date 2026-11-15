-- Website embeds reference existing reusable forms and do not change their links.
CREATE TABLE streamlion_intake_embeds_v1 (
  id TEXT PRIMARY KEY NOT NULL,
  form_id TEXT NOT NULL UNIQUE REFERENCES streamlion_public_forms_v1(id),
  f3d_account_id TEXT NOT NULL,
  f3d_business_id TEXT NOT NULL,
  origins TEXT NOT NULL CHECK(json_valid(origins) AND json_type(origins)='array' AND json_array_length(origins) BETWEEN 1 AND 5)
);

CREATE TRIGGER streamlion_intake_embeds_unlink_v1
AFTER DELETE ON streamlion_f3d_profile_v1
BEGIN
  DELETE FROM streamlion_intake_embeds_v1 WHERE form_id IN (
    SELECT f.id FROM streamlion_public_forms_v1 f
    JOIN streamlion_coordination_connections_v1 c ON c.id=f.connection_id
    WHERE c.google_subject=OLD.google_subject AND c.mode=OLD.mode
  );
END;

CREATE TRIGGER streamlion_intake_embeds_profile_change_v1
AFTER UPDATE OF snapshot, f3d_account_id ON streamlion_f3d_profile_v1
WHEN OLD.f3d_account_id IS NOT NEW.f3d_account_id
  OR json_extract(OLD.snapshot,'$.businessProfile.id') IS NOT json_extract(NEW.snapshot,'$.businessProfile.id')
BEGIN
  DELETE FROM streamlion_intake_embeds_v1 WHERE form_id IN (
    SELECT f.id FROM streamlion_public_forms_v1 f
    JOIN streamlion_coordination_connections_v1 c ON c.id=f.connection_id
    WHERE c.google_subject=OLD.google_subject AND c.mode=OLD.mode
  );
END;

CREATE TABLE streamlion_intake_embed_schema_v1(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT INTO streamlion_intake_embed_schema_v1 VALUES(1);
