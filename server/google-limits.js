// One atomic SQL statement reserves project AND account capacity. Failed
// reservations consume neither bucket; limits are shared across edge isolates.
export async function reserveGoogleRequest(
  database,
  subject,
  method,
  now = Date.now(),
) {
  const kind = method === "GET" ? "read" : "write";
  return reserveCapacity(database, subject, kind, 200, 40, now);
}

export async function reserveSignIn(
  database,
  identity,
  action,
  now = Date.now(),
) {
  const callback = action === "callback";
  return reserveCapacity(
    database,
    identity,
    `signin:${action}`,
    callback ? 120 : 60,
    callback ? 10 : 5,
    now,
  );
}

async function reserveCapacity(
  database,
  subject,
  kind,
  projectLimit,
  accountLimit,
  now,
) {
  const window = Math.floor(now / 60000) * 60000;
  const project = `project:${kind}`,
    account = `account:${subject}:${kind}`;
  const result = await database
    .prepare(
      `
    INSERT INTO streamlion_google_request_limits_v1 (scope, window_start, used)
    SELECT scope, ?, 1 FROM (SELECT ? AS scope UNION ALL SELECT ?)
    WHERE NOT EXISTS (
      SELECT 1 FROM streamlion_google_request_limits_v1
      WHERE scope IN (?, ?) AND window_start = ?
      AND used >= CASE WHEN scope = ? THEN ? ELSE ? END
    )
    ON CONFLICT(scope) DO UPDATE SET
      used = CASE WHEN window_start = excluded.window_start THEN used + 1 ELSE 1 END,
      window_start = excluded.window_start
  `,
    )
    .bind(
      window,
      project,
      account,
      project,
      account,
      window,
      project,
      projectLimit,
      accountLimit,
    )
    .run();
  return {
    allowed: result.meta.changes === 2,
    retryAfter: Math.max(1, Math.ceil((window + 60000 - now) / 1000)),
  };
}
