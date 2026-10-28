// Synthetic end-to-end workload in the actual local Workers runtime. All
// outbound requests terminate in a closed fixture; no provider is contacted.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hash, seal } from "../server/google-auth.js";
import {
  CoordinationGoogle,
  EVENT_HEADERS,
  ARCHIVE_HEADERS,
} from "../server/coordination-google.js";
import { newClientJob, stableJSON } from "../src/client-workflow.js";
import { PROJECT_HEADERS, NOTE_HEADERS } from "../src/workbook.js";
import { createMaintenanceRequest } from "../server/coordination-schedule-auth.js";

const { values } = parseArgs({
  options: {
    bundle: { type: "string" },
    output: { type: "string" },
    "export-staging": { type: "string" },
  },
});
const root = new URL("../", import.meta.url).pathname;
const temp = await mkdtemp(join(tmpdir(), "streamlion-scale-"));
const origin = "https://streamlion.example.com";
const now = Date.now(),
  expiry = now + 86400000;
const bindings = {
  ENABLE_PERSISTENT_GOOGLE: "true",
  ENABLE_CLIENT_COORDINATION: "true",
  GOOGLE_CLIENT_SECRET: "synthetic",
  VITE_GOOGLE_CLIENT_ID: "synthetic",
  GOOGLE_AUTH_ORIGIN: origin,
  GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
  COORDINATION_SCHEDULER_ORIGIN: origin,
  COORDINATION_SCHEDULER_KEY: "7".repeat(64),
  STREAMLION_PAYMENTS_MODE: "test",
  STREAMLION_AI_CREDITS_MODE: "test",
  STREAMLION_CHECKOUT_MODE: "paused",
  STREAMLION_REQUIRE_LICENSE: "true",
  STREAMLION_REFUND_DAYS: "14",
  STRIPE_SECRET_KEY: "sk_test_synthetic",
  STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
  STRIPE_ACCOUNT_ID: "acct_synthetic",
  STRIPE_PRODUCT_ID: "prod_synthetic",
  STRIPE_PRICE_ID: "price_standard",
  STRIPE_LAUNCH_PRICE_ID: "price_launch",
  ENABLE_RESEND_EMAIL: "false",
  ENABLE_WEB_PUSH: "false",
};
const schema = new DatabaseSync(":memory:");
const workbooks = new Map(),
  accounts = [],
  reads = new Map();
let externalCalls = 0,
  unexpectedOutbound = 0,
  mf,
  socket;
