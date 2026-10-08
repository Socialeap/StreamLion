import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  MAX_INPUT_BYTES,
  MAX_ROWS_READ,
  operationsQueries,
  parseOperations,
} from "./operations-report.mjs";

const fail = (code) => {
  throw new Error(code);
};
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const repository = realpathSync(
  fileURLToPath(new URL("../../", import.meta.url)),
);

function runWrangler(sql, directory) {
  return spawnSync(
    "npx",
    [
      "--no-install",
      "wrangler",
      "d1",
      "execute",
      "streamlion-google-sessions",
      "--env",
      "production",
      "--remote",
      "--command",
      sql,
      "--json",
    ],
    {
      cwd: repository,
      env: {
        ...process.env,
        WRANGLER_LOG_PATH: join(directory, "wrangler.log"),
      },
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: MAX_INPUT_BYTES,
      windowsHide: true,
    },
  );
}

export function collectOperations(
  output,
  { now = Date.now, run = runWrangler } = {},
) {
  const requested = resolve(output);
  const directory = join(realpathSync(dirname(requested)), basename(requested));
  const inside = relative(repository, directory);
  if (
    inside === "" ||
    (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside))
  )
    fail("operations_collection_in_repository");
  // A new protected directory is mandatory; never overwrite an earlier receipt.
  mkdirSync(directory, { mode: 0o700 });
  const asOf = now();
  const queries = operationsQueries(asOf);
  const receipts = [];
  let rowsRead = 0;
  for (const [index, query] of queries.entries()) {
    if (
      !/^(SELECT|WITH)\b/i.test(query.sql) ||
      /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|PRAGMA|ATTACH|REPLACE|VACUUM)\b/i.test(
        query.sql,
      )
    )
      fail("operations_collection_query");
    const result = run(query.sql, directory);
    const stdout = typeof result?.stdout === "string" ? result.stdout : "";
    const stderr = typeof result?.stderr === "string" ? result.stderr : "";
    if (
      Buffer.byteLength(stdout) > MAX_INPUT_BYTES ||
      Buffer.byteLength(stderr) > MAX_INPUT_BYTES
    )
      fail("operations_input_too_large");
    const stem = `${String(index).padStart(2, "0")}-${query.section}`;
    writeFileSync(join(directory, `${stem}.json`), stdout, {
      mode: 0o600,
      flag: "wx",
    });
    writeFileSync(join(directory, `${stem}.stderr`), stderr, {
      mode: 0o600,
      flag: "wx",
    });
    if (result?.status !== 0) fail("operations_collection_failed");
    let parts;
    try {
      parts = JSON.parse(stdout);
    } catch {
      fail("operations_collection_receipt");
    }
    if (!Array.isArray(parts) || parts.length !== 1)
      fail("operations_collection_receipt");
    const part = parts[0];
    if (
      part?.success !== true ||
      !Array.isArray(part.results) ||
      part.results.length !== query.expected.length ||
      !integer(part.meta?.rows_read) ||
      part.meta.rows_written !== 0 ||
      !Number.isFinite(part.meta.duration) ||
      part.meta.duration < 0
    )
      fail("operations_read_receipt");
    const expected = new Set(
      query.expected.map((row) => `${row.section}/${row.mode}/${row.metric}`),
    );
    for (const row of part.results) {
      const key = `${row?.section}/${row?.mode}/${row?.metric}`;
      if (
        !row ||
        Object.keys(row).sort().join(",") !==
          "as_of_ms,metric,mode,section,value" ||
        row.as_of_ms !== asOf ||
        !integer(row.value) ||
        !expected.delete(key)
      )
        fail("operations_metric_shape");
      if (query.section === "schema" && row.value !== 1)
        fail("operations_schema");
    }
    rowsRead += part.meta.rows_read;
    if (!integer(rowsRead) || rowsRead > MAX_ROWS_READ)
      fail("operations_collection_budget");
    receipts.push(part);
    if (Buffer.byteLength(JSON.stringify(receipts)) > MAX_INPUT_BYTES)
      fail("operations_input_too_large");
  }
  const report = parseOperations(receipts, now());
  const receiptPath = join(directory, "query-results.json");
  writeFileSync(receiptPath, JSON.stringify(receipts) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return { directory, receiptPath, report, queryCount: queries.length };
}
