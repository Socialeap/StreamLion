import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrations = new URL("../migrations/", import.meta.url);
const file = "0029_intake_embeds.sql";
const stamp = "streamlion_intake_embed_schema_v1";
const prerequisites = [
  "streamlion_coordination_connections_v1",
  "streamlion_public_forms_v1",
  "streamlion_f3d_profile_v1",
];
const normalize = (sql) => sql?.trim().replace(/;$/, "").replace(/\s+/g, " ");

function inspect(input, project = false) {
  if (!Array.isArray(input?.schema) || !input.stamps)
    throw Error("Provide schema definitions and verified stamps; STOP.");
  const db = new DatabaseSync(":memory:");
  try {
    const rows = db.prepare(
      "SELECT name,type,sql FROM sqlite_master WHERE name LIKE 'streamlion_%'",
    );
    const actual = new Map(input.schema.map((row) => [row.name, row]));
    if (actual.size !== input.schema.length)
      throw Error("Duplicate schema marker; STOP.");
    for (const migration of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql") && name < file)
      .sort())
      db.exec(readFileSync(new URL(migration, migrations), "utf8"));
    const before = new Map(rows.all().map((row) => [row.name, row]));
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
    const added = rows.all().filter((row) => !before.has(row.name));
    db.exec(readFileSync(new URL("0030_f3d_intake_embed_publication.sql", migrations), "utf8"));
    const afterSuccessor = rows.all();
    const successorTable = afterSuccessor.find((row) => row.name === "streamlion_intake_embeds_v1");
    const markers = new Set(afterSuccessor.filter((row) => !before.has(row.name)).map((row) => row.name));
    const originalMarkers = new Set(added.map((row) => row.name));
    const successorMarkers = afterSuccessor.filter((row) => !before.has(row.name) && !originalMarkers.has(row.name));
    const present =
      Object.hasOwn(input.stamps, stamp) ||
      [...markers].some((name) => actual.has(name));

    function requireExact(expected, successor) {
      const found = actual.get(expected.name);
      if (
        found?.type !== expected.type ||
        (normalize(found?.sql) !== normalize(expected.sql) &&
          (!successor || normalize(found?.sql) !== normalize(successor.sql)))
      )
        throw Error(
          "Missing or altered intake embed schema " + expected.name + "; STOP.",
        );
    }
    if (present) {
      if (input.stamps[stamp] !== 1)
        throw Error("Missing or altered intake embed stamp; STOP.");
      for (const row of added) requireExact(row, row.name === successorTable.name ? successorTable : null);
      if (successorMarkers.some((row) => actual.has(row.name)) ||
          normalize(actual.get(successorTable.name)?.sql) === normalize(successorTable.sql)) {
        requireExact(successorTable);
        for (const row of successorMarkers) requireExact(row);
      }
    }
    if (project) {
      if (!present) return input;
      const { [stamp]: version, ...stamps } = input.stamps;
      return {
        schema: input.schema.filter((row) => !markers.has(row.name)),
        stamps,
      };
    }
    for (const name of prerequisites) requireExact(before.get(name));
    return {
      migration: present ? "already_applied" : "pending",
      file,
      activation: false,
    };
  } finally {
    db.close();
  }
}

export const intakeEmbedsPreflight = (input) => inspect(input);
export const projectBeforeIntakeEmbeds = (input) => inspect(input, true);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        intakeEmbedsPreflight(
          JSON.parse(readFileSync(process.argv[2], "utf8")),
        ),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
