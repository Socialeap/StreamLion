import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const normalize = (s) => s.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
export function expectedAdminSchema(after = true) {
  const db = new DatabaseSync(":memory:");
  try {
    const dir = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter(
        (n) =>
          n.endsWith(".sql") &&
          n <= (after ? "0025_admin_portal.sql" : "0024_instant_pilot.sql"),
      )
      .sort())
      db.exec(readFileSync(new URL(file, dir), "utf8"));
    const schema = db
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    const stamps = Object.fromEntries(
      schema
        .filter((r) => r.type === "table" && r.name.endsWith("schema_v1"))
        .map((r) => [
          r.name,
          db.prepare("SELECT version FROM " + r.name).get()?.version,
        ]),
    );
    return { schema, stamps };
  } finally {
    db.close();
  }
}
function classify(input, legacyProjection = false) {
  if (!input || !Array.isArray(input.schema) || !input.stamps)
    throw Error("Provide schema definitions and verified stamps; STOP.");
  const before = expectedAdminSchema(false),
    after = expectedAdminSchema(true),
    oldNames = new Set(before.schema.map((x) => x.name)),
    newNames = new Set(
      after.schema.filter((x) => !oldNames.has(x.name)).map((x) => x.name),
    );
  const present =
    input.schema.some((r) => newNames.has(r.name)) ||
    input.stamps.streamlion_admin_schema_v1 !== undefined;
  const expected = present ? after : before;
  if (legacyProjection && !present)
    throw Error("Legacy projection cannot authorize migration0025; STOP.");
  for (const r of expected.schema) {
    // Old coordination collectors explicitly selected streamlion_% only.
    // This compatibility path can recognize an applied successor, never
    // approve applying 0025; the public admin preflight still requires all indexes.
    if (legacyProjection && !r.name.startsWith("streamlion_")) continue;
    const matches = input.schema.filter(
      (a) => a.name === r.name && a.type === r.type,
    );
    if (
      matches.length !== 1 ||
      normalize(matches[0].sql || "") !== normalize(r.sql)
    )
      throw Error("Missing/altered schema " + r.name + "; STOP.");
  }
  for (const [name, version] of Object.entries(expected.stamps))
    if (input.stamps[name] !== version)
      throw Error("Missing/partial schema stamp " + name + "; STOP.");
  const expectedNames = new Set(expected.schema.map((r) => r.name));
  for (const r of input.schema) {
    if (r.type === "trigger" && !expectedNames.has(r.name))
      throw Error("Unexpected trigger requires review; STOP.");
  }
  return {
    migration: present ? "already_applied" : "pending",
    file: "0025_admin_portal.sql",
    activation: false,
  };
}
export const adminPreflight = (input) => classify(input);
export const adminSuccessorForLegacy = (input) => classify(input, true);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const file = process.argv[2];
    if (!file)
      throw Error(
        "Usage: node scripts/preflight-admin.mjs PRIVATE_SCHEMA_JSON",
      );
    console.log(
      JSON.stringify(
        adminPreflight(JSON.parse(readFileSync(file, "utf8"))),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
