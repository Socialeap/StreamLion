import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { freePilotPreflight } from "./preflight-free-pilot.mjs";
const normalize = (s) => s.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
export function instantPilotPreflight(input) {
  if (!Array.isArray(input.schema) || !input.stamps)
    throw Error("Provide schema definitions and verified stamps; STOP.");
  for (const name of [
    "streamlion_google_sessions_v1",
    "streamlion_google_request_limits_v1",
    "streamlion_purchases_v1",
  ])
    if (!input.schema.some((r) => r.name === name && r.type === "table"))
      throw Error("Missing existing prerequisite " + name + "; STOP.");
  const names = [
    "streamlion_free_pilot_instant_schema_v1",
    "streamlion_free_pilot_policy_audit_v1",
    "streamlion_free_pilot_policy_guard_v1",
    "streamlion_free_pilot_policy_log_v1",
  ];
  const applied = input.schema.some(
    (r) =>
      names.includes(r.name) ||
      (r.name === "streamlion_free_pilot_policy_v1" &&
        /\badmission_mode\b/.test(r.sql || "")),
  );
  if (!applied) {
    if (freePilotPreflight(input).migration !== "already_applied")
      throw Error("Exact migration0023 is required first; STOP.");
    if (input.stamps.streamlion_free_pilot_instant_schema_v1 !== undefined)
      throw Error("Partial instant pilot stamp; STOP.");
    return {
      migration: "pending",
      file: "0024_instant_pilot.sql",
      activation: false,
    };
  }
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of [
      "0023_controlled_free_pilot.sql",
      "0024_instant_pilot.sql",
    ])
      db.exec(
        readFileSync(new URL("../migrations/" + file, import.meta.url), "utf8"),
      );
    const expected = db
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name LIKE 'streamlion_free_pilot_%'",
        )
        .all(),
      actual = input.schema.filter((r) =>
        r.name.startsWith("streamlion_free_pilot_"),
      );
    if (
      expected.length !== actual.length ||
      input.stamps.streamlion_free_pilot_schema_v1 !== 1 ||
      input.stamps.streamlion_free_pilot_instant_schema_v1 !== 1
    )
      throw Error("Partial/mismatching instant pilot markers or stamp; STOP.");
    for (const row of expected) {
      const found = actual.find(
        (r) => r.name === row.name && r.type === row.type,
      );
      if (!found || normalize(found.sql || "") !== normalize(row.sql))
        throw Error("Mismatching instant pilot schema " + row.name + "; STOP.");
    }
    return {
      migration: "already_applied",
      file: "0024_instant_pilot.sql",
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
        instantPilotPreflight(
          JSON.parse(readFileSync(process.argv[2], "utf8")),
        ),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
