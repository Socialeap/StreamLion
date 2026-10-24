import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hash } from "../../server/google-auth.js";

test("actual Workers/D1 runtime serializes final-slot approvals, duplicate activation and audit records", async () => {
  const bundle = await build({
    stdin: {
      contents: `import {handleFreePilot} from './server/free-pilot.js';globalThis.fetch=async()=>{throw Error('External requests forbidden');};export default {fetch(request,env){return handleFreePilot({request,env:{...env,GOOGLE_SESSIONS:env.DB,ENABLE_FREE_PILOT:'true',STREAMLION_PAYMENTS_MODE:'test',GOOGLE_AUTH_ORIGIN:'https://app.example'},params:{path:new URL(request.url).pathname.replace('/api/free-pilot/','').split('/')}});}};`,
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
    for (const n of [
      "0001_google_sessions",
      "0002_google_request_limits",
      "0003_google_workspace_folder",
      "0004_streamlion_purchases",
      "0023_controlled_free_pilot",
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
    await db
      .prepare("INSERT INTO streamlion_free_pilot_schema_v1 VALUES(1)")
      .run();
    const now = Date.now(),
      DAY = 86400000;
    await db
      .prepare(
        "INSERT INTO streamlion_free_pilot_policy_v1(mode,interest_open,admissions_open,active_cap,admission_cap,application_start,application_end,closes_at) VALUES('test',1,1,1,1,?,?,?)",
      )
      .bind(now - DAY, now + 20 * DAY, now + 40 * DAY)
      .run();
    await db
      .prepare(
        "INSERT INTO streamlion_free_pilot_admins_v1 VALUES('test','admin')",
      )
      .run();
    const tokens = {};
    for (const subject of ["admin", "a", "b", "c", "d", "e"]) {
      tokens[subject] = Buffer.from(subject.padEnd(32, "x")).toString(
        "base64url",
      );
      await db
        .prepare(
          "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          await hash(tokens[subject]),
          subject,
          subject + "@example.com",
          "fixture",
          now + DAY,
        )
        .run();
    }
    const req = (route, subject, body) =>
      mf.dispatchFetch("https://app.example/api/free-pilot/" + route, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "https://app.example",
          Cookie: "__Host-streamlion-session=" + tokens[subject],
          "X-StreamLion-Account": subject,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    for (const subject of ["a", "b", "c", "d", "e"])
      assert.equal(
        (
          await req("apply", subject, {
            name: subject,
            business: "Capture",
            fit: "Test job workflow",
            contact: true,
            marketing: false,
          })
        ).status,
        200,
      );
    const approvals = await Promise.all(
      ["a", "b", "c", "d", "e"].map((subject) =>
        req("admin/approve", "admin", { subject, reason: "Fit reviewed" }),
      ),
    );
    assert.equal(approvals.filter((r) => r.status === 200).length, 1);
    assert.equal(approvals.filter((r) => r.status === 409).length, 4);
    const row = await db
      .prepare(
        "SELECT google_subject FROM streamlion_free_pilot_accounts_v1 WHERE state='approved'",
      )
      .first();
    assert.equal(
      (
        await req("admin/invite", "admin", {
          subject: row.google_subject,
          reason: "Prepare invitation",
        })
      ).status,
      200,
    );
    const activations = await Promise.all(
      Array.from({ length: 5 }, () =>
        req("activate", row.google_subject, {
          ready: true,
          terms: "free-pilot-v1",
        }),
      ),
    );
    assert(activations.every((r) => r.status === 200));
    const times = await Promise.all(activations.map((r) => r.json()));
    assert.equal(new Set(times.map((r) => r.startsAt)).size, 1);
    assert.equal(new Set(times.map((r) => r.endsAt)).size, 1);
    const audit = await db
      .prepare(
        "SELECT action,COUNT(*) n FROM streamlion_free_pilot_audit_v1 GROUP BY action",
      )
      .all();
    assert.equal(audit.results.find((r) => r.action === "activate").n, 1);
    assert.equal(audit.results.find((r) => r.action === "approve").n, 1);
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
