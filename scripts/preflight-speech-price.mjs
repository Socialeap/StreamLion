// Read-only exact-schema classification for 0021 -> 0022; never repairs SQL.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const normalize = (s) => s.replace(/;\s*$/, "").replace(/\s+/g, " ").trim();
export function speechPricePreflight(input) {
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
    const rows = () =>
      db
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
        )
        .all();
    const before = rows();
    db.exec(
      readFileSync(
        new URL("../migrations/0022_speech_fixed_price.sql", import.meta.url),
        "utf8",
      ),
    );
    const after = rows(),
      actual = new Map(input.schema.map((r) => [r.name, r]));
    const applied =
      actual.has("streamlion_speech_pricing_schema_v1") ||
      actual.has("streamlion_speech_reserve_v2") ||
      /\bprice_micros\b/.test(
        actual.get("streamlion_speech_policy_v1")?.sql || "",
      );
    const expected = applied ? after : before,
      names = new Set(expected.map((r) => r.name));
    for (const row of expected) {
      const found = actual.get(row.name);
      if (
        !found ||
        found.type !== row.type ||
        normalize(found.sql || "") !== normalize(row.sql)
      )
        throw Error(
          "Missing, partial or mismatching speech schema: " +
            row.name +
            "; STOP.",
        );
    }
    for (const row of input.schema)
      if (
        (row.name.startsWith("streamlion_speech_") ||
          row.name.startsWith("idx_streamlion_speech_")) &&
        !names.has(row.name)
      )
        throw Error("Unexpected speech schema object: " + row.name + "; STOP.");
    if (
      input.stamps.streamlion_speech_schema_v1 !== 1 ||
      (applied
        ? input.stamps.streamlion_speech_pricing_schema_v1 !== 1
        : input.stamps.streamlion_speech_pricing_schema_v1 !== undefined)
    )
      throw Error("Speech version stamp mismatch; STOP.");
    return {
      migration: applied ? "already_applied" : "pending",
      activation: false,
      priceMicros: 12500,
      migrationFile: "0022_speech_fixed_price.sql",
    };
  } finally {
    db.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        speechPricePreflight(JSON.parse(readFileSync(process.argv[2], "utf8"))),
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
