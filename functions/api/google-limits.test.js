import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveGoogleRequest } from "../../server/google-limits.js";
test("distributed quota reservations are atomic, isolate accounts and reserve independent read/write capacity", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL(
        "../../migrations/0002_google_request_limits.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const db = {
    prepare: (sql) => ({
      bind: (...args) => ({
        run: async () => ({
          meta: { changes: sqlite.prepare(sql).run(...args).changes },
        }),
      }),
    }),
  };
  const now = 120000;
  for (let count = 0; count < 40; count++)
    assert.equal(
      (await reserveGoogleRequest(db, "a", "GET", now)).allowed,
      true,
    );
  assert.equal(
    (await reserveGoogleRequest(db, "a", "GET", now)).allowed,
    false,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT used FROM streamlion_google_request_limits_v1 WHERE scope='project:read'",
      )
      .get().used,
    40,
  );
  assert.equal(
    (await reserveGoogleRequest(db, "a", "POST", now)).allowed,
    true,
  );
  for (const account of ["b", "c", "d", "e"])
    for (let count = 0; count < 40; count++)
      assert.equal(
        (await reserveGoogleRequest(db, account, "GET", now)).allowed,
        true,
      );
  assert.equal(
    (await reserveGoogleRequest(db, "f", "GET", now)).allowed,
    false,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM streamlion_google_request_limits_v1 WHERE scope='account:f:read'",
      )
      .get().count,
    0,
  );
  assert.equal(
    (await reserveGoogleRequest(db, "a", "GET", now + 60000)).allowed,
    true,
  );
  sqlite.close();
});
