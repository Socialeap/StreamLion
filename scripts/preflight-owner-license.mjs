import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = new URL("../migrations/", import.meta.url);
const file = "0028_owner_license.sql";
const stamp = "streamlion_owner_license_schema_v1";
const normalize = (sql) => sql.trim().replace(/;$/, "").replace(/\s+/g, " ");
const same = (a, b) =>
  a?.type === b.type &&
  typeof a.sql === "string" &&
  normalize(a.sql) === normalize(b.sql);

function classify(input, projectionOnly) {
  if (!Array.isArray(input?.schema) || !input.stamps)
    throw Error("Provide the complete schema and version stamps; STOP.");
  const actual = new Map(input.schema.map((row) => [row.name, row]));
  if (actual.size !== input.schema.length)
    throw Error("Duplicate schema marker; STOP.");
  if (
    projectionOnly &&
    !actual.has(stamp) &&
    !Object.hasOwn(input.stamps, stamp) &&
    !input.schema.some((row) =>
      /^(streamlion_(active_)?owner_license)/.test(row.name),
    )
  )
    return { input };
  const db = new DatabaseSync(":memory:");
  try {
    const savedCards =
      actual.has("streamlion_credit_cards_schema_v1") ||
      actual.has("streamlion_credit_cards_v1") ||
      actual.has("streamlion_credit_topups_v1") ||
      Object.hasOwn(input.stamps, "streamlion_credit_cards_schema_v1");
    for (const name of readdirSync(directory)
      .filter((n) => n.endsWith(".sql") && n < file)
      .sort()) {
      if (!savedCards && name.startsWith("0017_")) continue;
      if (
        name === "0027_f3d_profile_snapshot.sql" &&
        !actual.has("streamlion_f3d_profile_v1")
      )
        continue;
      db.exec(readFileSync(new URL(name, directory), "utf8"));
    }
    const read = () =>
      db
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
        )
        .all();
    const before = new Map(read().map((row) => [row.name, row]));
    db.exec(readFileSync(new URL(file, directory), "utf8"));
    const after = read();
    const added = after.filter((r) => !before.has(r.name));
    const changed = after.filter(
      (r) => before.has(r.name) && !same(before.get(r.name), r),
    );
    const applied =
      Object.hasOwn(input.stamps, stamp) ||
      added.some((r) => actual.has(r.name)) ||
      changed.some((r) => same(actual.get(r.name), r));
    if (applied) {
      if (input.stamps[stamp] !== 1)
        throw Error("Missing or altered owner license stamp; STOP.");
      for (const row of [...added, ...changed])
        if (!same(actual.get(row.name), row))
          throw Error(
            "Missing or altered owner license schema " + row.name + "; STOP.",
          );
    }
    if (projectionOnly) {
      const addedNames = new Set(added.map((r) => r.name));
      const changedNames = new Set(changed.map((r) => r.name));
      const { [stamp]: unused, ...stamps } = input.stamps;
      return {
        input: applied
          ? {
              schema: input.schema
                .filter((r) => !addedNames.has(r.name))
                .map((r) =>
                  changedNames.has(r.name) ? before.get(r.name) : r,
                ),
              stamps,
            }
          : input,
      };
    }
    const expected = applied ? after : [...before.values()];
    for (const row of expected) {
      if (!same(actual.get(row.name), row))
        throw Error("Missing or altered schema " + row.name + "; STOP.");
      if (
        row.type === "table" &&
        row.name.endsWith("_schema_v1") &&
        input.stamps[row.name] !==
          db.prepare("SELECT version FROM " + row.name).get()?.version
      )
        throw Error("Missing or altered schema stamp " + row.name + "; STOP.");
    }
    const names = new Set(expected.map((r) => r.name));
    if (
      input.schema.some((r) => !names.has(r.name)) ||
      Object.keys(input.stamps).some((name) => !names.has(name))
    )
      throw Error("Unexpected schema object or stamp; STOP.");
    return {
      migration: applied ? "already_applied" : "pending",
      file,
      activation: false,
    };
  } finally {
    db.close();
  }
}

export const ownerLicensePreflight = (input) => classify(input, false);
export const projectBeforeOwnerLicense = (input) => classify(input, true).input;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        ownerLicensePreflight(
          JSON.parse(readFileSync(process.argv[2], "utf8")),
        ),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
