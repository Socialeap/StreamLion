import { CoordinationError } from "../src/client-workflow.js";
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
  return {
    purchased: cash?.balance_micros || 0,
    promotional: promo?.balance_micros || 0,
    available:
      (cash?.balance_micros || 0) < 0
        ? 0
        : (cash?.balance_micros || 0) + (promo?.balance_micros || 0),
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
  try {
    await db
      .prepare(
        `INSERT INTO streamlion_shared_spends_v1
      SELECT ?,?,?,'coordination',c.project_micros,
      MIN(c.project_micros,COALESCE(p.balance_micros,0)),
      c.project_micros-MIN(c.project_micros,COALESCE(p.balance_micros,0)),'reserved',?
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
    throw new CoordinationError("Top up credits before confirming.", 402);
  return spend;
}
export async function finishProject(db, mode, subject, jobId, state) {
  if (!["complete", "failed"].includes(state))
    throw new Error("credit_transition");
  await db
    .prepare(
      "UPDATE streamlion_shared_spends_v1 SET state=? WHERE mode=? AND google_subject=? AND id=? AND state='reserved'",
    )
    .bind(state, mode, subject, "job:" + jobId)
    .run();
}
