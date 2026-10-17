import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { hash } from "../../server/google-auth.js";
import { handleBriefImport, extractBrief } from "../../server/brief-import.js";
import { intakeFor } from "../../src/project-schema.js";
import { BRIEF_LIMITS, BRIEF_MODEL } from "../../src/brief-import-contract.js";
import { purgeBriefState } from "../../ops/session-cleanup.js";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const project = intakeFor({
  title: "Mock capture",
  address: "10 Example Street",
  scope: "Lobby and stairs",
  sourceNotes: "brief.pdf, page 1: Capture lobby and stairs",
  unresolved: "Visit date not provided",
});
const output = (value = project, overrides = {}) =>
  new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
      ...overrides,
    }),
  );
async function fixture(t, { migration = true } = {}) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  for (const name of readdirSync(new URL("../../migrations/", import.meta.url))
    .filter(
      (name) =>
        name.endsWith(".sql") && (migration || !name.startsWith("0016")),
    )
    .sort())
    sql.exec(
      readFileSync(
        new URL("../../migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  const wrap = (query, args = []) => ({
    bind: (...next) => wrap(query, next),
    first: async () => sql.prepare(query).get(...args) || null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => ({
      meta: { changes: sql.prepare(query).run(...args).changes },
    }),
  });
  const db = {
    prepare: wrap,
    batch: async (statements) => {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  let clock = Date.now(),
    calls = 0;
  const env = {
    GOOGLE_SESSIONS: db,
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64url"),
    OPENAI_API_KEY: "mock-only",
    ENABLE_BRIEF_IMPORT: "true",
    STREAMLION_BRIEF_IMPORT_COST_APPROVED: "true",
    STREAMLION_PAYMENTS_MODE: "live",
    STREAMLION_LIVE_PAYMENTS_APPROVED: "true",
    STREAMLION_AI_CREDITS_MODE: "test",
    ENABLE_AI_PILOT: "true",
  };
  for (const subject of ["a", "b"]) {
    sql
      .prepare(
        "INSERT INTO streamlion_google_sessions_v1(session_hash,google_subject,email,credentials,expires_at,workbook_id) VALUES(?,?,?,?,?,?)",
      )
      .run(
        await hash(subject.repeat(43)),
        subject,
        subject + "@example.test",
        "encrypted",
        clock + 7 * 86400000,
        "book-" + subject,
      );
    sql
      .prepare(
        "INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES(?,'live',?,?,'price','product',3995,'usd','paid',?,?,?)",
      )
      .run(
        subject,
        subject,
        subject + "@example.test",
        clock,
        clock + 1000,
        clock,
      );
    sql
      .prepare(
        "INSERT INTO streamlion_credit_wallets_v1 VALUES('live',?,1000000)",
      )
      .run(subject);
    sql
      .prepare(
        "INSERT INTO streamlion_promotional_wallets_v1 VALUES('live',?,50000)",
      )
      .run(subject);
  }
  const provider = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/responses");
    const data = JSON.parse(options.body);
    assert.equal(data.model, BRIEF_MODEL);
    assert.equal(data.store, false);
    assert.equal(data.service_tier, "default");
    assert.equal(data.text.format.strict, true);
    assert.equal(data.max_output_tokens, BRIEF_LIMITS.outputTokens);
    assert.equal(data.tools, undefined);
    assert(options.signal instanceof AbortSignal);
    return output();
  };
  const call = (route = "config", body, options = {}) =>
    handleBriefImport(
      {
        env,
        request: new Request("https://app.example/api/brief-import/" + route, {
          method: body ? "POST" : "GET",
          headers: {
            Origin: env.GOOGLE_AUTH_ORIGIN,
            Cookie: `__Host-streamlion-session=${(options.subject || "a").repeat(43)}`,
            "Content-Type": "application/json",
            ...options.headers,
          },
          ...(body
            ? { body: typeof body === "string" ? body : JSON.stringify(body) }
            : {}),
        }),
      },
      { fetcher: options.fetcher || provider, now: () => clock },
    );
  const activate = () =>
    sql.exec(
      "UPDATE streamlion_brief_policy_v1 SET active=1,price_micros=150000,reserve_micros=100000,daily_budget_micros=1000000,total_budget_micros=2000000,daily_requests=10 WHERE mode='live'",
    );
  const input = async (requestId = id) => {
    const quote = await (await call()).json();
    return {
      requestId,
      scope: quote.scope,
      quoteKey: quote.quoteKey,
      priceMicros: quote.priceMicros,
      text: "Capture the lobby and stairs at 10 Example Street.",
      sourceName: "brief.pdf",
    };
  };
  const balance = () =>
    sql
      .prepare(
        "SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode='live' AND google_subject='a'",
      )
      .get().balance_micros +
    sql
      .prepare(
        "SELECT balance_micros FROM streamlion_promotional_wallets_v1 WHERE mode='live' AND google_subject='a'",
      )
      .get().balance_micros;
  return {
    sql,
    db,
    env,
    call,
    activate,
    input,
    balance,
    calls: () => calls,
    advance: (ms) => (clock += ms),
    now: () => clock,
  };
}

test("migration is additive and inactive; missing migration or any disabled approval makes no provider call", async (t) => {
  const f = await fixture(t, { migration: false });
  const prior = f.sql
    .prepare("SELECT * FROM streamlion_credit_wallets_v1")
    .all();
  assert.equal((await (await f.call()).json()).enabled, false);
  f.sql.exec(
    readFileSync(
      new URL("../../migrations/0016_brief_import.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    f.sql.prepare("SELECT * FROM streamlion_credit_wallets_v1").all(),
    prior,
  );
  assert(
    f.sql
      .prepare("SELECT * FROM streamlion_brief_policy_v1")
      .all()
      .every(
        (p) => p.active === 0 && p.price_micros === 0 && p.reserve_micros === 0,
      ),
  );
  f.activate();
  for (const [key, value] of [
    ["ENABLE_BRIEF_IMPORT", undefined],
    ["STREAMLION_BRIEF_IMPORT_COST_APPROVED", "false"],
    ["STREAMLION_PAYMENTS_MODE", "test"],
    ["STREAMLION_LIVE_PAYMENTS_APPROVED", "false"],
    ["OPENAI_API_KEY", ""],
    ["GOOGLE_TOKEN_ENCRYPTION_KEY", "not-a-valid-32-byte-key"],
  ]) {
    const previous = f.env[key];
    f.env[key] = value;
    assert.equal((await (await f.call()).json()).enabled, false);
    assert.equal((await f.call("prepare", { requestId: id })).status, 503);
    f.env[key] = previous;
  }
  assert.equal(f.calls(), 0);
  assert.equal(f.balance(), 1050000);
});

function ownerQA(f) {
  Object.assign(f.env, {
    ENABLE_BRIEF_IMPORT: "false",
    STREAMLION_BRIEF_IMPORT_COST_APPROVED: "false",
    STREAMLION_PAYMENTS_MODE: "test",
    STREAMLION_LIVE_PAYMENTS_APPROVED: "false",
    STREAMLION_CHECKOUT_MODE: "owner_qa",
    STREAMLION_BRIEF_IMPORT_QA_ENABLED: "true",
    STREAMLION_BRIEF_IMPORT_QA_COST_APPROVED: "true",
    STREAMLION_BRIEF_IMPORT_QA_SUBJECT: "a",
    STREAMLION_BRIEF_IMPORT_QA_START: new Date(f.now()).toISOString(),
    STREAMLION_BRIEF_IMPORT_QA_UNTIL: new Date(
      f.now() + 86400000,
    ).toISOString(),
  });
  f.sql
    .exec(`INSERT INTO streamlion_credit_wallets_v1 VALUES('test','a',19000000);
    INSERT INTO streamlion_promotional_wallets_v1 VALUES('test','a',0);
    UPDATE streamlion_purchases_v1 SET mode='test' WHERE google_subject='a';
    UPDATE streamlion_brief_policy_v1 SET active=1,price_micros=100000,reserve_micros=100000,
      daily_budget_micros=300000,total_budget_micros=300000,daily_requests=3 WHERE mode='test'`);
}
const qaId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("owner QA uses only existing test credits and preserves live wallets and pilot settings", async (t) => {
  const f = await fixture(t);
  ownerQA(f);
  const modes = { ...f.env };
  const liveBalance = f.balance();
  const quote = await (await f.call()).json();
  assert.equal(quote.enabled, true);
  assert.equal(quote.priceMicros, 100000);
  assert.equal(quote.ownerQA.attemptsRemaining, 3);
  assert.equal(quote.ownerQA.expiresAt, f.env.STREAMLION_BRIEF_IMPORT_QA_UNTIL);
  const input = await f.input();
  assert.equal(
    (await (await f.call("prepare", input)).json()).state,
    "complete",
  );
  const row = f.sql.prepare("SELECT * FROM streamlion_brief_jobs_v1").get();
  assert.equal(row.mode, "test");
  assert.equal(row.promotional, 0);
  assert.equal(row.purchased, 100000);
  assert.equal(
    f.sql
      .prepare(
        "SELECT balance_micros b FROM streamlion_credit_wallets_v1 WHERE mode='test'",
      )
      .get().b,
    18900000,
  );
  assert.equal(f.balance(), liveBalance);
  assert.deepEqual(f.env, modes);
  assert.equal(
    (await (await f.call("prepare", input)).json()).state,
    "complete",
  );
  assert.equal(f.calls(), 1);
});

test("owner QA rejects anonymous, other subjects and spoofed owner identity without reservations", async (t) => {
  const f = await fixture(t);
  ownerQA(f);
  const input = await f.input();
  for (const options of [
    { subject: "b" },
    { headers: { Cookie: "" } },
    {
      subject: "b",
      headers: { "X-StreamLion-Account": "a", "X-Google-Subject": "a" },
    },
  ]) {
    assert.equal(
      (await (await f.call("config", null, options)).json()).enabled,
      false,
    );
    assert(
      [401, 403].includes(
        (
          await f.call(
            "prepare",
            { ...input, google_subject: "a", owner_qa: true },
            options,
          )
        ).status,
      ),
    );
  }
  assert.equal(f.calls(), 0);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_brief_jobs_v1").get().n,
    0,
  );
});

test("missing or malformed owner QA configuration and mismatched test policy fail closed", async (t) => {
  const f = await fixture(t);
  ownerQA(f);
  const input = await f.input();
  for (const [key, value] of [
    ["STREAMLION_BRIEF_IMPORT_QA_ENABLED", "false"],
    ["STREAMLION_BRIEF_IMPORT_QA_COST_APPROVED", undefined],
    ["STREAMLION_BRIEF_IMPORT_QA_SUBJECT", "*"],
    ["STREAMLION_BRIEF_IMPORT_QA_SUBJECT", "a@example.test"],
    ["STREAMLION_BRIEF_IMPORT_QA_SUBJECT", '["a","b"]'],
    ["STREAMLION_BRIEF_IMPORT_QA_START", "invalid"],
    [
      "STREAMLION_BRIEF_IMPORT_QA_UNTIL",
      new Date(f.now() + 86400001).toISOString(),
    ],
    ["STREAMLION_PAYMENTS_MODE", "live"],
    ["OPENAI_API_KEY", ""],
  ]) {
    const old = f.env[key];
    f.env[key] = value;
    assert.equal((await (await f.call()).json()).enabled, false, key);
    assert.equal((await f.call("prepare", input)).status, 503, key);
    f.env[key] = old;
  }
  for (const field of [
    "price_micros",
    "reserve_micros",
    "daily_budget_micros",
    "total_budget_micros",
    "daily_requests",
  ]) {
    const old = f.sql
      .prepare(
        `SELECT ${field} v FROM streamlion_brief_policy_v1 WHERE mode='test'`,
      )
      .get().v;
    f.sql.exec(
      `UPDATE streamlion_brief_policy_v1 SET ${field}=${old * 2} WHERE mode='test'`,
    );
    assert.equal((await (await f.call()).json()).enabled, false, field);
    assert.equal((await f.call("prepare", input)).status, 503, field);
    f.sql.exec(
      `UPDATE streamlion_brief_policy_v1 SET ${field}=${old} WHERE mode='test'`,
    );
  }
  assert.equal(f.calls(), 0);
});

test("owner QA expiry blocks new work but retains authenticated recovery", async (t) => {
  const f = await fixture(t);
  ownerQA(f);
  const input = await f.input();
  f.advance(3600000);
  await f.call("prepare", input);
  f.advance(23 * 3600000);
  assert.equal((await (await f.call()).json()).reason, "qa_expired");
  assert.equal(
    (await f.call("prepare", { ...input, requestId: otherId })).status,
    403,
  );
  assert.equal(
    (await (await f.call("result?id=" + id)).json()).state,
    "complete",
  );
  assert.equal(f.calls(), 1);
});

test("three attempts including failures exhaust lifetime QA budget across midnight and expiry changes", async (t) => {
  const f = await fixture(t);
  f.advance(86400000 - (f.now() % 86400000) - 60000);
  ownerQA(f);
  const originalQuote = await f.input();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw new DOMException("Timeout", "TimeoutError");
  };
  for (let n = 1; n <= 3; n++) {
    const input = await f.input(qaId(n));
    assert.equal(
      (await (await f.call("prepare", input, { fetcher })).json()).state,
      "failed",
    );
    f.advance(3600000);
  }
  assert.equal((await (await f.call()).json()).reason, "qa_exhausted");
  assert.equal(
    (await f.call("prepare", { ...originalQuote, requestId: otherId })).status,
    429,
  );
  f.env.STREAMLION_BRIEF_IMPORT_QA_START = new Date(f.now()).toISOString();
  f.env.STREAMLION_BRIEF_IMPORT_QA_UNTIL = new Date(
    f.now() + 86400000,
  ).toISOString();
  assert.equal((await (await f.call()).json()).reason, "qa_exhausted");
  assert.equal(calls, 3);
  assert.equal(
    f.sql
      .prepare(
        "SELECT balance_micros b FROM streamlion_credit_wallets_v1 WHERE mode='test'",
      )
      .get().b,
    19000000,
  );
  assert.equal(
    f.sql
      .prepare("SELECT SUM(reserve_micros) n FROM streamlion_brief_jobs_v1")
      .get().n,
    300000,
  );
});

test("owner QA cannot consume unexpected promotional funds or bypass a revoked test license", async (t) => {
  const f = await fixture(t);
  ownerQA(f);
  const input = await f.input();
  f.sql.exec(
    "UPDATE streamlion_promotional_wallets_v1 SET balance_micros=100000 WHERE mode='test'",
  );
  assert.equal((await (await f.call()).json()).canPrepare, false);
  assert.equal((await f.call("prepare", input)).status, 429);
  f.sql.exec(
    "UPDATE streamlion_promotional_wallets_v1 SET balance_micros=0 WHERE mode='test'; UPDATE streamlion_purchases_v1 SET status='refunded' WHERE mode='test'",
  );
  assert.equal((await f.call("prepare", input)).status, 402);
  assert.equal(f.calls(), 0);
});

test("model request is bounded and cannot inherit a premium processing tier", async (t) => {
  let calls = 0;
  await assert.rejects(
    extractBrief(
      { OPENAI_API_KEY: "mock-only" },
      { text: "x".repeat(70000), sourceName: "brief" },
      async () => {
        calls++;
        return output();
      },
    ),
    /request_size/,
  );
  assert.equal(calls, 0);
});

test("QA checks exact policy atomically and cannot grow its approved budget during reservation", async (t) => {
  const f = await fixture(t);
  ownerQA(f);
  const input = await f.input();
  const original = f.db.prepare;
  f.db.prepare = (query) => {
    if (query.startsWith("INSERT INTO streamlion_brief_jobs"))
      f.sql.exec(
        "UPDATE streamlion_brief_policy_v1 SET daily_budget_micros=600000,total_budget_micros=600000,daily_requests=6 WHERE mode='test'",
      );
    return original(query);
  };
  assert.equal((await f.call("prepare", input)).status, 429);
  assert.equal(f.calls(), 0);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_brief_jobs_v1").get().n,
    0,
  );
});

