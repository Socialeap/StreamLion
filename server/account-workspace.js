// A preference is never authorization. Callers validate Google access before use.
export async function workspacePreferencesReady(db) {
  return !!(await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='streamlion_account_workspace_v1'",
    )
    .first());
}
export function selectedAccountWorkspaceStatement(db, row, field, now) {
  if (!["workbook_id", "folder_id"].includes(field))
    throw Error("invalid_workspace_field");
  return db
    .prepare(
      `INSERT INTO streamlion_account_workspace_v1(google_subject,${field},updated_at) SELECT google_subject,${field},? FROM streamlion_google_sessions_v1 WHERE session_hash=? AND google_subject=? AND expires_at>? ON CONFLICT(google_subject) DO UPDATE SET ${field}=excluded.${field},updated_at=excluded.updated_at`,
    )
    .bind(now, row.session_hash, row.google_subject, now);
}
export async function restoreAccountWorkspace(db, row, verify) {
  if ((row.workbook_id && row.folder_id) || !(await workspacePreferencesReady(db))) return null;
  const saved = await db
    .prepare(
      "SELECT workbook_id,folder_id FROM streamlion_account_workspace_v1 WHERE google_subject=?",
    )
    .bind(row.google_subject)
    .first();
  if (!saved?.workbook_id) return null;
  if (row.workbook_id) {
    if (
      saved.workbook_id !== row.workbook_id ||
      !/^[\w-]{1,100}$/.test(saved.folder_id || "") ||
      !(await verify("folder", saved.folder_id))
    )
      return null;
    await db
      .prepare(
        "UPDATE streamlion_google_sessions_v1 SET folder_id=? WHERE session_hash=? AND google_subject=? AND expires_at>? AND workbook_id=? AND COALESCE(folder_id,'')=''",
      )
      .bind(saved.folder_id, row.session_hash, row.google_subject, Date.now(), row.workbook_id)
      .run();
  } else {
    if (!/^[\w-]{1,100}$/.test(saved.workbook_id)) return { unavailable: true };
    if (!(await verify("workbook", saved.workbook_id)))
      return { unavailable: true };
    let folder = row.folder_id || "";
    if (
      !folder &&
      /^[\w-]{1,100}$/.test(saved.folder_id || "") &&
      (await verify("folder", saved.folder_id))
    )
      folder = saved.folder_id;
    // Do not resurrect a signed-out session or overwrite a concurrent explicit choice.
    await db
      .prepare(
        "UPDATE streamlion_google_sessions_v1 SET workbook_id=?,folder_id=CASE WHEN folder_id=? THEN ? ELSE folder_id END WHERE session_hash=? AND google_subject=? AND expires_at>? AND workbook_id=''",
      )
      .bind(
        saved.workbook_id,
        row.folder_id || "",
        folder,
        row.session_hash,
        row.google_subject,
        Date.now(),
      )
      .run();
  }
  return db
    .prepare(
      "SELECT * FROM streamlion_google_sessions_v1 WHERE session_hash=? AND google_subject=? AND expires_at>?",
    )
    .bind(row.session_hash, row.google_subject, Date.now())
    .first();
}
