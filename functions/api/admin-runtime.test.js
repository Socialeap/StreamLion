import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hash } from "../../server/google-auth.js";
test("real local D1 serializes grants at a shared monthly ceiling, rolls back failed audit, and prevents reversal/reservation overdrafts", async () => {
  const now = Date.now(),
    cookie = "o".repeat(43),
    window = await hash(cookie);
  const bundle = await build({
    stdin: {
      contents: `import{handleAdmin}from'./server/admin-portal.js';Date.now=()=>${now};globalThis.fetch=async()=>{throw Error('No external calls')};export default{async fetch(request,env){if(new URL(request.url).pathname==='/fixture/speech'){try{await env.DB.prepare("INSERT INTO streamlion_speech_turns_v1 VALUES('live',?,'race-speech','scope','hash',12500,1000,'reserved',?)").bind(await request.text(),${now}).run();return Response.json({reserved:true})}catch{return Response.json({reserved:false},{status:409})}}return handleAdmin({request,env:{...env,GOOGLE_SESSIONS:env.DB,STREAMLION_PAYMENTS_MODE:'live',GOOGLE_AUTH_ORIGIN:'https://app.example'},params:{path:new URL(request.url).pathname.replace('/api/admin/','').split('/')}})}}`,
      resolveDir: new URL("../../", import.meta.url).pathname,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["node:buffer"],
  });
  const mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        compatibilityDate: "2026-09-23",
        compatibilityFlags: ["nodejs_compat"],
        script: bundle.outputFiles[0].text,
        d1Databases: ["DB"],
      }),
    ),
    schema = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../../migrations/", import.meta.url);
    for (const f of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      schema.exec(readFileSync(new URL(f, dir), "utf8"));
    const ddl = schema
      .prepare(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name",
      )
      .all();
    const db = await mf.getD1Database("DB");
    await db.batch(ddl.map((x) => db.prepare(x.sql)));
    await db.batch([
      db.prepare("INSERT INTO streamlion_admin_schema_v1 VALUES(1)"),
      db.prepare(
        "INSERT INTO streamlion_admin_policy_v1 VALUES('live',1,1,10000000,10000000,10000000)",
      ),
      db.prepare(
        "INSERT INTO streamlion_admin_owners_v1 VALUES('live','owner','shakoure@transcendencemedia.com',1)",
      ),
      db
        .prepare(
          "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,'owner','shakoure@transcendencemedia.com','synthetic',?)",
        )
        .bind(window, now + 86400000),
      db
        .prepare(
          "INSERT INTO streamlion_admin_windows_v1 VALUES(?,'owner','live',?,?,?)",
        )
        .bind(window, now, now, now),
      db.prepare(
        "INSERT INTO streamlion_speech_policy_v1 VALUES('live',1,1000,100000,100000,100,12500)",
      ),
    ]);
    for (const s of ["a", "b"])
      await db.batch([
        db
          .prepare(
            "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES(?,'live',?,'synthetic@example.com','price','prod',3995,'usd','paid',?,?,?)",
          )
          .bind("core-" + s, s, now, now + 86400000, now),
        db
          .prepare(
            "INSERT INTO streamlion_credit_wallets_v1 VALUES('live',?,0)",
          )
          .bind(s),
      ]);
    const call = (path, body) =>
      mf.dispatchFetch("https://app.example/api/admin/" + path, {
        method: "POST",
        headers: {
          Origin: "https://app.example",
          Cookie: "__Host-streamlion-session=" + cookie,
          "X-StreamLion-Account": "owner",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const prepare = async (target) => {
      const op = {
        operationId: crypto.randomUUID(),
        type: "grant",
        target,
        credits: 800,
        reason: "Synthetic recovery",
      };
      const a = await (await call("authorize", op)).json();
      assert.ok(a.authorization);
      return { ...op, authorization: a.authorization };
    };
    await db
      .prepare(
        "CREATE TRIGGER injected_audit_failure BEFORE INSERT ON streamlion_admin_audit_v1 BEGIN SELECT RAISE(ABORT,'fixture_audit_failure'); END",
      )
      .run();
    const fail = await prepare("a");
    assert.equal((await call("grants", fail)).status, 503);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM streamlion_admin_grants_v1")
          .first()
      ).n,
      0,
    );
    await db.prepare("DROP TRIGGER injected_audit_failure").run();
    const ops = await Promise.all(["a", "b"].map(prepare)),
      responses = await Promise.all(ops.map((op) => call("grants", op)));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const winner = ops[responses.findIndex((r) => r.status === 200)];
    const replay = await Promise.all(
      Array.from({ length: 4 }, () => call("grants", winner)),
    );
    assert.ok(replay.every((r) => r.status === 200));
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM streamlion_admin_audit_v1 WHERE action='grant'",
          )
          .first()
      ).n,
      1,
    );
    const reversal = {
      operationId: crypto.randomUUID(),
      type: "reversal",
      target: winner.operationId,
      credits: 800,
      reason: "Synthetic correction",
    };
    const auth = await (await call("authorize", reversal)).json();
    const [r, s] = await Promise.all([
      call("reversals", { ...reversal, authorization: auth.authorization }),
      mf.dispatchFetch("https://app.example/fixture/speech", {
        method: "POST",
        body: winner.target,
      }),
    ]);
    assert.ok(
      (r.status === 200 && s.status === 409) ||
        (r.status === 409 && s.status === 200),
    );
    const balance = await db
      .prepare(
        "SELECT remaining_micros n FROM streamlion_admin_grant_balances_v1 WHERE grant_id=?",
      )
      .bind(winner.operationId)
      .first();
    assert.ok(balance.n >= 0);
    assert.equal(balance.n, r.status === 200 ? 0 : 9987500);
  } finally {
    schema.close();
    await mf.dispose();
  }
});
