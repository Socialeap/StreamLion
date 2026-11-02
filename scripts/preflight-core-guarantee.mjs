import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const normalize = (s) => s.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
export function coreGuaranteePreflight(input, legacyProjection = false) {
  if (!Array.isArray(input?.schema) || !input.stamps)
    throw Error("Provide complete schema definitions and stamps; STOP.");
  const db = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../migrations/", import.meta.url);
    const cards = input.schema.some(
      (r) => r.name === "streamlion_credit_cards_schema_v1",
    );
    for (const file of readdirSync(dir)
      .filter(
        (f) =>
          f.endsWith(".sql") && f < "0026" && (cards || !f.startsWith("0017")),
      )
      .sort())
      db.exec(readFileSync(new URL(file, dir), "utf8"));
    const rows = () =>
      db
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
        )
        .all();
    const before = rows();
    db.exec(readFileSync(new URL("0026_core_guarantee.sql", dir), "utf8"));
    const after = rows();
    const markerNames = after
      .filter((r) => !before.some((b) => b.name === r.name))
      .map((r) => r.name);
    const present = markerNames.filter((n) =>
      input.schema.some((r) => r.name === n),
    );
    if (present.length && present.length !== markerNames.length)
      throw Error("Partial guarantee migration; STOP.");
    const applied = present.length === markerNames.length;
    const expectedNames = new Set(
      (applied ? after : before).map((r) => r.name),
    );
    if (
      input.schema.some(
        (r) => r.type === "trigger" && !expectedNames.has(r.name),
      )
    )
      throw Error("Unexpected trigger; STOP.");
    for (const expected of applied ? after : before) {
      if (legacyProjection && !expected.name.startsWith("streamlion_"))
        continue;
      const matches = input.schema.filter((r) => r.name === expected.name);
      if (
        matches.length !== 1 ||
        matches[0].type !== expected.type ||
        normalize(matches[0].sql) !== normalize(expected.sql)
      )
        throw Error("Partial/altered schema " + expected.name + "; STOP.");
      if (
        expected.type === "table" &&
        /schema_v\d+$/.test(expected.name) &&
        input.stamps[expected.name] !==
          db.prepare("SELECT version FROM " + expected.name).get().version
      )
        throw Error("Missing/altered " + expected.name + " stamp; STOP.");
    }
    if (
      !applied &&
      input.stamps.streamlion_core_guarantee_schema_v1 !== undefined
    )
      throw Error("Partial guarantee stamp; STOP.");
    return {
      migration: applied ? "already_applied" : "pending",
      file: "0026_core_guarantee.sql",
      activation: false,
    };
  } finally {
    db.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  try {
    console.log(
      JSON.stringify(
        coreGuaranteePreflight(
          JSON.parse(readFileSync(process.argv[2], "utf8")),
        ),
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
