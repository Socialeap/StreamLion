import test from "node:test";
import assert from "node:assert/strict";
import { adminFixture, ADMIN_NOW } from "../../test/admin-fixture.js";
import { listUsers } from "../../server/admin-data.js";

test("directory name/business prefix search matches hydrated pilot and branding identities, counts and cursor pages", async (t) => {
  const f = await adminFixture(t);
  for (let i = 0; i < 30; i++) {
    const id = "search-" + String(i).padStart(2, "0");
    f.db
      .prepare(
        "INSERT INTO streamlion_accounts_v1(google_subject,email,name,business,first_known_at,first_known_source) VALUES(?,?,'','',?,'synthetic')",
      )
      .run(id, id + "@example.invalid", ADMIN_NOW);
    f.db
      .prepare("INSERT INTO streamlion_account_activity_v1 VALUES('live',?,?)")
      .run(id, ADMIN_NOW - i);
    f.db
      .prepare(
        "INSERT INTO streamlion_free_pilot_accounts_v1(mode,google_subject,email,name,business,fit,contact,applied_at,updated_at,actor,action,reason) VALUES('live',?,?,?,'Pilot Studio','Field capture',1,?,?,'fixture','apply','')",
      )
      .run(
        id,
        id + "@example.invalid",
        "Pilot Member " + i,
        ADMIN_NOW,
        ADMIN_NOW,
      );
    f.db
      .prepare(
        "INSERT INTO streamlion_provider_branding_v1 VALUES('live',?,?,1,?)",
      )
      .run(id, JSON.stringify({ name: "Brand Studio " + i }), ADMIN_NOW);
  }
  const search = (value, extra = {}) =>
    listUsers(
      f.env.GOOGLE_SESSIONS,
      "live",
      new URLSearchParams({ search: value, ...extra }),
      ADMIN_NOW,
    );
  const names = await search("pIlOt mEm");
  assert.equal(names.total, 30);
  assert.equal(names.users.length, 25);
  assert.ok(names.users.every((u) => u.name.startsWith("Pilot Member")));
  const next = await search("pilot mem", { cursor: names.nextCursor });
  assert.equal(next.total, 30);
  assert.equal(next.users.length, 5);
  assert.equal(
    new Set([...names.users, ...next.users].map((u) => u.subject)).size,
    30,
  );
  const brands = await search("brand stu");
  assert.equal(brands.total, 30);
  assert.ok(brands.users.every((u) => u.business.startsWith("Brand Studio")));
  // Hidden sources must not match a different identity than the displayed one.
  assert.equal((await search("pilot studio")).total, 0);
  f.db.exec(
    "UPDATE streamlion_accounts_v1 SET name='Registry Name' WHERE google_subject='search-00'",
  );
  assert.equal((await search("pilot member 0")).total, 0);
  assert.equal((await search("registry n")).users[0].name, "Registry Name");
  // Wrong-mode identity sources never become customer search results.
  f.db
    .prepare(
      "INSERT INTO streamlion_provider_branding_v1 VALUES('test','search-00',?,1,?)",
    )
    .run(JSON.stringify({ name: "Test Only Branding" }), ADMIN_NOW);
  assert.equal((await search("test only")).total, 0);
  // A non-text branding name falls back exactly as hydration does.
  f.db.exec(
    "UPDATE streamlion_provider_branding_v1 SET profile='{\"name\":42}' WHERE google_subject='search-00' AND mode='live'",
  );
  assert.equal((await search("pilot stu")).users[0].business, "Pilot Studio");
  assert.equal((await search("search-00@")).users[0].subject, "search-00");
  // LIKE wildcard characters in a prefix remain literal.
  f.db.exec(
    "UPDATE streamlion_accounts_v1 SET name='100% Real_Studio' WHERE google_subject='search-00'",
  );
  assert.equal((await search("100% real_")).total, 1);
  assert.equal((await search("100_")).total, 0);
});