test("QA expiry or revocation after reservation refunds without invoking the provider", async (t) => {
  for (const change of ["expire", "revoke", "workbook"])
    await t.test(change, async (t) => {
      const f = await fixture(t);
      ownerQA(f);
      const input = await f.input();
      const original = f.db.prepare;
      f.db.prepare = (query) => {
        if (query.startsWith("INSERT INTO streamlion_brief_jobs")) {
          if (change === "expire") f.advance(86400000);
          if (change === "revoke")
            f.env.STREAMLION_BRIEF_IMPORT_QA_ENABLED = "false";
          if (change === "workbook")
            f.sql.exec(
              "UPDATE streamlion_google_sessions_v1 SET workbook_id='changed' WHERE google_subject='a'",
            );
        }
        return original(query);
      };
      assert.equal(
        (await (await f.call("prepare", input)).json()).state,
        "failed",
      );
      assert.equal(f.calls(), 0);
      assert.equal(
        f.sql
          .prepare(
            "SELECT balance_micros b FROM streamlion_credit_wallets_v1 WHERE mode='test'",
          )
          .get().b,
        19000000,
      );
      assert.equal(
        f.sql
          .prepare("SELECT SUM(reserve_micros) n FROM streamlion_brief_jobs_v1")
          .get().n,
        100000,
      );
    });
});

