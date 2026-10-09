// Read-only classification against exact 0013 definitions and all prerequisites.
import { readFileSync } from "node:fs";
import { coordinationPreflight } from "./preflight-coordination.mjs";
try {
  console.log(
    JSON.stringify(
      coordinationPreflight(
        JSON.parse(readFileSync(process.argv[2], "utf8")),
        "0013_public_intake.sql",
      ),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