const proxyCalls = { google: 0, stripe: 0 };
try {
  for (const file of (await readdir(new URL("../migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    schema.exec(
      await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"),
    );
  schema.exec(
    "UPDATE streamlion_coordination_policy_v1 SET active=1 WHERE mode='test'",
  );
  // Four independent provider workbooks, each with twenty commercial jobs
  // and three signed revisions per job. No cross-request verification cache.
  for (let account = 0; account < 4; account++) {
    const subject = "provider-" + account,
      cookie = String.fromCharCode(97 + account).repeat(43);
    const connection = {
      id: "connection-" + account,
      google_subject: subject,
      mode: "test",
      workbook_id: "book-" + account,
      folder_id: "folder-" + account,
      credentials: "",
      client_brand: "Synthetic provider",
      expires_at: expiry,
      revoked: 0,
    };
    const credentials = {
      accessToken: "synthetic",
      refreshToken: "synthetic",
      expiresAt: expiry,
    };
    connection.credentials = await seal(bindings, credentials, connection.id);
    const session = await hash(cookie);
    schema
      .prepare(
        "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,workbook_id,folder_id,expires_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        session,
        subject,
        "provider@example.com",
        await seal(bindings, credentials, session),
        connection.workbook_id,
        connection.folder_id,
        expiry,
      );
    schema
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES(?,'test',?,'synthetic@example.com','price_standard','prod_synthetic',3995,'usd','paid',?,?,?)",
      )
      .run("core-" + account, subject, now, expiry, now);
    schema
      .prepare(
        "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at,revoked) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(...Object.values(connection));
    const rows = [
      [PROJECT_HEADERS],
      [NOTE_HEADERS],
      [EVENT_HEADERS],
      [ARCHIVE_HEADERS],
    ];
    const signer = new CoordinationGoogle(bindings, connection);
    for (let jobIndex = 0; jobIndex < 20; jobIndex++) {
      const id = "job-" + account + "-" + jobIndex;
      const job = newClientJob({
        id,
        provider: subject,
        clientEmail: "client@example.com",
        title: "Commercial office survey " + jobIndex,
        now,
      });
      Object.assign(job.fields, {
        address: "100 Example Avenue",
        scope:
          "Capture reception, circulation routes, twenty offices, four meeting rooms, plant rooms and accessible public areas. Measure door openings, ceiling heights, corridor pinch points and specified wall runs. Preserve exclusions and access restrictions. ".repeat(
            10,
          ),
        deliverables:
          "Reviewed scan links, annotated floor plan, room measurements and exception report",
        accessInstructions:
          "Meet the facilities manager. Occupied offices require escort; plant rooms remain locked until approved.",
      });
      for (let revision = 0; revision < 3; revision++) {
        const current = { ...job, revision, updatedAt: now + revision };
        const event = {
          id: id + "-" + revision,
          jobId: id,
          revision,
          parent: revision - 1,
          at: current.updatedAt,
          actor: "provider",
          action: revision ? "edit" : "create",
          job: current,
        };
        rows[2].push([
          event.id,
          id,
          revision,
          revision - 1,
          event.at,
          event.actor,
          event.action,
          stableJSON(current),
          await signer.signature(event),
        ]);
      }
      schema
        .prepare(
          "INSERT INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) VALUES(?,?,?,?,?)",
        )
        .run(
          id,
          connection.id,
          id,
          await seal(bindings, "client@example.com", "job-email:" + id),
          now,
        );
    }
    const clientCookie = String.fromCharCode(107 + account).repeat(43);
    schema
      .prepare(
        "INSERT INTO streamlion_coordination_sessions_v1 VALUES(?,?,?,0)",
      )
      .run(await hash(clientCookie), "job-" + account + "-0", expiry);
    workbooks.set(connection.workbook_id, rows);
    accounts.push({
      subject,
      cookie,
      clientCookie,
      book: connection.workbook_id,
    });
  }
  if (values["export-staging"]) {
    assert.ok(
      values.bundle,
      "staging export requires an explicitly selected bundle",
    );
    const directory = values["export-staging"];
    const { mkdir } = await import("node:fs/promises");
    await mkdir(directory, { recursive: true });
    const quote = (value) =>
      value === null
        ? "NULL"
        : typeof value === "number"
          ? String(value)
          : "'" + String(value).replaceAll("'", "''") + "'";
    let sql = "-- SYNTHETIC QA DATABASE ONLY. Never apply to production.\n";
    for (const table of schema
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      )
      .all())
      for (const row of schema
        .prepare('SELECT * FROM "' + table.name + '"')
        .all())
        sql +=
          'INSERT OR REPLACE INTO "' +
          table.name +
          '" VALUES(' +
          Object.values(row).map(quote).join(",") +
          ");\n";
    await writeFile(join(directory, "seed.sql"), sql);
    await writeFile(
      join(directory, "fixture.json"),
      JSON.stringify({
        bindings,
        accounts,
        workbooks: [...workbooks].map(([book, rows]) => [
          book,
          JSON.stringify({ valueRanges: rows.map((values) => ({ values })) }),
        ]),
      }),
    );
    console.log(
      JSON.stringify({
        exported: true,
        providers: accounts.length,
        synthetic: true,
        externalProviderCalls: 0,
      }),
    );
    process.exitCode = 0;
  } else {
    let bundlePath = values.bundle;
    if (!bundlePath) {
      execFileSync(
        "npx",
        [
          "--no-install",
          "wrangler",
          "pages",
          "functions",
          "build",
          "--outdir=" + temp,
          "--compatibility-flags=nodejs_compat",
        ],
        {
          cwd: root,
          stdio: "pipe",
          env: {
            ...process.env,
            WRANGLER_LOG_PATH: join(temp, "wrangler.log"),
          },
        },
      );
      bundlePath = join(temp, "index.js");
    }
    const bundle = await build({
      stdin: {
        contents: `export default {async fetch(request,env,ctx){const w=await import(${JSON.stringify(bundlePath)});return w.default.fetch(request,env,ctx)}}`,
        resolveDir: root,
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      external: ["node:*"],
      target: "es2022",
    });
    mf = new Miniflare(
      convertV4MiniflareOptions({
        name: "scale",
        modules: true,
        compatibilityDate: "2026-09-23",
        compatibilityFlags: ["nodejs_compat"],
        script: bundle.outputFiles[0].text,
        bindings,
        d1Databases: ["GOOGLE_SESSIONS"],
        inspectorPort: 0,
        serviceBindings: { ASSETS: () => new Response("synthetic asset") },
        outboundService: async (request) => {
          const url = new URL(request.url);
          if (
            url.origin === "https://sheets.googleapis.com" &&
            url.pathname.endsWith("/values:batchGet")
          ) {
            proxyCalls.google++;
            const book = url.pathname.split("/")[3],
              rows = workbooks.get(book);
            assert.ok(rows, "unknown synthetic workbook");
            reads.set(book, (reads.get(book) || 0) + 1);
            return Response.json({
              valueRanges: rows.map((values) => ({ values })),
            });
          }
          if (
            url.origin === "https://api.stripe.com" &&
            request.method === "GET"
          ) {
            proxyCalls.stripe++;
            if (url.pathname === "/v1/account")
              return Response.json({ id: "acct_synthetic" });
            if (
              ["/v1/prices/price_standard", "/v1/prices/price_launch"].includes(
                url.pathname,
              )
            )
              return Response.json({
                id: url.pathname.split("/").at(-1),
                active: true,
                livemode: false,
                type: "one_time",
                currency: "usd",
                unit_amount: url.pathname.endsWith("price_launch")
                  ? 2996
                  : 3995,
                product: {
                  id: "prod_synthetic",
                  active: true,
                  metadata: { app: "streamlion" },
                },
              });
          }
          unexpectedOutbound++;
          throw new Error(
            "Unexpected outbound request blocked; no network fallback.",
          );
        },
      }),
    );
    const db = await mf.getD1Database("GOOGLE_SESSIONS");
    const ddl = schema
      .prepare(
        "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      )
      .all();
    const batch = async (statements) => {
      for (let i = 0; i < statements.length; i += 40)
        await db.batch(statements.slice(i, i + 40));
    };
    await batch(
      ddl
        .filter((x) => ["table", "index"].includes(x.type))
        .map((x) => db.prepare(x.sql)),
    );
    for (const table of ddl.filter((x) => x.type === "table")) {
      const rows = schema.prepare('SELECT * FROM "' + table.name + '"').all();
      await batch(
        rows.map((row) =>
          db
            .prepare(
              'INSERT INTO "' +
                table.name +
                '" VALUES(' +
                Object.keys(row)
                  .map(() => "?")
                  .join(",") +
                ")",
            )
            .bind(...Object.values(row)),
        ),
      );
    }
    await batch(
      ddl
        .filter((x) => ["trigger", "view"].includes(x.type))
        .map((x) => db.prepare(x.sql)),
    );
    const inspector = await mf.getInspectorURL(),
      listing = new URL(inspector);
    listing.protocol = "http:";
    listing.pathname = "/json/list";
    const targets = await (await fetch(listing)).json();
    socket = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        message.error
          ? waiter.reject(new Error(message.error.message))
          : waiter.resolve(message.result);
      }
    };
    const command = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    await command("Profiler.enable");
    await command("Profiler.setSamplingInterval", { interval: 100 });
    const scenarios = [];
    const call = async (path, init = {}) => {
      const start = performance.now(),
        response = await mf.dispatchFetch(origin + path, init),
        text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
        bytes: Buffer.byteLength(text),
        wallMs: performance.now() - start,
      };
    };
    const measure = async (name, tasks, concurrency = 1) => {
      await command("Profiler.start");
      const results = [];
      for (let i = 0; i < tasks.length; i += concurrency)
        results.push(
          ...(await Promise.all(
            tasks.slice(i, i + concurrency).map((task) => task()),
          )),
        );
      const { profile } = await command("Profiler.stop"),
        times = results.map((x) => x.wallMs).sort((a, b) => a - b);
      if (values.output)
        await writeFile(
          values.output + "." + name + ".cpuprofile",
          JSON.stringify(profile),
        );
      const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
      const sampledCpuUs = (profile.samples || []).reduce(
        (total, id, i) =>
          total +
          (["(idle)", "(root)"].includes(nodes.get(id).callFrame.functionName)
            ? 0
            : profile.timeDeltas[i]),
        0,
      );
      const heap = await command("Runtime.getHeapUsage");
      scenarios.push({
        name,
        requests: tasks.length,
        maxConcurrency: concurrency,
        p50WallMs:
          Math.round(times[Math.ceil(times.length * 0.5) - 1] * 100) / 100,
        p95WallMs:
          Math.round(times[Math.ceil(times.length * 0.95) - 1] * 100) / 100,
        responseBytesMax: Math.max(...results.map((x) => x.bytes)),
        sampledCpuTotalMs: Math.round(sampledCpuUs / 10) / 100,
        workerHeapUsedMiB: Math.round(heap.usedSize / 10485.76) / 100,
      });
      return results;
    };
    await measure("cold-health", [
      async () => {
        const r = await call("/api/health");
        assert.equal(r.body.status, "ready");
        return r;
      },
    ]);
    await measure(
      "warm-health",
      Array.from({ length: 12 }, () => async () => {
        const r = await call("/api/health");
        assert.equal(r.status, 200);
        return r;
      }),
      4,
    );
    await measure(
      "paused-checkout",
      accounts.map((a) => async () => {
        const r = await call("/api/purchase/checkout", {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: "__Host-streamlion-session=" + a.cookie,
            "X-StreamLion-Account": a.subject,
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        assert.equal(r.status, 403);
        return r;
      }),
      4,
    );
    const quote = await call("/api/purchase/config");
    assert.equal(quote.status, 200);
    assert.equal(quote.body.checkoutMode, "paused");
    assert.equal(quote.body.enabled, false);
    const providerResults = await measure(
      "four-providers-signed-history",
      accounts.map((a) => async () => {
        const r = await call("/api/coordination/provider/jobs", {
          headers: { Cookie: "__Host-streamlion-session=" + a.cookie },
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.jobs.length, 20);
        assert.ok(r.body.jobs.every((j) => j.provider === a.subject));
        return r;
      }),
      4,
    );
    const beforePoll = proxyCalls.google;
    await measure(
      "authorized-unchanged-poll",
      accounts.map((a, i) => async () => {
        const r = await call(
          "/api/coordination/provider/jobs?refresh=" +
            providerResults[i].body.refresh.token,
          { headers: { Cookie: "__Host-streamlion-session=" + a.cookie } },
        );
        assert.equal(r.body.unchanged, true);
        return r;
      }),
      4,
    );
    assert.equal(
      proxyCalls.google,
      beforePoll,
      "unchanged authorized poll must not reread Google",
    );
    await measure(
      "four-client-viewers",
      accounts.map((a) => async () => {
        const r = await call("/api/coordination/client/job", {
          headers: { Cookie: "__Host-streamlion-client=" + a.clientCookie },
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.job.id, "job-" + accounts.indexOf(a) + "-0");
        return r;
      }),
      4,
    );
    // Alter one signed payload between requests. A new adapter must reject it.
    const firstRows = workbooks.get(accounts[0].book),
      original = firstRows[2][1][7];
    firstRows[2][1][7] = original.replace(
      "Commercial office",
      "Altered office",
    );
    const tamper = await call("/api/coordination/provider/jobs", {
      headers: { Cookie: "__Host-streamlion-session=" + accounts[0].cookie },
    });
    assert.equal(tamper.status, 409);
    assert.match(tamper.body.error, /signature/);
    firstRows[2][1][7] = original;
    let maintenanceRequest;
    await measure("signed-idle-maintenance", [
      async () => {
        maintenanceRequest = await createMaintenanceRequest(
          bindings,
          Date.now(),
        );
        const r = await call("/api/coordination-maintenance", {
          method: "POST",
          headers: maintenanceRequest.headers,
          body: await maintenanceRequest.text(),
        });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.sent, 0);
        assert.equal(r.body.recovered, 0);
        return r;
      },
    ]);
    const replay = await call("/api/coordination-maintenance", {
      method: "POST",
      headers: maintenanceRequest.headers,
      body: JSON.stringify({ mode: "test" }),
    });
    assert.equal(replay.status, 409);
    assert.equal(unexpectedOutbound, 0);
    assert.equal(externalCalls, 0);
    const receipt = {
      passed: true,
      runtime: "local workerd and real isolated D1",
      externalProviderCalls: externalCalls,
      syntheticProxyCalls: proxyCalls,
      workload: {
        providers: 4,
        jobsPerProvider: 20,
        signedEventsPerWorkbook: 60,
        independentClientViewers: 4,
        checkout: "paused",
        signatureTamperRejected: true,
        maintenanceReplayRejected: true,
        unchangedPollAvoidsGoogle: true,
      },
      scenarios,
      limitation:
        "Local Workers CPU sampling and heap usage are diagnostic estimates, not production CPU quantiles or full isolate memory. Stubbed Google/Stripe calls exercise serialization and authorization but exclude real provider latency/quotas. Does not certify production scale, concurrent-user maxima, plan eligibility or a full-day error window.",
    };
    if (values.output)
      await writeFile(values.output, JSON.stringify(receipt, null, 2) + "\n");
    console.log(JSON.stringify(receipt, null, 2));
  }
} finally {
  socket?.close();
  await mf?.dispose();
  schema.close();
  await rm(temp, { recursive: true, force: true });
}
