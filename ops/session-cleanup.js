export async function purgeExpiredSessions(database, now = Date.now()) {
  const results = await database.batch([
    database
      .prepare(
        "DELETE FROM streamlion_google_sessions_v1 WHERE expires_at <= ?",
      )
      .bind(now),
    database
      .prepare(
        "DELETE FROM streamlion_google_request_limits_v1 WHERE window_start < ?",
      )
      .bind(now - 86400000),
  ]);
  return {
    sessionsRemoved: results[0].meta.changes,
    staleLimitsRemoved: results[1].meta.changes,
  };
}
export default {
  async scheduled(event, env) {
    const result = await purgeExpiredSessions(env.GOOGLE_SESSIONS);
    if (env.ENABLE_CHATGPT_EXTENSION === "true")
      Object.assign(result, await purgeExtensionState(env.GOOGLE_SESSIONS));
    Object.assign(result, await purgeBriefState(env.GOOGLE_SESSIONS));
    // Counts only: no account IDs, cookies, tokens, project data or request URLs.
    console.log(
      JSON.stringify({ service: "streamlion-session-cleanup", ...result }),
    );
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};

export async function purgeBriefState(database, now = Date.now()) {
  // Safe before migration 0016. Keep financial metadata for budget/reconciliation.
  const present = await database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='streamlion_brief_jobs_v1'",
    )
    .first();
  if (!present) return { briefResultsRemoved: 0, staleBriefsReturned: 0 };
  const results = await database.batch([
    database
      .prepare(
        "UPDATE streamlion_brief_jobs_v1 SET result=NULL WHERE state='complete' AND result IS NOT NULL AND expires_at<=?",
      )
      .bind(now),
    database
      .prepare(
        "UPDATE streamlion_brief_jobs_v1 SET state='failed' WHERE state='pending' AND created_at<?",
      )
      .bind(now - 300000),
  ]);
  return {
    briefResultsRemoved: results[0].meta.changes,
    staleBriefsReturned: results[1].meta.changes,
  };
}

export async function purgeExtensionState(database, now = Date.now()) {
  const results = await database.batch([
    database
      .prepare(
        `DELETE FROM streamlion_extension_drafts_v1 WHERE expires_at <= ? OR grant_id IN
      (SELECT grant_id FROM streamlion_extension_grants_v1 WHERE revoked = 1 OR expires_at <= ? OR session_hash NOT IN (SELECT session_hash FROM streamlion_google_sessions_v1 WHERE expires_at > ?))`,
      )
      .bind(now, now, now),
    database
      .prepare(
        `DELETE FROM streamlion_extension_tokens_v1 WHERE expires_at <= ? OR grant_id IN
      (SELECT grant_id FROM streamlion_extension_grants_v1 WHERE revoked = 1 OR expires_at <= ? OR session_hash NOT IN (SELECT session_hash FROM streamlion_google_sessions_v1 WHERE expires_at > ?))`,
      )
      .bind(now, now, now),
    database
      .prepare(
        "DELETE FROM streamlion_extension_grants_v1 WHERE revoked = 1 OR expires_at <= ? OR session_hash NOT IN (SELECT session_hash FROM streamlion_google_sessions_v1 WHERE expires_at > ?)",
      )
      .bind(now, now),
    database
      .prepare(
        "DELETE FROM streamlion_extension_codes_v1 WHERE expires_at <= ? OR session_hash NOT IN (SELECT session_hash FROM streamlion_google_sessions_v1 WHERE expires_at > ?)",
      )
      .bind(now, now),
    database
      .prepare(
        "DELETE FROM streamlion_extension_locks_v1 WHERE expires_at <= ?",
      )
      .bind(now),
  ]);
  return {
    extensionDraftsRemoved: results[0].meta.changes,
    extensionTokensRemoved: results[1].meta.changes,
    extensionGrantsRemoved: results[2].meta.changes,
    extensionCodesRemoved: results[3].meta.changes,
    extensionLocksRemoved: results[4].meta.changes,
  };
}
