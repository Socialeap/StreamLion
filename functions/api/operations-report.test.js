import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";
import {
  operationsFixture,
  operationsResponse,
  OPERATIONS_NOW,
} from "../../test/operations-fixture.js";
import {
  operationsQueries,
  parseOperations,
  allocateCost,
  COST_KEYS,
  jsonForHtml,
  SAMPLE_LIMIT,
  MAX_INPUT_BYTES,
} from "../../scripts/lib/operations-report.mjs";

test("operator queries preserve the database and return no identities, tokens or content", () => {
  const sql = operationsFixture();
  try {
    const before = sql.prepare("SELECT total_changes() AS n").get().n;
    sql.exec("PRAGMA query_only=ON");
    const response = operationsResponse(sql),
      report = parseOperations(response, OPERATIONS_NOW);
    assert.equal(sql.prepare("SELECT total_changes() AS n").get().n, before);
    assert.doesNotMatch(
      JSON.stringify(response),
      /LEAK_|private-job|private-connection/,
    );
    assert.equal(report.metrics.connections.test.active, 1);
    assert.equal(report.metrics.connections.live.revoked, 1);
    assert.equal(report.metrics.operations.test.pending_oldest_ms, 120000);
    assert.equal(report.metrics.operations.live.pending_without_grant, 1);
    assert.equal(report.metrics.jobs.test.archive_overdue, 1);
    assert.equal(report.metrics.mail.test.accepted, 1);
    assert.equal(report.metrics.mail.test.delivered, 1);
    assert.equal(report.metrics.push.test.exhausted, 1);
    assert.equal(report.metrics.email_budget.all.daily_attempts, 22);
    assert.equal(report.metrics.email_budget.all.monthly_attempts, 24);
    assert.equal(report.metrics.google_budget.all.read_this_minute, 17);
    assert.equal(report.metrics.credit_turns.test.reserved_today_micros, 12000);
    assert.equal(report.metrics.credit_turns.test.failed_today, 1);
    assert.equal(report.metrics.core_orders.test.recorded_refund_cents, 1998);
    assert.equal(report.metrics.core_orders.live.refunded_orders, 1);
    assert.equal(report.queryReceipt.rowsWritten, 0);
    assert.equal(report.status, "attention");
    assert.match(report.launchDecision, /HOLD/);
    for (const query of operationsQueries(OPERATIONS_NOW)) {
      assert.doesNotMatch(
        query.sql,
        /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|payload|credentials|email|google_subject|fingerprint)\b(?!_)/i,
      );
      assert.doesNotMatch(query.sql, /SELECT\s+\*/i);
    }
  } finally {
    sql.close();
  }
});

test("bounded samples never masquerade as complete counters", () => {
  const sql = operationsFixture();
  try {
    const insert = sql.prepare(
      "INSERT INTO streamlion_coordination_connections_v1(id,google_subject,mode,workbook_id,folder_id,credentials,client_brand,expires_at) VALUES(?,?,'test',?,'private','encrypted','private',?)",
    );
    for (let i = 0; i < SAMPLE_LIMIT; i++)
      insert.run(
        "sample-" + i,
        "owner-" + i,
        "book-" + i,
        OPERATIONS_NOW + 10000,
      );
    const report = parseOperations(operationsResponse(sql), OPERATIONS_NOW);
    assert.equal(report.metrics.connections.all.sample_rows, SAMPLE_LIMIT + 1);
    assert.ok(
      report.findings.some(
        (x) => x.code === "truncated" && x.section === "connections",
      ),
    );
    assert.equal(report.status, "attention");
  } finally {
    sql.close();
  }
});

test("incomplete, stale, cross-timestamp and write-bearing query receipts fail closed", () => {
  const sql = operationsFixture();
  try {
    const original = operationsResponse(sql),
      clone = () => structuredClone(original);
    for (const change of [
      (input) => input.pop(),
      (input) => input[0].results[0].as_of_ms++,
      (input) => (input[0].results[0].private_content = "LEAK_INPUT"),
      (input) => (input[0].results[0].value = -1),
      (input) => input[0].results.push(input[0].results[0]),
      (input) => (input[0].meta.rows_written = 1),
      (input) => (input[0].meta.rows_read = NaN),
      (input) => (input[0].success = false),
    ]) {
      const input = clone();
      change(input);
      assert.throws(
        () => parseOperations(input, OPERATIONS_NOW),
        /^Error: operations_/,
      );
    }
    assert.throws(
      () => parseOperations(original, OPERATIONS_NOW + 86400001),
      /operations_snapshot_stale/,
    );
    assert.throws(
      () => parseOperations(original, OPERATIONS_NOW - 60001),
      /operations_snapshot_stale/,
    );
    const stale = parseOperations(original, OPERATIONS_NOW + 300001);
    assert.equal(stale.status, "attention");
    assert.ok(stale.findings.some((x) => x.code === "stale_snapshot"));
    const missingStamp = clone();
    missingStamp[0].results[0].value = 0;
    assert.throws(
      () => parseOperations(missingStamp, OPERATIONS_NOW),
      /operations_schema/,
    );
    sql
      .prepare("DELETE FROM streamlion_credit_policy_v1 WHERE mode='live'")
      .run();
    const missingPolicy = parseOperations(
      operationsResponse(sql),
      OPERATIONS_NOW,
    );
    assert.ok(
      missingPolicy.findings.some(
        (x) => x.code === "policy_missing" && x.mode === "live",
      ),
    );
  } finally {
    sql.close();
  }
});