test("concurrent final QA attempts cannot exceed three; pending and completed results recover at exhaustion", async (t) => {
  const f = await fixture(t);
  ownerQA(f);
  for (let n = 1; n <= 2; n++) await f.call("prepare", await f.input(qaId(n)));
  const input = await f.input(qaId(3));
  let release,
    started,
    calls = 0;
  const ready = new Promise((r) => (started = r)),
    hold = new Promise((r) => (release = r));
  const fetcher = async () => {
    calls++;
    started();
    await hold;
    return output();
  };
  const first = f.call("prepare", input, { fetcher });
  await ready;
  assert.equal((await f.call("prepare", input, { fetcher })).status, 202);
  assert.equal(
    (await f.call("prepare", { ...input, requestId: qaId(4) }, { fetcher }))
      .status,
    429,
  );
  assert.equal((await f.call("result?id=" + qaId(3))).status, 202);
  release();
  assert.equal((await first).status, 200);
  assert.equal(
    (await (await f.call("prepare", input, { fetcher })).json()).state,
    "complete",
  );
  assert.equal(calls, 1);
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) n FROM streamlion_brief_jobs_v1").get().n,
    3,
  );
  f.env.STREAMLION_BRIEF_IMPORT_QA_ENABLED = "false";
  assert.equal(
    (await (await f.call("result?id=" + qaId(3))).json()).state,
    "complete",
  );
  assert.equal(
    (await f.call("result?id=" + qaId(3), null, { subject: "b" })).status,
    404,
  );
});

