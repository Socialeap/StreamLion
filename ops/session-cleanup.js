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
    // Counts only: no account IDs, cookies, tokens, project data or request URLs.
    console.log(
      JSON.stringify({ service: "streamlion-session-cleanup", ...result }),
    );
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};

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
