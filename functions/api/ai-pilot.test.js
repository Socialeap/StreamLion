import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  handleAI,
  reserveTurn,
  finishTurn,
  expireTurns,
  PILOT_CEILING,
} from "../../server/ai-pilot.js";
import { hash, seal } from "../../server/google-auth.js";
import {
  streamAnswer,
  synthesize,
  streamSpeech,
  responseEvents,
  projectContext,
  takePhrase,
} from "../../server/ai-providers.js";
import { TABS, rowFor, makeRevision } from "../../src/workbook.js";

function fixture() {
  const sql = new DatabaseSync(":memory:");
  for (const name of [
    "0001_google_sessions",
    "0002_google_request_limits",
    "0003_google_workspace_folder",
    "0007_streamlion_ai_pilot",
  ])
    sql.exec(
      readFileSync(
        new URL(`../../migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  sql.exec(
    "UPDATE streamlion_ai_policy_v1 SET active=1,daily_budget_micros=600000; INSERT INTO streamlion_ai_wallets_v1 VALUES('a',1,100000),('b',1,100000)",
  );
  const wrap = (query, args = []) => ({
    bind: (...values) => wrap(query, values),
    first: async () => sql.prepare(query).get(...args) || null,
    run: async () => ({
      meta: { changes: sql.prepare(query).run(...args).changes },
    }),
  });
  return { sql, db: { prepare: wrap } };
}
const stream = (events) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
const uuid = "11111111-1111-4111-8111-111111111111";

test("the cumulative allowance remains spent across days and failures; concurrent final attempts reserve only once", async () => {
  const { sql, db } = fixture();
  const now = Date.now();
  try {
    for (let i = 0; i < PILOT_CEILING.attempts - 1; i++) {
      await reserveTurn(db, "a", `old-${i}`, 12500, now - 86400000 * (31 - i));
      await finishTurn(db, "a", `old-${i}`, "failed");
    }
    const results = await Promise.allSettled([
      reserveTurn(db, "a", "last-a", 12500, now),
      reserveTurn(db, "b", "last-b", 12500, now),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM streamlion_ai_turns_v1").get().n,
      30,
    );
    assert.equal(
      sql
        .prepare("SELECT SUM(balance_micros) n FROM streamlion_ai_wallets_v1")
        .get().n,
      187500,
    );
    await expireTurns(db, now + 300001);
    await assert.rejects(
      reserveTurn(db, "b", "tomorrow", 12500, now + 86400000),
      /pilot_exhausted/,
    );
    assert.equal(
      sql
        .prepare("SELECT SUM(balance_micros) n FROM streamlion_ai_wallets_v1")
        .get().n,
      200000,
    );
  } finally {
    sql.close();
  }
});

test("credits reserve atomically, duplicate and rejected accounts do not consume shared budget", async () => {
  const { sql, db } = fixture();
  await Promise.allSettled([
    reserveTurn(db, "a", uuid, 12500),
    reserveTurn(db, "a", "other", 12500),
  ]);
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM streamlion_ai_turns_v1").get().n,
    1,
  );
  assert.equal(
    sql
      .prepare(
        "SELECT balance_micros b FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
      )
      .get().b,
    87500,
  );
  await assert.rejects(reserveTurn(db, "a", uuid, 12500));
  await assert.rejects(reserveTurn(db, "missing", "none", 12500));
  assert.equal(
    sql
      .prepare("SELECT SUM(reserve_micros) n FROM streamlion_ai_turns_v1")
      .get().n,
    6000,
  );
  await reserveTurn(db, "b", uuid, 12500); // Request identities scoped to the authenticated owner.
  sql.close();
});
test("failure refunds once; provider reservation remains; completed answers cannot be refunded", async () => {
  const { sql, db } = fixture();
  await reserveTurn(db, "a", uuid, 12500);
  await finishTurn(db, "a", uuid, "failed");
  await finishTurn(db, "a", uuid, "failed");
  assert.equal(
    sql
      .prepare(
        "SELECT balance_micros b FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
      )
      .get().b,
    100000,
  );
  await reserveTurn(db, "a", "next", 12500);
  await finishTurn(db, "a", "next", "complete");
  await finishTurn(db, "a", "next", "failed");
  assert.equal(
    sql
      .prepare(
        "SELECT balance_micros b FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
      )
      .get().b,
    87500,
  );
  assert.equal(
    sql
      .prepare("SELECT SUM(reserve_micros) n FROM streamlion_ai_turns_v1")
      .get().n,
    12000,
  );
  sql.close();
});
test("daily budget, price changes, disabled wallets, rate limits and stale reservations fail safely", async () => {
  const { sql, db } = fixture(),
    now = Date.now();
  sql.exec("UPDATE streamlion_ai_policy_v1 SET daily_budget_micros=6000");
  await assert.rejects(reserveTurn(db, "a", uuid, 1));
  await reserveTurn(db, "a", uuid, 12500, now);
  await assert.rejects(reserveTurn(db, "b", "next", 12500, now));
  await expireTurns(db, now + 300001);
  assert.equal(
    sql.prepare("SELECT state FROM streamlion_ai_turns_v1").get().state,
    "failed",
  );
  await assert.rejects(reserveTurn(db, "b", "next", 12500, now + 300001)); // Unknown upstream spending never recycled.
  sql.exec(
    "UPDATE streamlion_ai_policy_v1 SET daily_budget_micros=600000; UPDATE streamlion_ai_wallets_v1 SET enabled=0",
  );
  await assert.rejects(reserveTurn(db, "b", "next", 12500));
  sql.close();
});
test("SSE parser handles split multibyte frames; missing completion and oversized answers reject", async () => {
  const bytes = new TextEncoder().encode(
    'data: {"type":"response.output_text.delta","delta":"café"}\r\n\r\n',
  );
  const body = new ReadableStream({
    start(c) {
      for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
      c.close();
    },
  });
  const events = [];
  for await (const event of responseEvents(body)) events.push(event);
  assert.equal(events[0].delta, "café");
  const fetcher = async () =>
    stream([{ type: "response.output_text.delta", delta: "partial" }]);
  await assert.rejects(async () => {
    for await (const _ of streamAnswer(
      {},
      "q",
      "{}",
      new AbortController().signal,
      fetcher,
    )) {
    }
  });
  assert.throws(() => projectContext({ text: "x".repeat(11000) }, []));
  assert.deepEqual(takePhrase("A sentence long enough to speak. Next"), [
    "A sentence long enough to speak. ",
    "Next",
  ]);
});
test("provider adapters use fixed endpoints, bounded output, no history retention and no tools", async () => {
  const calls = [],
    fetcher = async (url, options) => {
      calls.push({ url, options });
      return url.includes("openai")
        ? stream([
            { type: "response.output_text.delta", delta: "A recorded answer." },
            { type: "response.completed" },
          ])
        : Response.json({ audio: "UklGRg==" });
    };
  let answer = "";
  for await (const delta of streamAnswer(
    { OPENAI_API_KEY: "secret" },
    "What is its name?",
    "{}",
    new AbortController().signal,
    fetcher,
  ))
    answer += delta;
  assert.equal(answer, "A recorded answer.");
  assert.equal(
    await synthesize(
      { DEEPINFRA_API_KEY: "secret" },
      answer,
      new AbortController().signal,
      fetcher,
    ),
    "UklGRg==",
  );
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.model, "gpt-6-luna");
  assert.equal(payload.store, false);
  assert.equal(payload.max_output_tokens, 240);
  assert.deepEqual(payload.text, { verbosity: "low" });
  assert.match(payload.instructions, /exact recorded fractions/);
  assert.equal(payload.tools, undefined);
  assert.deepEqual(JSON.parse(calls[1].options.body).preset_voice, [
    "af_heart",
  ]);
  assert.equal(JSON.parse(calls[1].options.body).output_format, "wav");
});
async function routeFixture() {
  const { sql, db } = fixture();
  const env = {
    GOOGLE_SESSIONS: db,
    ENABLE_AI_PILOT: "true",
    OPENAI_API_KEY: "test-only",
    DEEPINFRA_API_KEY: "test-only",
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
  };
  const cookie = "a".repeat(43),
    sessionHash = await hash(cookie);
  sql
    .prepare(
      "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at,workbook_id) VALUES(?,?,?,?,?,?)",
    )
    .run(
      sessionHash,
      "a",
      "synthetic@example.test",
      await seal(
        env,
        { accessToken: "google-test", expiresAt: Date.now() + 3600000 },
        sessionHash,
      ),
      Date.now() + 3600000,
      "selected",
    );
  const preferenceScope = await hash(
    JSON.stringify(["ai-preference-v1", "a", "selected"]),
  );
  const req = (
    path = "/answer",
    body = {
      projectId: "project",
      question: "What is the name of the location?",
      requestId: uuid,
      speech: true,
      priceMicros: 12500,
      preferenceScope,
    },
    origin = "https://app.example",
  ) =>
    new Request(`https://app.example/api/ai${path}`, {
      method: path === "/config" ? "GET" : "POST",
      headers: {
        Cookie: `__Host-streamlion-session=${cookie}`,
        Origin: origin,
        "Content-Type": "application/json",
      },
      ...(path === "/config"
        ? {}
        : { body: JSON.stringify({ preferenceScope, ...body }) }),
    });
  return { sql, env, req, preferenceScope };
}

test("configuration explains missing prerequisites without provider calls, credit debits or reservations", async () => {
  const { sql, env, req, preferenceScope } = await routeFixture(),
    original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected fetch");
  };
  const config = async (overrides = {}, request = req("/config")) => {
    const response = await handleAI({ request, env: { ...env, ...overrides } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return response.json();
  };
  try {
    assert.deepEqual(await config(), {
      enabled: true,
      priceMicros: 12500,
      balanceMicros: 100000,
      preferenceScope,
    });
    assert.deepEqual(await config({ ENABLE_AI_PILOT: "false" }), {
      enabled: false,
      reason: "pilot_unavailable",
    });
    assert.deepEqual(await config({ OPENAI_API_KEY: "" }), {
      enabled: false,
      reason: "pilot_unavailable",
    });
    assert.deepEqual(
      await config({}, new Request("https://app.example/api/ai/config")),
      { enabled: false, reason: "connect_google" },
    );
    sql.exec("UPDATE streamlion_google_sessions_v1 SET workbook_id=''");
    assert.deepEqual(await config(), {
      enabled: false,
      reason: "select_workbook",
    });
    sql.exec(
      "UPDATE streamlion_google_sessions_v1 SET workbook_id='selected'; UPDATE streamlion_ai_policy_v1 SET active=0",
    );
    assert.deepEqual(await config(), {
      enabled: false,
      reason: "pilot_paused",
      priceMicros: 12500,
      balanceMicros: 100000,
      preferenceScope,
    });
    sql.exec(
      "UPDATE streamlion_ai_policy_v1 SET active=1; UPDATE streamlion_ai_wallets_v1 SET enabled=0 WHERE google_subject='a'",
    );
    assert.deepEqual(await config(), {
      enabled: false,
      reason: "account_not_enabled",
      preferenceScope,
    });
    sql.exec("UPDATE streamlion_ai_policy_v1 SET daily_budget_micros=0");
    assert.deepEqual(await config(), {
      enabled: false,
      reason: "pilot_unavailable",
      preferenceScope,
    });
    assert.equal(calls, 0);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM streamlion_ai_turns_v1").get().n,
      0,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT balance_micros b FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
        )
        .get().b,
      100000,
    );
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});

test("a changed account/workbook quote is rejected before Google or provider work", async () => {
  const { sql, env, req, preferenceScope } = await routeFixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected fetch");
  };
  try {
    sql.exec(
      "UPDATE streamlion_google_sessions_v1 SET workbook_id='different-workbook'",
    );
    const response = await handleAI({ env, request: req() });
    assert.equal(response.status, 409);
    assert.match(
      (await response.json()).error,
      /Google account or workbook changed/,
    );
    const config = await (
      await handleAI({ env, request: req("/config") })
    ).json();
    assert.match(config.preferenceScope, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(config.preferenceScope, preferenceScope);
    sql.exec(
      "UPDATE streamlion_google_sessions_v1 SET workbook_id='selected',google_subject='b'",
    );
    const ownerConfig = await (
      await handleAI({ env, request: req("/config") })
    ).json();
    assert.notEqual(ownerConfig.preferenceScope, preferenceScope);
    assert.equal((await handleAI({ env, request: req() })).status, 409);
    assert.equal(calls, 0);
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM streamlion_ai_turns_v1").get().n,
      0,
    );
  } finally {
    sql.close();
    globalThis.fetch = original;
  }
});