test("auth, same-origin, license, quote and scope failures preserve credits and never infer", async (t) => {
  const f = await fixture(t);
  f.activate();
  const value = await f.input();
  for (const headers of [
    { Origin: "https://evil.example" },
    { "Sec-Fetch-Site": "cross-site" },
    { Cookie: "" },
  ])
    assert(
      [401, 403].includes((await f.call("prepare", value, { headers })).status),
    );
  for (const changed of [
    { priceMicros: 50000 },
    { scope: "wrong" },
    { quoteKey: "old" },
    { text: "x".repeat(6001) },
    { requestId: "invalid" },
    { sourceName: "bad\nname" },
  ])
    assert(
      [400, 409].includes(
        (await f.call("prepare", { ...value, ...changed })).status,
      ),
    );
  assert.equal((await f.call("prepare", "x".repeat(30001))).status, 413);
  f.sql.exec(
    "UPDATE streamlion_purchases_v1 SET status='refunded' WHERE google_subject='a'",
  );
  assert.equal((await f.call("prepare", value)).status, 402);
  assert.equal(f.calls(), 0);
  assert.equal(f.balance(), 1000000); // Existing purchase revocation clears its promotional balance.
});

test("completed preparation charges once, stores only encrypted results, and recovers after response loss or pause", async (t) => {
  const f = await fixture(t);
  f.activate();
  const value = await f.input();
  const policies = f.sql.prepare("SELECT * FROM streamlion_ai_policy_v1").all();
  assert.equal((await f.call("prepare", value)).status, 200); // Simulate a lost response: discard its body.
  const replay = await (await f.call("prepare", value)).json();
  assert.equal(replay.state, "complete");
  assert.deepEqual(replay.project, project);
  assert.equal(f.calls(), 1);
  assert.equal(f.balance(), 900000);
  const row = f.sql.prepare("SELECT * FROM streamlion_brief_jobs_v1").get();
  assert(!JSON.stringify(row).includes("Example Street"));
  assert(!JSON.stringify(row).includes("brief.pdf"));
  assert.equal(
    (await f.call("prepare", { ...value, text: "Another brief" })).status,
    409,
  );
  assert.equal(
    (await f.call("result?id=" + id, null, { subject: "b" })).status,
    404,
  );
  f.env.ENABLE_BRIEF_IMPORT = "false";
  assert.equal(
    (await (await f.call("result?id=" + id)).json()).state,
    "complete",
  );
  assert.deepEqual(
    f.sql.prepare("SELECT * FROM streamlion_ai_policy_v1").all(),
    policies,
  );
  assert.equal(f.env.STREAMLION_AI_CREDITS_MODE, "test");
  assert.equal(
    f.sql
      .prepare("SELECT COUNT(*) AS n FROM streamlion_coordination_jobs_v1")
      .get().n,
    0,
  );
});

