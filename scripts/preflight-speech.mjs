// Read-only: compare the exact nine migration objects and the version stamp.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const normalize = (s) => s.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
export function speechPreflight(input) {
  if (!Array.isArray(input.schema) || !input.stamps)
    throw Error("Provide schema rows and verified stamps.");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      readFileSync(
        new URL("../migrations/0021_hosted_speech.sql", import.meta.url),
        "utf8",
      ),
    );
    const expected = db
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    const actual = new Map(input.schema.map((r) => [r.name, r]));
    const present = expected.filter((r) => actual.has(r.name));
    if (!present.length) {
      if (input.stamps.streamlion_speech_schema_v1 !== undefined)
        throw Error("Unexpected stamp; STOP for review.");
      return {
        migration: "pending",
        activation: false,
        markers: expected.map((r) => r.name),
      };
    }
    if (present.length !== expected.length)
      throw Error(
        "Partial speech schema; STOP. Do not repair or substitute SQL.",
      );
    for (const row of expected) {
      const found = actual.get(row.name);
      if (
        found.type !== row.type ||
        normalize(found.sql || "") !== normalize(row.sql)
      )
        throw Error("Schema mismatch: " + row.name + "; STOP.");
    }
    if (input.stamps.streamlion_speech_schema_v1 !== 1)
      throw Error("Version stamp mismatch; STOP.");
    return {
      migration: "already_applied",
      activation: false,
      markers: expected.map((r) => r.name),
    };
  } finally {
    db.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        speechPreflight(JSON.parse(readFileSync(process.argv[2], "utf8"))),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
