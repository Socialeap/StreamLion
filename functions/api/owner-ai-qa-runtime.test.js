import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("actual Workers/D1 atomically accepts only one owner AI reservation", async () => {
  const bundle = await build({
    stdin: {
      contents: `import {reserveOwnerQaTurn} from './server/ai-pilot.js';
    export default {async fetch(request,env){const x=await request.json();try{await reserveOwnerQaTurn(env.DB,x.session,x.grant,12500);return new Response('reserved');}catch{return new Response('rejected',{status:409});}}};`,
      resolveDir: new URL("../../", import.meta.url).pathname,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["node:buffer"],
    target: "es2022",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-09-23",
      compatibilityFlags: ["nodejs_compat"],
      script: bundle.outputFiles[0].text,
      d1Databases: ["DB"],
    }),
  );
  const schema = new DatabaseSync(":memory:");
  try {
    for (const name of ["0001_google_sessions", "0007_streamlion_ai_pilot"])
      schema.exec(
        readFileSync(
          new URL(`../../migrations/${name}.sql`, import.meta.url),
          "utf8",
        ),
      );
    schema.exec(
      "CREATE TABLE streamlion_admin_policy_v1(mode TEXT PRIMARY KEY,enabled INTEGER); CREATE TABLE streamlion_admin_owners_v1(mode TEXT,google_subject TEXT,email TEXT,enabled INTEGER)",
    );
    const ddl = schema
      .prepare(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name",
      )
      .all();
    const db = await mf.getD1Database("DB");
    await db.batch(ddl.map((r) => db.prepare(r.sql)));
    const now = Date.now();
    await db.batch([
      db.prepare(
        "INSERT INTO streamlion_ai_policy_v1 VALUES(1,1,12500,180000,30)",
      ),
      db.prepare(
        "INSERT INTO streamlion_ai_wallets_v1 VALUES('owner',1,100000)",
      ),
      db.prepare("INSERT INTO streamlion_admin_policy_v1 VALUES('live',1)"),
      db.prepare(
        "INSERT INTO streamlion_admin_owners_v1 VALUES('live','owner','shakoure@transcendencemedia.com',1)",
      ),
      db
        .prepare(
          "INSERT INTO streamlion_google_sessions_v1 VALUES('hash','owner','shakoure@transcendencemedia.com','fixture','synthetic',?)",
        )
        .bind(now + 600000),
    ]);
    const session = { session_hash: "hash", google_subject: "owner" };
    const grant = {
      requestId: "11111111-1111-4111-8111-111111111111",
      workbookId: "synthetic",
      issuedAt: now - 1000,
      expiresAt: now + 60000,
    };
    const req = (value) =>
      mf.dispatchFetch("https://app.example/reserve", {
        method: "POST",
        body: JSON.stringify(value),
      });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => req({ session, grant })),
    );
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 5);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM streamlion_ai_turns_v1")
          .first()
      ).n,
      1,
    );
    const next = {
      ...grant,
      requestId: "22222222-2222-4222-8222-222222222222",
    };
    await db.prepare("UPDATE streamlion_admin_owners_v1 SET enabled=0").run();
    assert.equal((await req({ session, grant: next })).status, 409);
    await db.prepare("UPDATE streamlion_admin_owners_v1 SET enabled=1").run();
    await db
      .prepare("UPDATE streamlion_google_sessions_v1 SET workbook_id='changed'")
      .run();
    assert.equal((await req({ session, grant: next })).status, 409);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM streamlion_ai_turns_v1")
          .first()
      ).n,
      1,
    );
  } finally {
    schema.close();
    await mf.dispose();
  }
});