test("concurrent same-ID retries infer once; a second job cannot overlap the account reservation", async (t) => {
  const f = await fixture(t);
  f.activate();
  const value = await f.input();
  let release, started;
  const ready = new Promise((r) => (started = r)),
    hold = new Promise((r) => (release = r));
  let calls = 0;
  const fetcher = async () => {
    calls++;
    started();
    await hold;
    return output();
  };
  const first = f.call("prepare", value, { fetcher });
  await ready;
  assert.equal((await f.call("prepare", value, { fetcher })).status, 202);
  assert.equal(
    (await f.call("prepare", { ...value, requestId: otherId }, { fetcher }))
      .status,
    429,
  );
  assert.equal(f.balance(), 900000);
  release();
  assert.equal((await first).status, 200);
  assert.equal(calls, 1);
});

test("refusal, incomplete, invalid and empty outputs, errors and timeouts refund once without inference retries", async (t) => {
  const cases = [
    () => output(project, { status: "incomplete" }),
    () =>
      output(project, {
        output: [{ content: [{ type: "refusal", refusal: "No" }] }],
      }),
    () =>
      output({
        ...project,
        fields: { ...project.fields, document1Url: "javascript:alert(1)" },
      }),
    () => output({ ...project, fields: { title: "Partial" } }),
    () => output(intakeFor({ unresolved: "No facts" })),
    () => new Response("broken", { status: 502 }),
    () => new Response("x".repeat(48001)),
    () => {
      throw new DOMException("Timed out", "TimeoutError");
    },
  ];
  for (let i = 0; i < cases.length; i++)
    await t.test(String(i), async (t) => {
      const f = await fixture(t);
      f.activate();
      const value = await f.input();
      let calls = 0;
      const fetcher = async () => {
        calls++;
        return cases[i]();
      };
      assert.equal(
        (await (await f.call("prepare", value, { fetcher })).json()).state,
        "failed",
      );
      assert.equal(f.balance(), 1050000);
      assert.equal(
        (await (await f.call("prepare", value, { fetcher })).json()).state,
        "failed",
      );
      assert.equal(calls, 1);
      assert.equal(f.balance(), 1050000);
      assert.equal(
        f.sql
          .prepare(
            "SELECT SUM(reserve_micros) AS n FROM streamlion_brief_jobs_v1",
          )
          .get().n,
        100000,
      );
    });
});

