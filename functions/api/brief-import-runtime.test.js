import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hash } from "../../server/google-auth.js";
import { intakeFor } from "../../src/project-schema.js";

test("owner brief preparation completes and refunds correctly with real D1 trigger metadata", async () => {
  const clock = Date.now();
  const project = intakeFor({
    title: "Synthetic NYC venue",
    scope: "Photograph the stage and measure the entry door.",
    deliverables: "Stage photographs and recorded door measurements",
  });
  const bundle = await build({
    stdin: {
      contents: `
        import { handleBriefImport } from './server/brief-import.js';
        let calls = 0;
        export default { async fetch(request, env, ctx) {
          const settings = {
            GOOGLE_SESSIONS: env.DB, GOOGLE_AUTH_ORIGIN: 'https://app.example',
            GOOGLE_TOKEN_ENCRYPTION_KEY: '${Buffer.alloc(32, 4).toString("base64url")}',
            OPENAI_API_KEY: 'mock-only', STREAMLION_PAYMENTS_MODE: 'test',
            ENABLE_BRIEF_IMPORT: 'false', STREAMLION_BRIEF_IMPORT_COST_APPROVED: 'false',
            STREAMLION_BRIEF_IMPORT_QA_ENABLED: 'true', STREAMLION_BRIEF_IMPORT_QA_COST_APPROVED: 'true',
            STREAMLION_BRIEF_IMPORT_QA_SUBJECT: 'a',
            STREAMLION_BRIEF_IMPORT_QA_START: '${new Date(clock).toISOString()}',
            STREAMLION_BRIEF_IMPORT_QA_UNTIL: '${new Date(clock + 86400000).toISOString()}'
          };
          const response = await handleBriefImport({request, env: settings, waitUntil: task => ctx.waitUntil(task)}, {
            now: () => ${clock},
            fetcher: async (url, init) => {
              calls++;
              if (JSON.parse(init.body).input[0].content.includes('synthetic provider failure')) return new Response('', {status: 503});
              return Response.json({status: 'completed', output: [{type:'message', content:[{type:'output_text', text:${JSON.stringify(JSON.stringify(project))}}]}]});
            }
          });
          const headers = new Headers(response.headers);
          headers.set('X-Test-Provider-Calls', String(calls));
          return new Response(response.body, {status: response.status, headers});
        }};
      `,
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
    for (const file of readdirSync(
      new URL("../../migrations/", import.meta.url),
    )
      .filter((f) => f.endsWith(".sql"))
      .sort())
      schema.exec(
        readFileSync(
          new URL("../../migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
    const ddl = schema
      .prepare(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,name",
      )
      .all();
    const db = await mf.getD1Database("DB");
    await db.batch(ddl.map((row) => db.prepare(row.sql)));
    await db
      .prepare(
        "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at,workbook_id) VALUES(?,'a','synthetic@example.test','encrypted',?,'book-a')",
      )
      .bind(await hash("a".repeat(43)), clock + 86400000)
      .run();
    await db
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES('test-order','test','a','synthetic@example.test','price','product',2996,'usd','paid',?,?,?)",
      )
      .bind(clock, clock + 86400000, clock)
      .run();
    await db
      .prepare(
        "INSERT INTO streamlion_credit_wallets_v1 VALUES('test','a',19000000)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO streamlion_promotional_wallets_v1 VALUES('test','a',0)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO streamlion_brief_policy_v1 VALUES('test',1,100000,100000,300000,300000,3)",
      )
      .run();
    const call = (route, body) =>
      mf.dispatchFetch("https://app.example/api/brief-import/" + route, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "https://app.example",
          Cookie: `__Host-streamlion-session=${"a".repeat(43)}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const config = await (await call("config")).json();
    assert.equal(config.ownerQA.attemptsRemaining, 3);
    const input = {
      requestId: "11111111-1111-4111-8111-111111111111",
      scope: config.scope,
      quoteKey: config.quoteKey,
      priceMicros: config.priceMicros,
      text: "Photograph the stage and measure the entry door at the synthetic venue.",
      sourceName: "Pasted text",
    };
    const response = await call("prepare", input);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).state, "complete");
    assert.equal(response.headers.get("X-Test-Provider-Calls"), "1");
    const repeat = await call("prepare", input);
    assert.equal((await repeat.json()).state, "complete");
    assert.equal(repeat.headers.get("X-Test-Provider-Calls"), "1");
    const recovered = await call("result?id=" + input.requestId);
    assert.deepEqual((await recovered.json()).project, project);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode='test' AND google_subject='a'",
          )
          .first()
      ).balance_micros,
      18900000,
    );
    const failed = await call("prepare", {
      ...input,
      requestId: "22222222-2222-4222-8222-222222222222",
      text: "synthetic provider failure",
    });
    assert.equal((await failed.json()).state, "failed");
    assert.equal(failed.headers.get("X-Test-Provider-Calls"), "2");
    assert.equal(
      (
        await db
          .prepare(
            "SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode='test' AND google_subject='a'",
          )
          .first()
      ).balance_micros,
      18900000,
    );
    const after = await (await call("config")).json();
    assert.equal(after.ownerQA.attemptsRemaining, 1);
  } finally {
    schema.close();
    await mf.dispose();
  }
});
