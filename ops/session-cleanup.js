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
    // Counts only: no account IDs, cookies, tokens, project data or request URLs.
    console.log(
      JSON.stringify({ service: "streamlion-session-cleanup", ...result }),
    );
  },
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