test("budget, insufficient funds and concurrent policy changes fail closed before provider invocation", async (t) => {
  for (const change of [
    "UPDATE streamlion_brief_policy_v1 SET daily_requests=0",
    "UPDATE streamlion_brief_policy_v1 SET daily_budget_micros=0",
    "UPDATE streamlion_brief_policy_v1 SET total_budget_micros=0",
    "UPDATE streamlion_credit_wallets_v1 SET balance_micros=0; UPDATE streamlion_promotional_wallets_v1 SET balance_micros=0",
  ])
    await t.test(change, async (t) => {
      const f = await fixture(t);
      f.activate();
      f.sql.exec(change);
      const value = await f.input();
      assert.equal((await f.call("prepare", value)).status, 429);
      assert.equal(f.calls(), 0);
    });
  const f = await fixture(t);
  f.activate();
  const value = await f.input();
  const original = f.db.prepare;
  f.db.prepare = (q) => {
    if (q.startsWith("INSERT INTO streamlion_brief_jobs"))
      f.sql.exec("UPDATE streamlion_brief_policy_v1 SET price_micros=200000");
    return original(q);
  };
  assert.equal((await f.call("prepare", value)).status, 429);
  assert.equal(f.calls(), 0);
  assert.equal(f.balance(), 1050000);
});

