import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { reserveGoogleRequest } from "../server/google-limits.js";
import {
  PROJECT_HEADERS,
  makeRevision,
  rowFor,
  readRecordHistory,
} from "../src/workbook.js";
import { validateFields } from "../src/project-schema.js";

// Local, synthetic, zero-provider-call exercise. This measures the committed
// quota SQL and history parser, not Cloudflare/Google latency or live capacity.
globalThis.fetch = () => {
  throw new Error("Provider calls are forbidden in the capacity exercise.");
};
const sql = new DatabaseSync(":memory:");
sql.exec(
  readFileSync(
    new URL("../migrations/0002_google_request_limits.sql", import.meta.url),
    "utf8",
  ),
);
const database = {
  prepare: (query) => ({
    bind: (...values) => ({
      run: async () => ({
        meta: { changes: sql.prepare(query).run(...values).changes },
      }),
    }),
  }),
};
const now = 120000;
const reserve = (account, method, time = now) =>
  reserveGoogleRequest(database, account, method, time);
const shared = await Promise.all(
  Array.from({ length: 400 }, (_, i) => reserve(`account-${i % 20}`, "GET")),
);
assert.equal(shared.filter((r) => r.allowed).length, 200);
assert.equal(
  sql
    .prepare(
      "SELECT used FROM streamlion_google_request_limits_v1 WHERE scope='project:read'",
    )
    .get().used,
  200,
);
const one = await Promise.all(
  Array.from({ length: 100 }, () => reserve("one-account", "POST")),
);
assert.equal(one.filter((r) => r.allowed).length, 40);
assert.equal(
  sql
    .prepare(
      "SELECT used FROM streamlion_google_request_limits_v1 WHERE scope='project:write'",
    )
    .get().used,
  40,
);
assert.equal((await reserve("one-account", "POST", now + 60000)).allowed, true);
assert.equal((await reserve("new-account", "GET", now + 60000)).allowed, true);
sql.close();

const parser = [];
for (const populatedRows of [100, 1000, 5000, 9999]) {
  const rows = [[...PROJECT_HEADERS]],
    previous = new Map();
  for (let i = 0; i < populatedRows; i++) {
    const recordId = `synthetic-${i % 100}`;
    const revision = makeRevision(
      validateFields({
        title: `Synthetic project ${i % 100}`,
        scope: "Synthetic scope. ".repeat(32),
      }),
      previous.get(recordId),
      recordId,
    );
    previous.set(recordId, revision);
    rows.push(rowFor(revision, PROJECT_HEADERS));
  }
  const times = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now(),
      history = readRecordHistory(rows, PROJECT_HEADERS);
    times.push(performance.now() - start);
    assert.equal(history.heads.length, Math.min(100, populatedRows));
    assert.equal(history.revisions.length, populatedRows);
  }
  times.sort((a, b) => a - b);
  parser.push({
    populatedRows,
    approximatePayloadBytes: Buffer.byteLength(JSON.stringify(rows)),
    localParserP95Ms: Math.round(times.at(-1)),
    processHeapMiB: Math.round(process.memoryUsage().heapUsed / 1048576),
  });
}
console.log(
  JSON.stringify(
    {
      passed: true,
      synthetic: true,
      realProviderCalls: 0,
      sharedReadsAccepted: 200,
      singleAccountWritesAccepted: 40,
      rejectedReservationsConsumeNoSharedCapacity: true,
      parser,
      limitation:
        "Local Node/SQLite results do not establish Workers memory, network latency, supported concurrent users or production SLOs.",
    },
    null,
    2,
  ),
);
