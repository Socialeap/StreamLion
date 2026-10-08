import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  operationsFixture,
  OPERATIONS_NOW,
} from "../../test/operations-fixture.js";
import { collectOperations } from "../../scripts/lib/operations-collection.mjs";
import {
  MAX_ROWS_READ,
  operationsQueries,
} from "../../scripts/lib/operations-report.mjs";

function receipt(db, query) {
  return {
    status: 0,
    stdout: JSON.stringify([
      {
        results: db
          .prepare(query)
          .all()
          .map((row) => ({ ...row })),
        success: true,
        meta: { rows_read: 12, rows_written: 0, duration: 0.5 },
      },
    ]),
    stderr: "",
  };
}

test("collector obtains separate read-only sections with one timestamp and protected complete receipts", () => {
  const root = mkdtempSync(join(tmpdir(), "streamlion-collection-test-"));
  const db = operationsFixture();
  let calls = 0;
  try {
    const before = db.prepare("SELECT total_changes() AS n").get().n;
    db.exec("PRAGMA query_only=ON");
    const output = join(root, "receipt");
    const collected = collectOperations(output, {
      now: () => OPERATIONS_NOW,
      run(query) {
        calls++;
        return receipt(db, query);
      },
    });
    assert.equal(calls, operationsQueries(OPERATIONS_NOW).length);
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n, before);
    assert.equal(collected.report.metrics.mail.test.delivered, 1);
    assert.equal(collected.report.metrics.mail.live.delivered, 0);
    assert.equal(collected.report.queryReceipt.rowsWritten, 0);
    assert.equal(collected.report.queryReceipt.rowsRead, calls * 12);
    assert.doesNotMatch(
      readFileSync(collected.receiptPath, "utf8"),
      /LEAK_|private-job|private-connection/,
    );
    assert.equal(statSync(output).mode & 0o777, 0o700);
    for (const file of readdirSync(output))
      assert.equal(statSync(join(output, file)).mode & 0o777, 0o600);
    assert.throws(() =>
      collectOperations(output, {
        run() {
          calls++;
        },
      }),
    );
    assert.equal(calls, collected.queryCount);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("collector stops after a failed section and never produces a complete receipt or leaks provider errors", () => {
  const root = mkdtempSync(join(tmpdir(), "streamlion-collection-failure-"));
  const db = operationsFixture();
  let calls = 0;
  const output = join(root, "receipt");
  try {
    assert.throws(
      () =>
        collectOperations(output, {
          now: () => OPERATIONS_NOW,
          run(query) {
            calls++;
            return calls === 2
              ? {
                  status: 1,
                  stdout: "LEAK_PROVIDER_ERROR",
                  stderr: "LEAK_CREDENTIAL",
                }
              : receipt(db, query);
          },
        }),
      /^Error: operations_collection_failed$/,
    );
    assert.equal(calls, 2);
    assert.equal(existsSync(join(output, "query-results.json")), false);
    assert.equal(existsSync(join(output, "report")), false);
    assert.equal(
      statSync(join(output, "01-connections.stderr")).mode & 0o777,
      0o600,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("collector rejects writes, excess reads, missing schema and private or mismatched metrics before further requests", () => {
  const root = mkdtempSync(join(tmpdir(), "streamlion-collection-invalid-"));
  const db = operationsFixture();
  try {
    for (const [index, change] of [
      (part) => {
        part.meta.rows_written = 1;
      },
      (part) => {
        part.meta.rows_read = MAX_ROWS_READ + 1;
      },
      (part) => {
        part.results[0].value = 0;
      },
      (part) => {
        part.results[0].private_content = "LEAK_PRIVATE";
      },
      (part) => {
        part.results[0].as_of_ms++;
      },
      (part) => {
        part.results[0].mode = "live";
      },
    ].entries()) {
      let calls = 0;
      const output = join(root, `receipt-${index}`);
      assert.throws(
        () =>
          collectOperations(output, {
            now: () => OPERATIONS_NOW,
            run(query) {
              calls++;
              const result = receipt(db, query),
                parts = JSON.parse(result.stdout);
              change(parts[0]);
              result.stdout = JSON.stringify(parts);
              return result;
            },
          }),
        /^Error: operations_/,
      );
      assert.equal(calls, 1);
      assert.equal(existsSync(join(output, "query-results.json")), false);
    }
    let calls = 0;
    const insideRepository = fileURLToPath(
      new URL(`../../.operations-test-${process.pid}`, import.meta.url),
    );
    assert.throws(
      () =>
        collectOperations(insideRepository, {
          run() {
            calls++;
          },
        }),
      /operations_collection_in_repository/,
    );
    assert.equal(calls, 0);
    assert.equal(existsSync(insideRepository), false);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
