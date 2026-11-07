import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  selectedAccountWorkspaceStatement,
  restoreAccountWorkspace,
} from "../../server/account-workspace.js";
// Model an already Google-verified explicit selection through the production UPSERT.
async function seedSelection(db, subject, field, value) {
  const id = `seed-${subject}`;
  await db
    .prepare(
      "INSERT OR IGNORE INTO streamlion_google_sessions_v1 VALUES(?,?, '', '', ?)",
    )
    .bind(id, subject, Date.now() + 60000)
    .run();
  await db
    .prepare(
      `UPDATE streamlion_google_sessions_v1 SET ${field}=? WHERE session_hash=?`,
    )
    .bind(value, id)
    .run();
  await selectedAccountWorkspaceStatement(
    db,
    { session_hash: id, google_subject: subject },
    field,
    Date.now(),
  ).run();
}
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE streamlion_google_sessions_v1(session_hash TEXT PRIMARY KEY,google_subject TEXT,workbook_id TEXT DEFAULT '',folder_id TEXT DEFAULT '',expires_at INTEGER);",
  );
  const apply = () =>
    db.exec(
      readFileSync(
        new URL("../../migrations/0027_account_workspace.sql", import.meta.url),
        "utf8",
      ),
    );
  const wrap = (sql, values = []) => ({
    bind: (...v) => wrap(sql, v),
    first: async () => db.prepare(sql).get(...values) ?? null,
    run: async () => ({
      meta: { changes: db.prepare(sql).run(...values).changes },
    }),
  });
  const add = (id, subject, book = "", folder = "") => {
    db.prepare(
      "INSERT INTO streamlion_google_sessions_v1 VALUES(?,?,?,?,?)",
    ).run(id, subject, book, folder, Date.now() + 60000);
    return db
      .prepare(
        "SELECT * FROM streamlion_google_sessions_v1 WHERE session_hash=?",
      )
      .get(id);
  };
  return { db, apply, store: { prepare: wrap }, add };
}
test("migration seeds only unambiguous active accounts and survives session deletion", async () => {
  const f = fixture();
  f.add("a", "alice", "book-a", "folder-a");
  f.add("a2", "alice", "book-a", "folder-a");
  f.add("b", "bob", "book-b");
  f.add("b2", "bob", "different-book");
  f.add("old", "expired", "old-book");
  f.db
    .prepare(
      "UPDATE streamlion_google_sessions_v1 SET expires_at=0 WHERE session_hash=?",
    )
    .run("old");
  f.apply();
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT google_subject,workbook_id FROM streamlion_account_workspace_v1",
      )
      .all()
      .map((x) => ({ ...x })),
    [{ google_subject: "alice", workbook_id: "book-a" }],
  );
  f.db.exec("DELETE FROM streamlion_google_sessions_v1");
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM streamlion_account_workspace_v1").get()
      .n,
    1,
  );
});
test("new device restores the same account only after fresh permission checks", async () => {
  const f = fixture();
  f.apply();
  await seedSelection(f.store, "alice", "workbook_id", "book-a");
  await seedSelection(f.store, "alice", "folder_id", "folder-a");
  const row = f.add("new-device", "alice");
  const calls = [];
  const restored = await restoreAccountWorkspace(f.store, row, async (...v) => {
    calls.push(v);
    return true;
  });
  assert.equal(restored.workbook_id, "book-a");
  assert.equal(restored.folder_id, "folder-a");
  assert.deepEqual(calls, [
    ["workbook", "book-a"],
    ["folder", "folder-a"],
  ]);
  assert.equal(
    await restoreAccountWorkspace(f.store, f.add("other", "bob"), async () => {
      throw Error("must not check another account");
    }),
    null,
  );
});
test("explicit device choice is preserved and preference updates preserve the other field", async () => {
  const f = fixture();
  f.apply();
  await seedSelection(f.store, "alice", "folder_id", "folder-a");
  await seedSelection(f.store, "alice", "workbook_id", "book-a");
  await seedSelection(f.store, "alice", "workbook_id", "book-b");
  const row = f.add("chosen", "alice", "intentional-book");
  assert.equal(
    await restoreAccountWorkspace(f.store, row, async () => {
      throw Error("not needed");
    }),
    null,
  );
  const p = f.db.prepare("SELECT * FROM streamlion_account_workspace_v1").get();
  assert.equal(p.workbook_id, "book-b");
  assert.equal(p.folder_id, "folder-a");
});
test("revoked permission and temporary errors do not bind or erase the saved preference", async () => {
  const f = fixture();
  f.apply();
  await seedSelection(f.store, "alice", "workbook_id", "book-a");
  const row = f.add("new", "alice");
  assert.deepEqual(
    await restoreAccountWorkspace(f.store, row, async () => false),
    { unavailable: true },
  );
  await assert.rejects(
    restoreAccountWorkspace(f.store, row, async () => {
      throw Error("temporary");
    }),
    /temporary/,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT workbook_id FROM streamlion_google_sessions_v1 WHERE session_hash='new'",
      )
      .get().workbook_id,
    "",
  );
  assert.equal(
    f.db
      .prepare("SELECT workbook_id FROM streamlion_account_workspace_v1")
      .get().workbook_id,
    "book-a",
  );
});
test("concurrent sign-out cannot resurrect a session and explicit selection wins a restore race", async () => {
  const f = fixture();
  f.apply();
  await seedSelection(f.store, "alice", "workbook_id", "book-a");
  const row = f.add("new", "alice");
  assert.equal(
    await restoreAccountWorkspace(f.store, row, async () => {
      f.db
        .prepare(
          "DELETE FROM streamlion_google_sessions_v1 WHERE session_hash='new'",
        )
        .run();
      return true;
    }),
    null,
  );
  const next = f.add("next", "alice");
  const restored = await restoreAccountWorkspace(f.store, next, async () => {
    f.db
      .prepare(
        "UPDATE streamlion_google_sessions_v1 SET workbook_id='chosen' WHERE session_hash='next'",
      )
      .run();
    return true;
  });
  assert.equal(restored.workbook_id, "chosen");
});
