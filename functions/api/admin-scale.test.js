import test from "node:test";
import assert from "node:assert/strict";
import { adminFixture, ADMIN_NOW } from "../../test/admin-fixture.js";
import { listUsers } from "../../server/admin-data.js";
for (const size of [1000, 10000])
  test(`directory pages ${size} synthetic accounts using bounded statements and the activity index`, async (t) => {
    const f = await adminFixture(t);
    const account = f.db.prepare(
        "INSERT INTO streamlion_accounts_v1(google_subject,email,name,business,first_known_at,first_known_source) VALUES(?,?,?,'Studio',?,'synthetic')",
      ),
      active = f.db.prepare(
        "INSERT INTO streamlion_account_activity_v1 VALUES('live',?,?)",
      );
    f.db.exec("BEGIN");
    for (let i = 0; i < size; i++) {
      const id = "user" + String(i).padStart(5, "0");
      account.run(
        id,
        id + "@example.invalid",
        "Member " + i,
        ADMIN_NOW - i * 1000,
      );
      active.run(id, ADMIN_NOW - (i % 100) * 1000);
    }
    f.db.exec("COMMIT");
    const actual = f.env.GOOGLE_SESSIONS,
      executed = [];
    const db = {
      prepare(sql) {
        let args = [];
        return {
          bind(...a) {
            args = a;
            return this;
          },
          async first() {
            executed.push({ sql, args });
            return actual
              .prepare(sql)
              .bind(...args)
              .first();
          },
          async all() {
            executed.push({ sql, args });
            return actual
              .prepare(sql)
              .bind(...args)
              .all();
          },
        };
      },
    };
    const start = performance.now(),
      p = await listUsers(db, "live", new URLSearchParams(), ADMIN_NOW);
    assert.equal(p.total, size);
    assert.equal(p.users.length, 25);
    assert.equal(p.users[0].subject, "user00000");
    assert.equal(executed.length, 3);
    const plan = f.db
      .prepare("EXPLAIN QUERY PLAN " + executed[1].sql)
      .all(...executed[1].args);
    assert.ok(
      plan.some((r) =>
        /USING (COVERING )?INDEX streamlion_admin_active_v1/.test(r.detail),
      ),
    );
    const next = await listUsers(
      db,
      "live",
      new URLSearchParams({ cursor: p.nextCursor }),
      ADMIN_NOW,
    );
    assert.equal(next.users.length, 25);
    assert.equal(
      new Set([...p.users, ...next.users].map((u) => u.subject)).size,
      50,
    );
    t.diagnostic(
      JSON.stringify({
        accounts: size,
        twoPagesMs: Math.round(performance.now() - start),
        sqlStatements: executed.length,
        environment: "local SQLite; not production D1 latency",
      }),
    );
  });
