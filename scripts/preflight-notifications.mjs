// Read-only: apply nothing, classify the committed 0010 shape against a D1 inspection.
import { readFileSync } from "node:fs";
import { coordinationPreflight } from "./preflight-coordination.mjs";
try {
  console.log(
    JSON.stringify(
      coordinationPreflight(
        JSON.parse(readFileSync(process.argv[2], "utf8")),
        "0010_coordination_notifications.sql",
      ),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