test("an exhausted pilot reports operator action and rejects before any upstream calls or charges", async () => {
  const { sql, env, req } = await routeFixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected fetch");
  };
  try {
    for (let i = 0; i < PILOT_CEILING.attempts; i++) {
      await reserveTurn(
        env.GOOGLE_SESSIONS,
        "a",
        `past-${i}`,
        12500,
        Date.now() - 86400000 * (31 - i),
      );
      await finishTurn(env.GOOGLE_SESSIONS, "a", `past-${i}`, "failed");
    }
    const config = await (
      await handleAI({ env, request: req("/config") })
    ).json();
    assert.equal(config.enabled, false);
    assert.equal(config.reason, "pilot_exhausted");
    const response = await handleAI({ env, request: req() });
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /allowance has been used/);
    assert.equal(calls, 0);
    assert.equal(
      sql
        .prepare(
          "SELECT balance_micros n FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
        )
        .get().n,
      100000,
    );
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM streamlion_ai_turns_v1").get().n,
      30,
    );
  } finally {
    sql.close();
    globalThis.fetch = original;
  }
});
test("disabled pilot, cross-origin, missing authentication and missing credits never call providers", async () => {
  const { sql, env, req } = await routeFixture();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("unexpected fetch");
  };
  try {
    assert.equal(
      (
        await handleAI({
          request: req(),
          env: { ...env, ENABLE_AI_PILOT: "false" },
        })
      ).status,
      503,
    );
    assert.equal(
      (
        await handleAI({
          request: req("/answer", undefined, "https://evil.example"),
          env,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await handleAI({
          request: new Request("https://app.example/api/ai/answer", {
            method: "POST",
            headers: { Origin: "https://app.example" },
          }),
          env,
        })
      ).status,
      401,
    );
    sql.exec("DELETE FROM streamlion_ai_wallets_v1");
    assert.equal((await handleAI({ request: req(), env })).status, 403);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});
test("end-to-end route reads the selected workbook, streams text and speech, charges once and refuses retry", async () => {
  const { sql, env, req } = await routeFixture(),
    original = globalThis.fetch,
    calls = [];
  const project = makeRevision(
    {
      title: "Synthetic venue",
      address: "123 Example Street",
      reviewState: "reviewed",
    },
    null,
    "project",
  );
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.includes("sheets.googleapis.com")) {
      assert.ok(url.includes("/selected"));
      if (url.includes("batchGet"))
        return Response.json({
          valueRanges: Object.keys(TABS).map((tab) => ({
            values: [
              TABS[tab],
              ...(tab === "Projects" ? [rowFor(project, TABS.Projects)] : []),
            ],
          })),
        });
      return Response.json({
        properties: { title: "Synthetic workbook" },
        sheets: Object.keys(TABS).map((title) => ({
          properties: { title, gridProperties: { rowCount: 20 } },
        })),
      });
    }
    if (url.includes("openai"))
      return stream([
        {
          type: "response.output_text.delta",
          delta: "The location is Synthetic venue. Source: Project name.",
        },
        { type: "response.completed" },
      ]);
    return Response.json({ audio: "UklGRg==" });
  };
  const tasks = [];
  try {
    const response = await handleAI({
      request: req(),
      env,
      waitUntil: (task) => tasks.push(task),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).trim().split("\n").map(JSON.parse);
    await Promise.all(tasks);
    assert.deepEqual(
      events.filter((e) => e.type !== "text_done").map((e) => e.type),
      ["start", "text", "audio", "audio", "done"],
    );
    assert.equal(events.at(-1).balanceMicros, 87500);
    const before = calls.length;
    assert.equal((await handleAI({ request: req(), env })).status, 409);
    assert.equal(calls.length, before);
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});

test("commercial answers debit only live purchased credits at the approved 30 percent markup", async () => {
  const { sql, env, req } = await routeFixture(),
    original = globalThis.fetch,
    calls = [];
  for (const name of [
    "0004_streamlion_purchases",
    "0005_streamlion_launch_200",
    "0008_streamlion_ai_credits",
  ])
    sql.exec(
      readFileSync(
        new URL(`../../migrations/${name}.sql`, import.meta.url),
        "utf8",
      ),
    );
  sql.exec(`INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at)
    VALUES('paid-core','live','a','synthetic@example.test','price_core','prod_core',3995,'usd','paid',1,2,1);
    UPDATE streamlion_credit_policy_v1 SET active=1,cost_micros=6000,daily_budget_micros=6000,total_budget_micros=6000,daily_requests=1 WHERE mode='live';
    INSERT INTO streamlion_credit_wallets_v1 VALUES('live','a',100000),('test','a',10000000);`);
  Object.assign(env, {
    STREAMLION_AI_CREDITS_MODE: "live",
    STREAMLION_PAYMENTS_MODE: "live",
    STREAMLION_AI_COST_APPROVED: "true",
    STREAMLION_LIVE_PAYMENTS_APPROVED: "true",
  });
  const project = makeRevision({ title: "Synthetic venue" }, null, "project");
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.includes("sheets.googleapis.com"))
      return url.includes("batchGet")
        ? Response.json({
            valueRanges: Object.keys(TABS).map((tab) => ({
              values: [
                TABS[tab],
                ...(tab === "Projects" ? [rowFor(project, TABS.Projects)] : []),
              ],
            })),
          })
        : Response.json({
            properties: { title: "Synthetic workbook" },
            sheets: Object.keys(TABS).map((title) => ({
              properties: { title, gridProperties: { rowCount: 20 } },
            })),
          });
    if (url.includes("openai"))
      return stream([
        {
          type: "response.output_text.delta",
          delta: "The location is Synthetic venue. Source: Project name.",
        },
        { type: "response.completed" },
      ]);
    return Response.json({ audio: "UklGRg==" });
  };
  const tasks = [];
  try {
    const config = await (
      await handleAI({ request: req("/config"), env })
    ).json();
    assert.equal(config.billing, "credits");
    assert.equal(config.priceMicros, 7800);
    assert.equal(calls.length, 0);
    const body = {
      projectId: "project",
      question: "What is the name of the location?",
      requestId: uuid,
      speech: true,
      priceMicros: 7800,
      preferenceScope: config.preferenceScope,
    };
    const answer = await handleAI({
      request: req("/answer", body),
      env,
      waitUntil: (task) => tasks.push(task),
    });
    assert.equal(answer.status, 200);
    const events = (await answer.text()).trim().split("\n").map(JSON.parse);
    await Promise.all(tasks);
    assert.equal(events.at(-1).balanceMicros, 92200);
    assert.equal(
      sql
        .prepare(
          "SELECT balance_micros b FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
        )
        .get().b,
      100000,
    );
    assert.equal(
      sql
        .prepare(
          "SELECT balance_micros b FROM streamlion_credit_wallets_v1 WHERE mode='test' AND google_subject='a'",
        )
        .get().b,
      10000000,
    );
    assert.equal(
      sql.prepare("SELECT COUNT(*) n FROM streamlion_ai_turns_v1").get().n,
      0,
    );
    const before = calls.length;
    assert.equal(
      (await handleAI({ request: req("/answer", body), env })).status,
      429,
    );
    const exhausted = await handleAI({
      request: req("/answer", {
        ...body,
        requestId: "22222222-2222-4222-8222-222222222222",
      }),
      env,
    });
    assert.equal(exhausted.status, 429);
    assert.equal(calls.length, before);
    sql.exec(
      "UPDATE streamlion_credit_policy_v1 SET active=0 WHERE mode='live'",
    );
    const paused = await (
      await handleAI({ request: req("/config"), env })
    ).json();
    assert.equal(paused.reason, "credits_not_active");
    assert.equal(calls.length, before);
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});

test("per-account minute limits and the global daily request cap reject before debit", async () => {
  const { sql, db } = fixture(),
    now = Date.now();
  for (let n = 0; n < 6; n++) {
    await reserveTurn(db, "a", `turn-${n}`, 12500, now);
    await finishTurn(db, "a", `turn-${n}`, "complete");
  }
  await assert.rejects(reserveTurn(db, "a", "seventh", 12500, now));
  assert.equal(
    sql
      .prepare(
        "SELECT balance_micros b FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
      )
      .get().b,
    25000,
  );
  sql.exec("UPDATE streamlion_ai_policy_v1 SET daily_requests=6");
  await assert.rejects(reserveTurn(db, "b", "global", 12500, now));
  assert.equal(
    sql.prepare("SELECT COUNT(*) n FROM streamlion_ai_turns_v1").get().n,
    6,
  );
  sql.close();
});

for (const scenario of [
  "incomplete-text",
  "speech-failure",
  "foreign-project",
  "changed-price",
])
  test(`route handles ${scenario} without hidden spending or false completion`, async () => {
    const { sql, env, req } = await routeFixture(),
      original = globalThis.fetch,
      tasks = [];
    let paidCalls = 0;
    const project = makeRevision(
      { title: "Synthetic venue", address: "123 Example Street" },
      null,
      scenario === "foreign-project" ? "someone-elses-project" : "project",
    );
    globalThis.fetch = async (url) => {
      if (url.includes("sheets.googleapis.com")) {
        if (url.includes("batchGet"))
          return Response.json({
            valueRanges: Object.keys(TABS).map((tab) => ({
              values: [
                TABS[tab],
                ...(tab === "Projects" ? [rowFor(project, TABS.Projects)] : []),
              ],
            })),
          });
        return Response.json({
          properties: { title: "Synthetic workbook" },
          sheets: Object.keys(TABS).map((title) => ({
            properties: { title, gridProperties: { rowCount: 20 } },
          })),
        });
      }
      paidCalls++;
      if (url.includes("openai"))
        return stream([
          { type: "response.output_text.delta", delta: "A short answer." },
          ...(scenario === "incomplete-text"
            ? []
            : [{ type: "response.completed" }]),
        ]);
      return new Response("provider private error", { status: 503 });
    };
    try {
      if (scenario === "changed-price")
        sql.exec("UPDATE streamlion_ai_policy_v1 SET price_micros=20000");
      const response = await handleAI({
        request: req(),
        env,
        waitUntil: (task) => tasks.push(task),
      });
      if (["foreign-project", "changed-price"].includes(scenario)) {
        assert.equal(
          response.status,
          scenario === "foreign-project" ? 404 : 409,
        );
        assert.equal(paidCalls, 0);
        assert.equal(
          sql.prepare("SELECT COUNT(*) n FROM streamlion_ai_turns_v1").get().n,
          0,
        );
      } else {
        const data = await response.text();
        await Promise.all(tasks);
        const events = data.trim().split("\n").map(JSON.parse);
        assert.ok(
          events.some(
            (e) =>
              e.type ===
              (scenario === "incomplete-text" ? "error" : "speech_error"),
          ),
        );
        assert.equal(
          events.some((e) => e.type === "done"),
          scenario !== "incomplete-text",
        );
        assert.equal(
          sql
            .prepare(
              "SELECT balance_micros b FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
            )
            .get().b,
          scenario === "incomplete-text" ? 100000 : 87500,
        );
        assert.doesNotMatch(data, /provider private error/);
        assert.equal(
          sql
            .prepare("SELECT SUM(reserve_micros) n FROM streamlion_ai_turns_v1")
            .get().n,
          6000,
        );
      }
    } finally {
      globalThis.fetch = original;
      sql.close();
    }
  });

test("PCM route completes text and credits before speech ends, cancels upstream on disconnect, and never retries", async () => {
  const { sql, env, req } = await routeFixture(),
    original = globalThis.fetch;
  const project = makeRevision({ title: "Synthetic venue" }, null, "project");
  let speechCalls = 0,
    pcm,
    cancelled = false;
  globalThis.fetch = async (url, options) => {
    if (url.includes("sheets.googleapis.com")) {
      return url.includes("batchGet")
        ? Response.json({
            valueRanges: Object.keys(TABS).map((tab) => ({
              values: [
                TABS[tab],
                ...(tab === "Projects" ? [rowFor(project, TABS.Projects)] : []),
              ],
            })),
          })
        : Response.json({
            properties: { title: "Synthetic workbook" },
            sheets: Object.keys(TABS).map((title) => ({
              properties: { title, gridProperties: { rowCount: 20 } },
            })),
          });
    }
    if (url.includes("api.openai.com"))
      return stream([
        { type: "response.output_text.delta", delta: "Synthetic venue. " },
        { type: "response.completed" },
      ]);
    speechCalls++;
    assert.equal(
      url,
      "https://api.deepinfra.com/v1/text-to-speech/af_heart/stream",
    );
    assert.equal(JSON.parse(options.body).output_format, "pcm");
    return new Response(
      new ReadableStream({
        start(c) {
          pcm = c;
          c.enqueue(new Uint8Array(2401));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "Content-Type": "audio/pcm" } },
    );
  };
  const tasks = [];
  try {
    const response = await handleAI({
      request: req("/answer", {
        projectId: "project",
        question: "Name?",
        requestId: uuid,
        speech: true,
        audioFormat: "pcm_s16le",
        priceMicros: 12500,
      }),
      env,
      waitUntil: (task) => tasks.push(task),
    });
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let pending = "",
      events = [];
    while (
      !events.some((e) => e.type === "text_done") ||
      !events.some((e) => e.type === "audio")
    ) {
      const { value } = await reader.read();
      pending += decoder.decode(value, { stream: true });
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        events.push(JSON.parse(pending.slice(0, end)));
        pending = pending.slice(end + 1);
      }
    }
    const audio = events.find((e) => e.type === "audio");
    assert.equal(audio.format, "pcm_s16le");
    assert.equal(audio.sampleRate, 24000);
    assert.equal(Buffer.from(audio.audio, "base64").length, 2400);
    assert.equal(
      events.find((e) => e.type === "text_done").balanceMicros,
      87500,
    );
    assert.equal(
      events.some((e) => e.type === "done"),
      false,
    );
    assert.equal(
      sql.prepare("SELECT state FROM streamlion_ai_turns_v1").get().state,
      "complete",
    );
    // Provider remains open; one odd network byte is retained, never sent as a partial sample.
    pcm.enqueue(new Uint8Array(9599));
    const next = await reader.read();
    assert.match(decoder.decode(next.value), /pcm_s16le/);
    await reader.cancel();
    await Promise.all(tasks);
    assert.equal(cancelled, true);
    assert.equal(speechCalls, 1);
    assert.equal(
      sql
        .prepare(
          "SELECT balance_micros FROM streamlion_ai_wallets_v1 WHERE google_subject='a'",
        )
        .get().balance_micros,
      87500,
    );
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});
