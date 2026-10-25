import { observeActivity } from "./admin-data.js";
import { CoordinationError } from "../src/client-workflow.js";
export async function goodwillBalance(db, mode, subject) {
  const marker = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='view' AND name='streamlion_goodwill_available_v1'",
    )
    .first();
  if (!marker) return 0;
  const row = await db
    .prepare(
      "SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=? AND google_subject=?",
    )
    .bind(mode, subject)
    .first();
  return row?.balance_micros || 0;
}
export async function sharedWallet(db, mode, subject) {
  const cash = await db
    .prepare(
      "SELECT balance_micros FROM streamlion_credit_wallets_v1 WHERE mode=? AND google_subject=?",
    )
    .bind(mode, subject)
    .first();
  const present = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='streamlion_promotional_wallets_v1'",
    )
    .first();
  const promo = present
    ? await db
        .prepare(
          "SELECT balance_micros FROM streamlion_promotional_wallets_v1 WHERE mode=? AND google_subject=?",
        )
        .bind(mode, subject)
        .first()
    : null;
  const goodwill = await goodwillBalance(db, mode, subject);
  return {
    goodwill,
    purchased: cash?.balance_micros || 0,
    promotional: (promo?.balance_micros || 0) + goodwill,
    starter: promo?.balance_micros || 0,
    available:
      (cash?.balance_micros || 0) < 0
        ? 0
        : (cash?.balance_micros || 0) + (promo?.balance_micros || 0) + goodwill,
    hold: (cash?.balance_micros || 0) < 0,
  };
}
export async function grantStarter(db, mode, subject, now) {
  await db
    .prepare(
      "INSERT INTO streamlion_starter_grants_v1(mode,google_subject,amount,created_at) SELECT ?,?,7500000,? WHERE NOT EXISTS(SELECT 1 FROM streamlion_starter_grants_v1 WHERE mode=? AND google_subject=?)",
    )
    .bind(mode, subject, now, mode, subject)
    .run();
}
export async function reserveProject(db, mode, subject, jobId, now) {
  const id = "job:" + jobId;
  const existing = await db
    .prepare(
      "SELECT * FROM streamlion_shared_spends_v1 WHERE mode=? AND google_subject=? AND id=?",
    )
    .bind(mode, subject, id)
    .first();
  if (existing) {
    if (existing.purpose !== "coordination" || existing.state === "failed")
      throw new CoordinationError(
        "This charge requires operator reconciliation.",
        409,
      );
    return existing;
  }
  const hasGoodwill = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE name='streamlion_goodwill_available_v1'",
    )
    .first();
  const promoFunds = hasGoodwill
    ? "(COALESCE(p.balance_micros,0)+COALESCE((SELECT balance_micros FROM streamlion_goodwill_available_v1 WHERE mode=w.mode AND google_subject=w.google_subject),0))"
    : "COALESCE(p.balance_micros,0)";
  try {
    await db
      .prepare(
        `INSERT INTO streamlion_shared_spends_v1
      SELECT ?,?,?,'coordination',c.project_micros,
      MIN(c.project_micros,${promoFunds}),
      c.project_micros-MIN(c.project_micros,${promoFunds}),'reserved',?
      FROM streamlion_coordination_policy_v1 c JOIN streamlion_credit_wallets_v1 w ON w.mode=c.mode AND w.google_subject=?
      LEFT JOIN streamlion_promotional_wallets_v1 p ON p.mode=w.mode AND p.google_subject=w.google_subject
      WHERE c.mode=? AND NOT EXISTS(SELECT 1 FROM streamlion_shared_spends_v1 WHERE mode=? AND google_subject=? AND id=?)`,
      )
      .bind(mode, subject, id, now, subject, mode, mode, subject, id)
      .run();
  } catch {
    throw new CoordinationError(
      "Insufficient available credits or coordination is paused.",
      402,
    );
  }
  const spend = await db
    .prepare(
      "SELECT * FROM streamlion_shared_spends_v1 WHERE mode=? AND google_subject=? AND id=?",
    )
    .bind(mode, subject, id)
    .first();
  if (!spend)
    throw new CoordinationError("Top up credits before continuing.", 402);
  return spend;
}
export async function finishProject(db, mode, subject, jobId, state) {
  if (!["complete", "failed"].includes(state))
    throw new Error("credit_transition");
  const result = await db
    .prepare(
      "UPDATE streamlion_shared_spends_v1 SET state=? WHERE mode=? AND google_subject=? AND id=? AND state='reserved'",
    )
    .bind(state, mode, subject, "job:" + jobId)
    .run();
  if (state === "complete") {
    try {
      await observeActivity(db, mode, subject);
    } catch {
      /* reporting must not change an already-committed charge */
    }
  }
  return result;
}