test("workbook changes block recovery; stale interrupted jobs refund and cannot run again", async (t) => {
  const f = await fixture(t);
  f.activate();
  const value = await f.input();
  await f.call("prepare", value);
  f.sql.exec(
    "UPDATE streamlion_google_sessions_v1 SET workbook_id='other' WHERE google_subject='a'",
  );
  assert.equal((await f.call("result?id=" + id)).status, 409);
  f.sql.exec(
    "UPDATE streamlion_google_sessions_v1 SET workbook_id='book-a' WHERE google_subject='a'",
  );
  // Reserve directly to simulate an isolate dying after debit and before inference completion.
  f.sql
    .prepare(
      "INSERT INTO streamlion_brief_jobs_v1(mode,google_subject,request_id,scope,input_hash,quote_key,price_micros,reserve_micros,promotional,purchased,created_at,expires_at) VALUES('live','a',?,?,?,'quote',150000,100000,0,150000,?,?)",
    )
    .run(otherId, value.scope, "hash", f.now(), f.now() + 86400000);
  assert.equal(f.balance(), 750000);
  f.advance(300001);
  assert.equal(
    (await (await f.call("result?id=" + otherId)).json()).state,
    "failed",
  );
  assert.equal(f.balance(), 900000);
  await f.call("result?id=" + otherId);
  assert.equal(f.balance(), 900000);
  assert.equal(f.calls(), 1);
});

test("daily cleanup supports pre-migration databases, erases expired results and retains financial history", async (t) => {
  const f = await fixture(t, { migration: false });
  assert.deepEqual(await purgeBriefState(f.db), {
    briefResultsRemoved: 0,
    staleBriefsReturned: 0,
  });
  f.sql.exec(
    readFileSync(
      new URL("../../migrations/0016_brief_import.sql", import.meta.url),
      "utf8",
    ),
  );
  f.activate();
  await f.call("prepare", await f.input());
  f.advance(86400001);
  assert.deepEqual(await purgeBriefState(f.db, f.now()), {
    briefResultsRemoved: 1,
    staleBriefsReturned: 0,
  });
  assert.equal(
    (await (await f.call("result?id=" + id)).json()).state,
    "expired",
  );
  const row = f.sql.prepare("SELECT * FROM streamlion_brief_jobs_v1").get();
  assert.equal(row.result, null);
  assert.equal(row.state, "complete");
  assert.equal(f.balance(), 900000);
});
