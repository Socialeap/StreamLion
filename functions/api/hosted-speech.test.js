import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extensionFixture } from "../../test/extension-fixture.js";
import {
  handleSpeech,
  speechText,
  speechPrice,
  reserveSpeech,
  finishSpeech,
  expireSpeech,
  speechAudio,
} from "../../server/hosted-speech.js";
const migration = readFileSync(
  new URL("../../migrations/0021_hosted_speech.sql", import.meta.url),
  "utf8",
);
const id = "11111111-1111-4111-8111-111111111111";
function wav() {
  const b = Buffer.alloc(48);
  b.write("RIFF");
  b.writeUInt32LE(40, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(4, 40);
  return b.toString("base64");
}
async function fixture(t) {
  const f = await extensionFixture();
  t.after(() => f.db.close());
  f.db.exec(
    readFileSync(
      new URL(
        "../../migrations/0008_streamlion_ai_credits.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  f.db.exec(migration);
  f.db.exec(
    "INSERT INTO streamlion_credit_wallets_v1 VALUES('live','account-a',100000); INSERT INTO streamlion_purchases_v1(order_id,mode,google_subject,checkout_email,price_id,product_id,amount,currency,status,created_at,expires_at,updated_at) VALUES('paid','live','account-a','example@example.com','price','prod',1,'usd','paid',0,0,0)",
  );
  Object.assign(f.env, {
    STREAMLION_HOSTED_SPEECH_APPROVED: "true",
    STREAMLION_LIVE_PAYMENTS_APPROVED: "true",
    STREAMLION_PAYMENTS_MODE: "live",
    STREAMLION_AI_CREDITS_MODE: "live",
    DEEPINFRA_API_KEY: "synthetic-only",
  });
  f.db.exec(
    "UPDATE streamlion_speech_policy_v1 SET active=1,cost_micros=1000,daily_budget_micros=10000,total_budget_micros=20000,daily_requests=10 WHERE mode='live'",
  );
  let calls = 0;
  let project = {
    id: "p",
    title: "Synthetic",
    contact1Name: "Example Person",
    deliverables: "Tour link",
    accessInstructions: "Door code 9876",
  };
  const deps = {
    readProject: async () => ({ project }),
    generate: async () => {
      calls++;
      return wav();
    },
  };
  const call = async (route, body, extra = {}) =>
    handleSpeech(
      {
        env: f.env,
        request: new Request("https://app.example/api/speech/" + route, {
          method: body ? "POST" : "GET",
          headers: {
            Cookie: `__Host-streamlion-session=${f.cookie}`,
            Origin: "https://app.example",
            "Content-Type": "application/json",
            ...extra.headers,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      },
      { ...deps, ...extra.deps },
    );
  return {
    ...f,
    call,
    deps,
    get calls() {
      return calls;
    },
    get project() {
      return project;
    },
    set project(v) {
      project = v;
    },
    balance: () =>
      f.db
        .prepare(
          "SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode='live' AND google_subject='account-a'",
        )
        .get().balance_micros,
  };
}

test("migration starts both policies inactive and unpriced; activation flags and absent schema fail closed", async (t) => {
  const f = await fixture(t);
  f.db.exec(
    "UPDATE streamlion_speech_policy_v1 SET active=0,cost_micros=0,daily_budget_micros=0,total_budget_micros=0,daily_requests=0",
  );
  assert.equal((await (await f.call("config")).json()).enabled, false);
  for (const [key, value] of [
    ["STREAMLION_HOSTED_SPEECH_APPROVED", "false"],
    ["STREAMLION_LIVE_PAYMENTS_APPROVED", "false"],
    ["STREAMLION_PAYMENTS_MODE", "test"],
    ["STREAMLION_AI_CREDITS_MODE", "test"],
    ["DEEPINFRA_API_KEY", ""],
  ]) {
    const old = f.env[key];
    f.env[key] = value;
    assert.equal((await (await f.call("config")).json()).enabled, false);
    assert.equal((await f.call("speak", { requestId: id })).status, 503);
    f.env[key] = old;
  }
  f.db.exec("DROP TABLE streamlion_speech_policy_v1");
  assert.equal((await f.call("config")).status, 503);
  assert.equal(f.calls, 0);
});

test("speech-only quotes authoritative text, charges once, and replay/status never regenerate audio", async (t) => {
  const f = await fixture(t),
    config = await (await f.call("config")).json();
  const q = await (
    await f.call("quote", { projectId: "p", question: "Who is the contact?" })
  ).json();
  assert.equal(q.priceMicros, 1300);
  assert.match(q.text, /Example Person/);
  assert.equal(f.calls, 0);
  assert.equal(f.balance(), 100000);
  const response = await f.call("speak", {
    requestId: id,
    quoteToken: q.quoteToken,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "audio/wav");
  assert.equal(f.calls, 1);
  assert.equal(f.balance(), 98700);
  assert.equal(
    (await f.call("speak", { requestId: id, quoteToken: q.quoteToken })).status,
    409,
  );
  assert.equal(f.calls, 1);
  f.env.STREAMLION_HOSTED_SPEECH_APPROVED = "false";
  const status = await f.call(
    "status?requestId=" + id + "&scope=" + config.scope,
  );
  assert.equal((await status.json()).state, "complete");
  assert.equal(
    (await f.call("status?requestId=" + id + "&scope=other")).status,
    409,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) n FROM streamlion_credit_turns_v1").get().n,
    0,
  );
});

test("policy/price, project, account/workbook, expiry and forged quote changes reject before charging", async (t) => {
  const f = await fixture(t);
  const q = await (
    await f.call("quote", { projectId: "p", question: "deliverables" })
  ).json();
  assert.equal(
    (await f.call("speak", { requestId: id, quoteToken: "forged" })).status,
    409,
  );
  f.db.exec(
    "UPDATE streamlion_speech_policy_v1 SET cost_micros=2000 WHERE mode='live'",
  );
  assert.equal(
    (await f.call("speak", { requestId: id, quoteToken: q.quoteToken })).status,
    409,
  );
  f.db.exec(
    "UPDATE streamlion_speech_policy_v1 SET cost_micros=1000 WHERE mode='live'",
  );
  assert.equal(
    (
      await f.call(
        "speak",
        { requestId: id, quoteToken: q.quoteToken },
        { deps: { now: () => Date.now() + 61000 } },
      )
    ).status,
    409,
  );
  f.project = { ...f.project, deliverables: "Changed" };
  assert.equal(
    (await f.call("speak", { requestId: id, quoteToken: q.quoteToken })).status,
    409,
  );
  f.db.exec("UPDATE streamlion_google_sessions_v1 SET workbook_id='other'");
  assert.equal(
    (await f.call("speak", { requestId: id, quoteToken: q.quoteToken })).status,
    409,
  );
  assert.equal(f.balance(), 100000);
  assert.equal(f.calls, 0);
});

test("failed/malformed audio refunds once; attempts still consume provider budget", async (t) => {
  const f = await fixture(t);
  const q = await (
    await f.call("quote", { projectId: "p", question: "deliverables" })
  ).json();
  assert.equal(
    (
      await f.call(
        "speak",
        { requestId: id, quoteToken: q.quoteToken },
        {
          deps: {
            generate: async () => {
              throw Error("provider");
            },
          },
        },
      )
    ).status,
    502,
  );
  assert.equal(f.balance(), 100000);
  await finishSpeech(f.env.GOOGLE_SESSIONS, "account-a", id, "failed");
  assert.equal(f.balance(), 100000);
  assert.equal(
    f.db
      .prepare("SELECT SUM(reserve_micros) n FROM streamlion_speech_turns_v1")
      .get().n,
    1000,
  );
  assert.equal(
    (
      await f.call(
        "speak",
        {
          requestId: "22222222-2222-4222-8222-222222222222",
          quoteToken: q.quoteToken,
        },
        { deps: { generate: async () => "YWJj" } },
      )
    ).status,
    502,
  );
  assert.equal(f.balance(), 100000);
});

test("atomic wallet/capacity holds reject double submissions, insufficient funds and mutated ledger state", async (t) => {
  const f = await fixture(t),
    db = f.env.GOOGLE_SESSIONS;
  const settled = await Promise.allSettled([
    reserveSpeech(db, "account-a", id, "scope", "hash", 1300, 1000, Date.now()),
    reserveSpeech(
      db,
      "account-a",
      "other",
      "scope",
      "hash",
      1300,
      1000,
      Date.now(),
    ),
  ]);
  assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.balance(), 98700);
  assert.throws(
    () => f.db.exec("UPDATE streamlion_speech_turns_v1 SET price_micros=1"),
    /speech_transition/,
  );
  await expireSpeech(db, "account-a", Date.now() + 300001);
  assert.equal(f.balance(), 100000);
  f.db.exec("UPDATE streamlion_credit_wallets_v1 SET balance_micros=1");
  await assert.rejects(
    reserveSpeech(
      db,
      "account-a",
      "third",
      "scope",
      "hash",
      1300,
      1000,
      Date.now(),
    ),
    /speech_capacity/,
  );
});

test("cross-origin, unauthenticated and unlicensed clients cannot buy speech; input is bounded", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call(
        "quote",
        { projectId: "p", question: "contact" },
        { headers: { Origin: "https://evil.example" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "quote",
        { projectId: "p", question: "contact" },
        { headers: { Cookie: "" } },
      )
    ).status,
    401,
  );
  f.db.exec("DELETE FROM streamlion_purchases_v1");
  assert.equal(
    (await f.call("quote", { projectId: "p", question: "contact" })).status,
    402,
  );
  assert.equal(f.calls, 0);
});

test("access, repeated codes, arbitrary instructions and oversized answers stay on free device speech", () => {
  assert.throws(
    () => speechText({ accessInstructions: "Door code 1234" }, "access"),
    /speech_access/,
  );
  assert.throws(
    () =>
      speechText(
        { accessInstructions: "Door code 1234", deliverables: "Use 1234" },
        "deliverables",
      ),
    /speech_access/,
  );
  assert.throws(
    () => speechText({ deliverables: "PIN: 1234" }, "deliverables"),
    /speech_access/,
  );
  assert.throws(
    () => speechText({ deliverables: "x".repeat(1201) }, "deliverables"),
    /speech_length/,
  );
  assert.throws(
    () => speechText({ title: "test" }, "calculate a new answer"),
    /speech_access/,
  );
  assert.equal(speechPrice(1000), 1300);
  assert.throws(() => speechPrice(0));
  assert.equal(speechAudio(wav()).length, 48);
  const invalid = Buffer.from(wav(), "base64");
  invalid.writeUInt16LE(0, 22); // A RIFF label alone does not make playable audio.
  assert.throws(() => speechAudio(invalid.toString("base64")), /speech_audio/);
  assert.ok(
    speechAudio(
      readFileSync(
        new URL(
          "../../public/voice/kokoro-af-heart-preview.wav",
          import.meta.url,
        ),
      ).toString("base64"),
    ).length > 44,
  );
});

test("budget caps retain failed attempts, rate limits and price checks are enforced atomically", async (t) => {
  const f = await fixture(t),
    db = f.env.GOOGLE_SESSIONS,
    now = Date.now();
  f.db.exec(
    "UPDATE streamlion_speech_policy_v1 SET total_budget_micros=1000 WHERE mode='live'",
  );
  await reserveSpeech(db, "account-a", id, "scope", "hash", 1300, 1000, now);
  await finishSpeech(db, "account-a", id, "failed");
  await assert.rejects(
    reserveSpeech(
      db,
      "account-a",
      "second",
      "scope",
      "hash",
      1300,
      1000,
      now + 61000,
    ),
    /speech_capacity/,
  );
  f.db.exec(
    "UPDATE streamlion_speech_policy_v1 SET total_budget_micros=20000,daily_budget_micros=1000 WHERE mode='live'",
  );
  await assert.rejects(
    reserveSpeech(
      db,
      "account-a",
      "second",
      "scope",
      "hash",
      1300,
      1000,
      now + 61000,
    ),
    /speech_capacity/,
  );
  f.db.exec(
    "UPDATE streamlion_speech_policy_v1 SET daily_budget_micros=10000,daily_requests=1 WHERE mode='live'",
  );
  await assert.rejects(
    reserveSpeech(
      db,
      "account-a",
      "second",
      "scope",
      "hash",
      1300,
      1000,
      now + 61000,
    ),
    /speech_capacity/,
  );
  f.db.exec(
    "UPDATE streamlion_speech_policy_v1 SET daily_requests=10 WHERE mode='live'",
  );
  await assert.rejects(
    reserveSpeech(db, "account-a", "second", "scope", "hash", 1, 1000, now),
    /speech_capacity/,
  );
  for (const next of ["second", "third"]) {
    await reserveSpeech(
      db,
      "account-a",
      next,
      "scope",
      "hash",
      1300,
      1000,
      now,
    );
    await finishSpeech(db, "account-a", next, "failed");
  }
  await assert.rejects(
    reserveSpeech(db, "account-a", "fourth", "scope", "hash", 1300, 1000, now),
    /speech_capacity/,
  );
  assert.equal(f.balance(), 100000);
});

test("a quote expiring during the Google read cannot reserve; abort after reservation refunds", async (t) => {
  const f = await fixture(t);
  let clock = Date.now();
  const q = await (
    await f.call(
      "quote",
      { projectId: "p", question: "deliverables" },
      { deps: { now: () => clock } },
    )
  ).json();
  const expired = await f.call(
    "speak",
    { requestId: id, quoteToken: q.quoteToken },
    {
      deps: {
        now: () => clock,
        readProject: async () => {
          clock += 61000;
          return { project: f.project };
        },
      },
    },
  );
  assert.equal(expired.status, 409);
  assert.equal(f.balance(), 100000);
  assert.equal(f.calls, 0);
  const q2 = await (
    await f.call("quote", { projectId: "p", question: "contact" })
  ).json();
  const controller = new AbortController();
  const request = new Request("https://app.example/api/speech/speak", {
    method: "POST",
    signal: controller.signal,
    headers: {
      Cookie: `__Host-streamlion-session=${f.cookie}`,
      Origin: "https://app.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestId: id, quoteToken: q2.quoteToken }),
  });
  const result = await handleSpeech(
    { env: f.env, request },
    {
      ...f.deps,
      generate: async () => {
        controller.abort();
        return wav();
      },
    },
  );
  assert.equal(result.status, 502);
  assert.equal(f.balance(), 100000);
});

test("partial schema fails closed; oversized inputs never reach provider; daily cleanup refunds once", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.call("quote", {
        projectId: "p",
        question: "contact",
        unused: "x".repeat(9000),
      })
    ).status,
    413,
  );
  const { purgeSpeechState } = await import("../../ops/session-cleanup.js");
  await reserveSpeech(
    f.env.GOOGLE_SESSIONS,
    "account-a",
    id,
    "scope",
    "hash",
    1300,
    1000,
    Date.now() - 300001,
  );
  assert.deepEqual(await purgeSpeechState(f.env.GOOGLE_SESSIONS), {
    staleSpeechReturned: 1,
  });
  assert.deepEqual(await purgeSpeechState(f.env.GOOGLE_SESSIONS), {
    staleSpeechReturned: 0,
  });
  assert.equal(f.balance(), 100000);
  f.db.exec("DROP TRIGGER streamlion_speech_debit_v1");
  assert.equal(
    (await f.call("quote", { projectId: "p", question: "contact" })).status,
    503,
  );
  assert.equal(f.calls, 0);
});

test("read-only preflight accepts only absent or exact complete schema, rejecting partial and mutated objects", async (t) => {
  const { speechPreflight } =
    await import("../../scripts/preflight-speech.mjs");
  const f = await fixture(t);
  assert.equal(
    speechPreflight({ schema: [], stamps: {} }).migration,
    "pending",
  );
  const schema = f.db
    .prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL")
    .all();
  assert.equal(
    speechPreflight({ schema, stamps: { streamlion_speech_schema_v1: 1 } })
      .migration,
    "already_applied",
  );
  assert.throws(
    () =>
      speechPreflight({
        schema: schema.filter((r) => r.name !== "streamlion_speech_debit_v1"),
        stamps: { streamlion_speech_schema_v1: 1 },
      }),
    /Partial/,
  );
  assert.throws(() => speechPreflight({ schema, stamps: {} }), /stamp/);
  assert.throws(
    () =>
      speechPreflight({
        schema: schema.map((r) =>
          r.name === "streamlion_speech_debit_v1"
            ? { ...r, sql: r.sql.replace("balance_micros-", "balance_micros+") }
            : r,
        ),
        stamps: { streamlion_speech_schema_v1: 1 },
      }),
    /mismatch/,
  );
});

test("reservation storage failures remain uncertain; a lost insert acknowledgement preserves the existing hold", async (t) => {
  const f = await fixture(t);
  const q = await (
    await f.call("quote", { projectId: "p", question: "contact" })
  ).json();
  const database = f.env.GOOGLE_SESSIONS;
  let commit = false;
  f.env.GOOGLE_SESSIONS = {
    ...database,
    prepare(sql) {
      const statement = database.prepare(sql);
      if (!sql.startsWith("INSERT INTO streamlion_speech_turns_v1"))
        return statement;
      return {
        bind(...args) {
          const bound = statement.bind(...args);
          return {
            run: async () => {
              if (commit) await bound.run();
              throw Error("storage acknowledgement lost");
            },
          };
        },
      };
    },
  };
  const body = { requestId: id, quoteToken: q.quoteToken };
  assert.equal((await f.call("speak", body)).status, 503);
  assert.equal(f.balance(), 100000);
  commit = true;
  const result = await f.call("speak", body);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).state, "reserved");
  assert.equal(f.balance(), 98700);
  assert.equal(f.calls, 0);
  await expireSpeech(database, "account-a", Date.now() + 300001);
  assert.equal(f.balance(), 100000);
});

test("a definitive capacity rejection reports no existing reservation or provider call", async (t) => {
  const f = await fixture(t);
  const q = await (
    await f.call("quote", { projectId: "p", question: "contact" })
  ).json();
  f.db.exec(
    "UPDATE streamlion_credit_wallets_v1 SET balance_micros=1 WHERE google_subject='account-a'",
  );
  const response = await f.call("speak", {
    requestId: id,
    quoteToken: q.quoteToken,
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).state, undefined);
  assert.equal(f.balance(), 1);
  assert.equal(f.calls, 0);
});
