import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const normalize = (s) => s.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
export function freePilotPreflight(input) {
  if (!Array.isArray(input.schema) || !input.stamps)
    throw Error(
      "Provide schema definitions and verified version stamps; STOP.",
    );
  for (const name of [
    "streamlion_google_sessions_v1",
    "streamlion_google_request_limits_v1",
    "streamlion_purchases_v1",
  ])
    if (!input.schema.some((r) => r.name === name && r.type === "table"))
      throw Error("Missing existing prerequisite " + name + "; STOP.");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      readFileSync(
        new URL(
          "../migrations/0023_controlled_free_pilot.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const expected = db
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name LIKE 'streamlion_free_pilot_%'",
      )
      .all();
    const actual = input.schema.filter((r) =>
      r.name.startsWith("streamlion_free_pilot_"),
    );
    if (
      actual.length === 0 &&
      input.stamps.streamlion_free_pilot_schema_v1 === undefined
    )
      return {
        migration: "pending",
        file: "0023_controlled_free_pilot.sql",
        activation: false,
      };
    if (
      actual.length !== expected.length ||
      input.stamps.streamlion_free_pilot_schema_v1 !== 1
    )
      throw Error("Partial or mismatching pilot markers/stamp; STOP.");
    for (const row of expected) {
      const found = actual.find((r) => r.name === row.name);
      if (
        !found ||
        found.type !== row.type ||
        normalize(found.sql || "") !== normalize(row.sql)
      )
        throw Error("Mismatching pilot object " + row.name + "; STOP.");
    }
    return {
      migration: "already_applied",
      file: "0023_controlled_free_pilot.sql",
      activation: false,
    };
  } finally {
    db.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        freePilotPreflight(JSON.parse(readFileSync(process.argv[2], "utf8"))),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
