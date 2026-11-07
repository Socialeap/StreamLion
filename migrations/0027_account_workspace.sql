-- Marker: streamlion_account_workspace_v1; additive, no credentials or project data.
CREATE TABLE streamlion_account_workspace_v1 (
  google_subject TEXT PRIMARY KEY NOT NULL,
  workbook_id TEXT NOT NULL DEFAULT '',
  folder_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
-- Existing accounts with one unambiguous active workbook can reconnect immediately.
-- Multiple historical choices require one explicit selection; never guess a file.
INSERT INTO streamlion_account_workspace_v1(google_subject,workbook_id,folder_id,updated_at)
SELECT google_subject,MIN(workbook_id),
  CASE WHEN COUNT(DISTINCT folder_id)=1 THEN COALESCE(MIN(folder_id),'') ELSE '' END,
  CAST(unixepoch('subsec')*1000 AS INTEGER)
FROM streamlion_google_sessions_v1
WHERE expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER) AND workbook_id<>''
GROUP BY google_subject HAVING COUNT(DISTINCT workbook_id)=1;