test("cost allocation includes free and failed work, preserves unknowns and only proposes markup", () => {
  const values = Object.fromEntries(COST_KEYS.map((key) => [key, 0]));
  assert.equal(allocateCost(0, values).status, "incomplete");
  assert.equal(allocateCost(2.5, values).status, "incomplete");
  assert.deepEqual(allocateCost(10, { ...values, support: null }), {
    status: "incomplete",
    missing: ["support"],
  });
  assert.equal(
    allocateCost(10, { ...values, promotions: -1 }).status,
    "invalid",
  );
  const result = allocateCost(10, {
    ...values,
    provider: 1,
    failures: 1,
    promotions: 1,
    support: 7,
  });
  assert.equal(result.periodMicros, 10000000);
  assert.equal(result.unitMicros, 1000000);
  assert.equal(result.markupPriceMicros, 1300000);
  assert.equal(result.approved, false);
  const penny = allocateCost(3, { ...values, hosting: 0.01 });
  assert.equal(penny.unitMicros, 3334);
  assert.equal(penny.markupPriceMicros, 4335);
  const maximum = allocateCost(
    1,
    Object.fromEntries(COST_KEYS.map((key) => [key, 10000000])),
  );
  assert.equal(maximum.markupPriceMicros, 117000000000000);
});

test("private dashboard switches modes and keeps an incomplete allocation unapproved", () => {
  const sql = operationsFixture();
  let dom;
  try {
    const report = parseOperations(operationsResponse(sql), OPERATIONS_NOW);
    const template = readFileSync(
      new URL(
        "../../scripts/templates/operations-report.html",
        import.meta.url,
      ),
      "utf8",
    );
    const html = template
      .replace("/*REPORT_DATA*/", jsonForHtml(report))
      .replace(
        "/*COST_FUNCTION*/",
        `const COST_KEYS=${jsonForHtml(COST_KEYS)};\n${allocateCost.toString()}`,
      );
    assert.doesNotMatch(html, /LEAK_/);
    assert.match(html, /connect-src 'none'/);
    assert.doesNotMatch(
      jsonForHtml({ message: "</script><script>LEAK</script>" }),
      /</,
    );
    dom = new JSDOM(html, {
      runScripts: "dangerously",
      url: "http://127.0.0.1",
    });
    const document = dom.window.document;
    assert.equal(document.querySelectorAll("#cards .card").length, 6);
    assert.match(
      document.getElementById("cost-result").textContent,
      /incomplete/,
    );
    document.querySelector("[data-mode='live']").click();
    assert.equal(
      document.querySelector("[data-mode='live']").getAttribute("aria-pressed"),
      "true",
    );
    assert.match(
      document.getElementById("findings").textContent,
      /reconnection/,
    );
    document.getElementById("paid-units").value = "10";
    for (const key of COST_KEYS)
      document.getElementById("cost-" + key).value = "0";
    document.getElementById("cost-provider").value = "10";
    document
      .getElementById("cost-provider")
      .dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    assert.match(
      document.getElementById("cost-result").textContent,
      /Cost per paid unit \$1\.000000/,
    );
    assert.match(
      document.getElementById("cost-result").textContent,
      /30% markup \$1\.300000/,
    );
    assert.match(
      document.getElementById("cost-result").textContent,
      /Approval remains required/,
    );
  } finally {
    dom?.window.close();
    sql.close();
  }
});

test("report writer creates protected new files and refuses overwrite or unsafe input", () => {
  const directory = mkdtempSync(join(tmpdir(), "streamlion-operations-test-"));
  const sql = operationsFixture();
  try {
    const input = join(directory, "query.json"),
      output = join(directory, "report");
    const now = Date.now(),
      response = operationsResponse(sql, now);
    writeFileSync(input, JSON.stringify(response), { mode: 0o600 });
    const script = new URL(
      "../../scripts/operations-report.mjs",
      import.meta.url,
    );
    execFileSync(process.execPath, [script.pathname, "render", input, output], {
      encoding: "utf8",
    });
    assert.equal(statSync(output).mode & 0o777, 0o700);
    assert.equal(statSync(join(output, "operations.json")).mode & 0o777, 0o600);
    assert.equal(statSync(join(output, "operations.html")).mode & 0o777, 0o600);
    const saved = readFileSync(join(output, "operations.json"), "utf8");
    assert.doesNotMatch(saved, /LEAK_/);
    const again = spawnSync(
      process.execPath,
      [script.pathname, "render", input, output],
      { encoding: "utf8" },
    );
    assert.equal(again.status, 1);
    assert.equal(readFileSync(join(output, "operations.json"), "utf8"), saved);
    writeFileSync(input, "LEAK_INVALID_PRIVATE_INPUT");
    const invalid = spawnSync(
      process.execPath,
      [script.pathname, "render", input, join(directory, "invalid")],
      { encoding: "utf8" },
    );
    assert.equal(invalid.status, 1);
    assert.doesNotMatch(invalid.stderr, /LEAK_|query\.json/);
    writeFileSync(input, Buffer.alloc(MAX_INPUT_BYTES + 1, 32));
    const oversized = spawnSync(
      process.execPath,
      [script.pathname, "render", input, join(directory, "oversized")],
      { encoding: "utf8" },
    );
    assert.equal(oversized.status, 1);
    assert.match(oversized.stderr, /operations_input_too_large/);
  } finally {
    sql.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
