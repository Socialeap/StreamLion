// Read-only classification against the exact committed migration definitions.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const migrations = new URL("../migrations/", import.meta.url);
const normalized = (sql) =>
  sql.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
export function coordinationPreflight(
  input,
  target = "0009_client_coordination.sql",
) {
  if (!Array.isArray(input.schema) || !input.stamps)
    throw new Error("Provide schema rows and verified version stamps.");
  const db = new DatabaseSync(":memory:");
  try {
    for (const f of readdirSync(migrations)
      .filter((f) => f.endsWith(".sql") && f < target.slice(0, 4))
      .sort())
      db.exec(readFileSync(new URL(f, migrations), "utf8"));
    const rows = () =>
      db
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%' AND sql IS NOT NULL",
        )
        .all();
    const before = new Map(rows().map((r) => [r.name, r]));
    db.exec(readFileSync(new URL(target, migrations), "utf8"));
    const after = new Map(rows().map((r) => [r.name, r])),
      actual = new Map(input.schema.map((r) => [r.name, r]));
    const added = [...after.keys()].filter((k) => !before.has(k)),
      present = added.filter((k) => actual.has(k));
    if (present.length && present.length !== added.length)
      throw new Error(
        "Partial migration state. Stop; do not apply or synthesize SQL.",
      );
    const applied = present.length === added.length,
      expected = applied ? after : before;
    // A complete later additive notification migration is a supported 0009 state.
    if (
      target.startsWith("0009") &&
      applied &&
      input.stamps.streamlion_coordination_notifications_schema_v1 === 1
    ) {
      db.exec(
        readFileSync(
          new URL("0010_coordination_notifications.sql", migrations),
          "utf8",
        ),
      );
      for (const r of rows()) expected.set(r.name, r);
    }
    for (const [name, row] of expected) {
      const found = actual.get(name);
      if (
        !found ||
        found.type !== row.type ||
        normalized(found.sql || "") !== normalized(row.sql)
      )
        throw new Error("Schema mismatch: " + name + ". Stop for review.");
      if (name.includes("_schema_")) {
        const version = Number(name.match(/_v(\d+)$/)?.[1]);
        if (input.stamps[name] !== version)
          throw new Error("Version stamp mismatch: " + name + ".");
      }
    }
    return {
      migration: applied ? "already_applied" : "pending",
      activation: false,
      newMarkers: added,
    };
  } finally {
    db.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        coordinationPreflight(
          JSON.parse(readFileSync(process.argv[2], "utf8")),
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
