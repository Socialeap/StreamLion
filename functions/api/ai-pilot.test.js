import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  handleAI,
  reserveTurn,
  finishTurn,
  expireTurns,
} from "../../server/ai-pilot.js";
import { hash, seal } from "../../server/google-auth.js";
import {
  streamAnswer,
  synthesize,
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
  assert.equal(payload.max_output_tokens, 300);
  assert.equal(payload.tools, undefined);
  assert.equal(JSON.parse(calls[1].options.body).preset_voice, "af_heart");
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
  const req = (
    path = "/answer",
    body = {
      projectId: "project",
      question: "What is the name of the location?",
      requestId: uuid,
      speech: true,
      priceMicros: 12500,
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
      ...(path === "/config" ? {} : { body: JSON.stringify(body) }),
    });
  return { sql, env, req };
}
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
      events.map((e) => e.type),
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
