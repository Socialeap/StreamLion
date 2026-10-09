// Read-only classification against the exact committed 0012 definitions.
import { readFileSync } from "node:fs";
import { coordinationPreflight } from "./preflight-coordination.mjs";
try {
  console.log(
    JSON.stringify(
      coordinationPreflight(
        JSON.parse(readFileSync(process.argv[2], "utf8")),
        "0012_prospect_intake.sql",
      ),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
