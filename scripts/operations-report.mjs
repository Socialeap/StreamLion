import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  openSync,
  readSync,
  fstatSync,
  closeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  operationsQueries,
  parseOperations,
  MAX_INPUT_BYTES,
  jsonForHtml,
  allocateCost,
  COST_KEYS,
} from "./lib/operations-report.mjs";
import { collectOperations } from "./lib/operations-collection.mjs";

function readInput(path) {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES)
      throw new Error("operations_input_too_large");
    const bytes = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const n = readSync(fd, bytes, length, bytes.length - length, null);
      if (n === 0) break;
      length += n;
    }
    if (length > MAX_INPUT_BYTES) throw new Error("operations_input_too_large");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
  } finally {
    closeSync(fd);
  }
}

function writeReport(report, output) {
  const destination = resolve(output);
  // Create a NEW private folder; an existing output is never overwritten.
  mkdirSync(destination, { mode: 0o700 });
  const template = readFileSync(
    new URL("./templates/operations-report.html", import.meta.url),
    "utf8",
  );
  const html = template
    .replace("/*REPORT_DATA*/", jsonForHtml(report))
    .replace(
      "/*COST_FUNCTION*/",
      `const COST_KEYS=${jsonForHtml(COST_KEYS)};\n${allocateCost.toString()}`,
    );
  writeFileSync(
    join(destination, "operations.json"),
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  writeFileSync(join(destination, "operations.html"), html, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      written: true,
      directory: destination,
      status: report.status,
      launch: "HOLD",
    }),
  );
}

try {
  const [command, input, output] = process.argv.slice(2);
  if (command === "sql" && process.argv.length <= 4) {
    const queries = operationsQueries(input || Date.now());
    console.log(queries.map((q) => q.sql + ";").join("\n\n"));
  } else if (command === "collect" && input && process.argv.length === 4) {
    const collection = collectOperations(input);
    writeReport(collection.report, join(collection.directory, "report"));
  } else if (
    command === "render" &&
    input &&
    output &&
    process.argv.length === 5
  ) {
    writeReport(parseOperations(JSON.parse(readInput(input))), output);
  } else {
    throw new Error(
      "Usage: operations-report.mjs collect NEW-private-folder | sql [ISO-as-of] | render private-query-results.json NEW-private-output-folder",
    );
  }
} catch (error) {
  // No input contents, query response, credentials or raw filesystem error.
  const safe =
    typeof error.message === "string" &&
    /^(operations_[a-z_]+|Usage:)/.test(error.message)
      ? error.message
      : "operations_report_failed";
  console.error(safe);
  process.exitCode = 1;
}
