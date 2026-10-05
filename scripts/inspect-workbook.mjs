import { readFileSync, statSync } from "node:fs";
import { inspectWorkbook } from "../src/workbook-inspection.js";
const file = process.argv[2];
if (!file || process.argv.length !== 3)
  throw new Error(
    "Usage: node scripts/inspect-workbook.mjs /path/to/private-workbook-values.json",
  );
if (statSync(file).size > 25 * 1024 * 1024)
  throw new Error(
    "Export exceeds the 25 MiB inspection limit. Inspect a protected copy in smaller parts; do not discard history.",
  );
const input = JSON.parse(readFileSync(file, "utf8"));
const tables = input.valueRanges
  ? Object.fromEntries(
      input.valueRanges.map((range) => [
        range.range.split("!")[0].replaceAll("'", ""),
        range.values || [],
      ]),
    )
  : input;
const report = inspectWorkbook(tables);
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
