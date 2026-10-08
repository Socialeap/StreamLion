import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { createMaintenanceRequest } from "../../server/coordination-schedule-auth.js";
import { handleScheduledCoordination } from "../../server/coordination-scheduled-request.js";

const now = 1791417600000;
const envSettings = {
  COORDINATION_SCHEDULER_ORIGIN: "https://streamlion.example.com",
  GOOGLE_AUTH_ORIGIN: "https://streamlion.example.com",
  COORDINATION_SCHEDULER_KEY: "ab".repeat(32),
  STREAMLION_PAYMENTS_MODE: "test",
};
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE streamlion_coordination_rates_v1(key TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL)",
  );
  const env = {
    ...envSettings,
    GOOGLE_SESSIONS: {
      prepare: (sql) => ({
        bind: (...args) => ({
          run: async () => {
            const result = db.prepare(sql).run(...args);
            return { meta: { changes: Number(result.changes) } };
          },
        }),
      }),
    },
  };
  let calls = 0;
  const options = {
    now,
    ready: async () => true,
    maintain: async () => {
      calls++;
      return { recovered: 0, sent: 0 };
    },
  };
  return {
    env,
    options,
    calls: () => calls,
    rows: () =>
      db
        .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_rates_v1")
        .get().n,
    close: () => db.close(),
  };
}
test("signed scheduler callbacks claim durable nonce and minute slot; duplicate concurrency cannot repeat work", async () => {
  const f = fixture();
  try {
    const request = await createMaintenanceRequest(f.env, now);
    assert.equal(request.redirect, "manual");
    const responses = await Promise.all(
      [request.clone(), request.clone()].map((request) =>
        handleScheduledCoordination({ request, env: f.env }, f.options),
      ),
    );
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    assert.equal(f.calls(), 1);
    assert.equal(f.rows(), 2);
    const another = await createMaintenanceRequest(f.env, now);
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: another, env: f.env },
          f.options,
        )
      ).status,
      409,
    );
    assert.equal(f.calls(), 1);
    const next = await createMaintenanceRequest(f.env, now + 60000);
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: next, env: f.env },
          { ...f.options, now: now + 60000 },
        )
      ).status,
      200,
    );
    assert.equal(f.calls(), 2);
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: request.clone(), env: f.env },
          { ...f.options, now: now + 60000 },
        )
      ).status,
      409,
    );
    assert.equal(f.calls(), 2);
  } finally {
    f.close();
  }
});
test("scheduler rejects unsigned, modified, expired, future, cross-origin and cross-mode requests before durable state or work", async () => {
  const f = fixture();
  try {
    const signed = await createMaintenanceRequest(f.env, now);
    const cases = [
      new Request(signed.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
      new Request(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: '{"mode":"live"}',
      }),
      new Request("https://other.example.com/api/coordination-maintenance", {
        method: "POST",
        headers: signed.headers,
        body: await signed.clone().text(),
      }),
      new Request(signed.url + "?force=1", {
        method: "POST",
        headers: signed.headers,
        body: await signed.clone().text(),
      }),
      await createMaintenanceRequest(f.env, now - 121000),
      await createMaintenanceRequest(f.env, now + 121000),
      await createMaintenanceRequest(
        { ...f.env, STREAMLION_PAYMENTS_MODE: "live" },
        now,
      ),
      await createMaintenanceRequest(
        { ...f.env, COORDINATION_SCHEDULER_KEY: "cd".repeat(32) },
        now,
      ),
    ];
    for (const request of cases)
      assert.equal(
        (await handleScheduledCoordination({ request, env: f.env }, f.options))
          .status,
        401,
      );
    assert.equal(f.calls(), 0);
    assert.equal(f.rows(), 0);
  } finally {
    f.close();
  }
});
test("scheduler fails closed for missing configuration, disabled policy and malformed or oversized input", async () => {
  const f = fixture();
  try {
    const request = await createMaintenanceRequest(f.env, now);
    assert.equal(
      (
        await handleScheduledCoordination(
          {
            request: request.clone(),
            env: { ...f.env, COORDINATION_SCHEDULER_KEY: "" },
          },
          f.options,
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: request.clone(), env: f.env },
          { ...f.options, ready: async () => false },
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: new Request(request.url), env: f.env },
          f.options,
        )
      ).status,
      405,
    );
    const oversized = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: "x".repeat(129),
    });
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: oversized, env: f.env },
          f.options,
        )
      ).status,
      401,
    );
    assert.equal(f.calls(), 0);
    assert.equal(f.rows(), 0);
    await assert.rejects(
      createMaintenanceRequest(
        {
          ...f.env,
          COORDINATION_SCHEDULER_ORIGIN: "http://streamlion.example.com",
        },
        now,
      ),
    );
    await assert.rejects(
      createMaintenanceRequest(
        { ...f.env, STREAMLION_PAYMENTS_MODE: "disabled" },
        now,
      ),
    );
  } finally {
    f.close();
  }
});
test("uncertain maintenance failures cannot be replayed; the next cron can resume durable recovery", async () => {
  const f = fixture();
  try {
    const request = await createMaintenanceRequest(f.env, now);
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: request.clone(), env: f.env },
          {
            ...f.options,
            maintain: async () => {
              throw Error("synthetic failure");
            },
          },
        )
      ).status,
      503,
    );
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: request.clone(), env: f.env },
          f.options,
        )
      ).status,
      409,
    );
    assert.equal(f.calls(), 0);
    const next = await createMaintenanceRequest(f.env, now + 60000);
    assert.equal(
      (
        await handleScheduledCoordination(
          { request: next, env: f.env },
          { ...f.options, now: now + 60000 },
        )
      ).status,
      200,
    );
    assert.equal(f.calls(), 1);
  } finally {
    f.close();
  }
});

test("scheduler authentication and atomic claims work in the actual Workers runtime", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import {createMaintenanceRequest} from './server/coordination-schedule-auth.js';
        import {handleScheduledCoordination} from './server/coordination-scheduled-request.js';
        export default {async fetch(_request,env) {
          const settings={COORDINATION_SCHEDULER_ORIGIN:'https://streamlion.example.com',GOOGLE_AUTH_ORIGIN:'https://streamlion.example.com',COORDINATION_SCHEDULER_KEY:'${envSettings.COORDINATION_SCHEDULER_KEY}',STREAMLION_PAYMENTS_MODE:'test',GOOGLE_SESSIONS:env.DB};
          return handleScheduledCoordination({request:await createMaintenanceRequest(settings,${now}),env:settings},{now:${now},ready:async()=>true,maintain:async()=>({sent:0,recovered:0})});
        }};
      `,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
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
  try {
    const db = await mf.getD1Database("DB");
    await db.exec(
      "CREATE TABLE streamlion_coordination_rates_v1(key TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL)",
    );
    const first = await mf.dispatchFetch("http://localhost/run");
    assert.equal(first.status, 200, await first.clone().text());
    assert.deepEqual(await first.json(), { sent: 0, recovered: 0 });
    assert.equal((await mf.dispatchFetch("http://localhost/run")).status, 409);
  } finally {
    await mf.dispose();
  }
});
