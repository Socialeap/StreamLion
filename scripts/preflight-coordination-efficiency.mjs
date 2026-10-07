// Read-only classification. Apply nothing and inspect no project/credential content.
import { readFileSync } from "node:fs";
import { coordinationPreflight } from "./preflight-coordination.mjs";
try {
  console.log(
    JSON.stringify(
      coordinationPreflight(
        JSON.parse(readFileSync(process.argv[2], "utf8")),
        "0011_coordination_efficiency.sql",
      ),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
