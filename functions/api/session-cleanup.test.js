import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker, { purgeExpiredSessions } from "../../ops/session-cleanup.js";
test("daily cleanup removes expired authorization and old quota rows without touching active sessions", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of [
    "0001_google_sessions.sql",
    "0002_google_request_limits.sql",
  ])
    sqlite.exec(
      readFileSync(
        new URL(`../../migrations/${name}`, import.meta.url),
        "utf8",
      ),
    );
  const now = 200000000;
  const insert = sqlite.prepare(
    "INSERT INTO streamlion_google_sessions_v1 VALUES (?,?,?,?,?,?)",
  );
  insert.run("expired", "a", "a@example.com", "encrypted", "book-a", now);
  insert.run("active", "b", "b@example.com", "encrypted", "book-b", now + 1000);
  sqlite
    .prepare("INSERT INTO streamlion_google_request_limits_v1 VALUES (?,?,?)")
    .run("old", now - 86400001, 1);
  sqlite
    .prepare("INSERT INTO streamlion_google_request_limits_v1 VALUES (?,?,?)")
    .run("recent", now, 1);
  const prepare = (sql, args = []) => ({
    bind: (...values) => prepare(sql, values),
    run: async () => ({
      meta: { changes: sqlite.prepare(sql).run(...args).changes },
    }),
  });
  const db = {
    prepare,
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  assert.deepEqual(await purgeExpiredSessions(db, now), {
    sessionsRemoved: 1,
    staleLimitsRemoved: 1,
  });
  assert.equal(
    sqlite
      .prepare("SELECT session_hash FROM streamlion_google_sessions_v1")
      .get().session_hash,
    "active",
  );
  assert.equal(
    sqlite
      .prepare("SELECT scope FROM streamlion_google_request_limits_v1")
      .get().scope,
    "recent",
  );
  assert.equal(worker.fetch().status, 404);
  sqlite.close();
});
