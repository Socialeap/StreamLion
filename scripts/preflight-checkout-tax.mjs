// Read-only exact classification; no database/provider credentials or writes.
import { readFileSync } from "node:fs";
import { coordinationPreflight } from "./preflight-coordination.mjs";
try {
  console.log(
    JSON.stringify(
      coordinationPreflight(
        JSON.parse(readFileSync(process.argv[2], "utf8")),
        "0019_checkout_tax.sql",
      ),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
