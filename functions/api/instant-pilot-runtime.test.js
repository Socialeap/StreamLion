import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hash } from "../../server/google-auth.js";

test("real local D1 admits one final-slot start and applies one scheduled release across competing requests", async () => {
  const now = Date.UTC(2026, 9, 24, 22),
    DAY = 86400000;
  const bundle = await build({
    stdin: {
      contents: `import {handleFreePilot} from './server/free-pilot.js';let clock=${now};Date.now=()=>clock;globalThis.fetch=async()=>{throw Error('No external calls');};export default {fetch(request,env){clock=Number(request.headers.get('X-Fixture-Now')||${now});return handleFreePilot({request,env:{...env,GOOGLE_SESSIONS:env.DB,ENABLE_FREE_PILOT:'true',STREAMLION_PAYMENTS_MODE:'test',STREAMLION_CHECKOUT_MODE:'paused',GOOGLE_AUTH_ORIGIN:'https://app.example'},params:{path:new URL(request.url).pathname.replace('/api/free-pilot/','').split('/')}});}}`,
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
  );
  const schema = new DatabaseSync(":memory:");
  try {
    for (const n of [
      "0001_google_sessions",
      "0002_google_request_limits",
      "0003_google_workspace_folder",
      "0004_streamlion_purchases",
      "0023_controlled_free_pilot",
      "0024_instant_pilot",
    ])
      schema.exec(
        readFileSync(
          new URL(`../../migrations/${n}.sql`, import.meta.url),
          "utf8",
        ),
      );
    const ddl = schema
      .prepare(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name",
      )
      .all();
    const db = await mf.getD1Database("DB");
    await db.batch(ddl.map((r) => db.prepare(r.sql)));
    await db.batch([
      db.prepare("INSERT INTO streamlion_free_pilot_schema_v1 VALUES(1)"),
      db.prepare(
        "INSERT INTO streamlion_free_pilot_instant_schema_v1 VALUES(1)",
      ),
      db
        .prepare(
          "INSERT INTO streamlion_free_pilot_policy_v1(mode,interest_open,admissions_open,active_cap,admission_cap,admission_mode,application_start,application_end,closes_at) VALUES('test',1,1,1,1,'instant',?,?,?)",
        )
        .bind(now - DAY, now + 30 * DAY, now + 60 * DAY),
      db.prepare(
        "INSERT INTO streamlion_free_pilot_admins_v1 VALUES('test','owner')",
      ),
    ]);
    const ids = {};
    for (const s of ["owner", "a", "b", "c", "d", "e"]) {
      ids[s] = Buffer.from(s.padEnd(32, "x")).toString("base64url");
      await db
        .prepare(
          "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          await hash(ids[s]),
          s,
          s + "@example.com",
          "fixture",
          now + 100 * DAY,
        )
        .run();
    }
    let clock = now;
    const req = (route, subject, body) =>
      mf.dispatchFetch("https://app.example/api/free-pilot/" + route, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "https://app.example",
          Cookie: "__Host-streamlion-session=" + ids[subject],
          "X-StreamLion-Account": subject,
          "X-Fixture-Now": String(clock),
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const form = {
      name: "Provider",
      business: "Capture",
      fit: "Test a useful capture job.",
      contact: true,
      marketing: false,
      provider: true,
      ready: true,
      terms: "free-pilot-v2",
      durationDays: 14,
    };
    const replies = await Promise.all(
      ["a", "b", "c", "d", "e"].map((s) => req("start", s, form)),
    );
    assert.equal(replies.filter((r) => r.status === 200).length, 1);
    assert.equal(replies.filter((r) => r.status === 409).length, 4);
    const winner = await db
      .prepare(
        "SELECT google_subject,starts_at,ends_at FROM streamlion_free_pilot_accounts_v1 WHERE state='active'",
      )
      .first();
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await req("start", winner.google_subject, form)).status,
        200,
      );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM streamlion_free_pilot_audit_v1 WHERE action='start'",
          )
          .first()
      ).n,
      1,
    );
    const release = winner.ends_at + 1000;
    assert.equal(
      (
        await req("admin/schedule", "owner", {
          revision: 0,
          reopenAt: release,
          slots: 2,
          reason: "Release two additional places",
        })
      ).status,
      200,
    );
    clock = release;
    await Promise.all(Array.from({ length: 5 }, () => req("config", "owner")));
    const p = await db
      .prepare(
        "SELECT * FROM streamlion_free_pilot_policy_v1 WHERE mode='test'",
      )
      .first();
    assert.equal(p.admission_cap, 3);
    assert.equal(p.reopen_at, null);
    assert.equal(p.reopen_slots, 0);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM streamlion_free_pilot_policy_audit_v1 WHERE actor='schedule'",
          )
          .first()
      ).n,
      1,
    );
    const losers = ["a", "b", "c", "d", "e"].filter(
      (s) => s !== winner.google_subject,
    );
    const next = await Promise.all(losers.map((s) => req("start", s, form)));
    assert.equal(
      next.filter((r) => r.status === 200).length,
      1,
      "active limit still governs scheduled admissions",
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM streamlion_purchases_v1")
          .first()
      ).n,
      0,
    );
  } finally {
    schema.close();
    await mf.dispose();
  }
});
