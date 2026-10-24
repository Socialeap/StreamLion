// Read-only classification against the exact committed migration definitions.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adminSuccessorForLegacy } from "./preflight-admin.mjs";
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
    // Saved cards are an optional, independent schema. Later migrations may be
    // applied while that feature remains entirely absent, but never partially.
    const optionalCards = [
      "streamlion_credit_cards_v1",
      "streamlion_credit_topups_v1",
      "streamlion_credit_cards_schema_v1",
    ];
    const cardsPresent = optionalCards.filter((name) =>
      input.schema.some((row) => row.name === name),
    ).length;
    if (
      target > "0017" &&
      ((cardsPresent > 0 && cardsPresent < optionalCards.length) ||
        (!cardsPresent &&
          input.stamps.streamlion_credit_cards_schema_v1 !== undefined))
    )
      throw new Error(
        "Partial optional saved-card migration state. Stop for review.",
      );
    for (const f of readdirSync(migrations)
      .filter(
        (f) =>
          f.endsWith(".sql") &&
          f < target.slice(0, 4) &&
          !(f === "0017_streamlion_saved_cards.sql" && !cardsPresent),
      )
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
    // Later tax support adds columns to existing purchase/credit tables. Accept
    // only its exact complete shape and stamp, never arbitrary additive columns.
    if (
      target < "0019" &&
      input.stamps.streamlion_checkout_tax_schema_v1 === 1
    ) {
      db.exec(
        readFileSync(new URL("0019_checkout_tax.sql", migrations), "utf8"),
      );
      for (const r of rows()) {
        if (
          [
            "streamlion_purchases_v1",
            "streamlion_credit_orders_v1",
            "streamlion_checkout_tax_schema_v1",
          ].includes(r.name)
        )
          expected.set(r.name, r);
      }
    }
    // Business checkout is another exact additive order contract. Older
    // migration checks must understand its complete shape, without accepting
    // arbitrary/partial additions to the protected order tables.
    if (
      target < "0020" &&
      input.stamps.streamlion_checkout_business_schema_v1 === 1
    ) {
      db.exec(
        readFileSync(new URL("0020_checkout_business.sql", migrations), "utf8"),
      );
      for (const r of rows()) {
        if (
          [
            "streamlion_purchases_v1",
            "streamlion_credit_orders_v1",
            "streamlion_checkout_business_schema_v1",
          ].includes(r.name)
        )
          expected.set(r.name, r);
      }
    }
    // 0025 replaces shared funding guards. Accept the exact, stamped successor
    // only; older classifiers must never invite replay of legacy charging SQL.
    if (
      input.schema.some((r) => r.name === "streamlion_admin_schema_v1") ||
      input.stamps.streamlion_admin_schema_v1 !== undefined
    ) {
      try {
        if (adminSuccessorForLegacy(input).migration !== "already_applied")
          throw new Error("Partial admin successor");
      } catch (error) {
        throw new Error(
          "Schema mismatch: admin successor. Stop for review. " + error.message,
        );
      }
      return {
        migration: "already_applied",
        activation: false,
        newMarkers: added,
      };
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
