-- Legacy embed rows have no publication binding and cannot be served.
ALTER TABLE streamlion_intake_embeds_v1 ADD COLUMN f3d_profile_slug TEXT;

CREATE TABLE streamlion_f3d_embed_commands_v1 (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX streamlion_f3d_embed_command_expiry_v1
  ON streamlion_f3d_embed_commands_v1(expires_at);
