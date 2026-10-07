import { AI_LIMITS } from "./ai-providers.js";
export const paidCreditMode = (env) =>
  env.STREAMLION_AI_CREDITS_MODE || "disabled";
export const creditPrice = (cost) => {
  if (
    !Number.isSafeInteger(cost) ||
    cost < AI_LIMITS.reserveMicros ||
    cost > 1000000
  )
    throw new Error("credit_cost");
  return Math.ceil((cost * 130) / 100);
};
export async function creditAccount(db, mode, subject) {
  const row = await db
    .prepare(
      `SELECT p.*,COALESCE(w.balance_micros,0) AS balance_micros FROM streamlion_credit_policy_v1 p LEFT JOIN streamlion_credit_wallets_v1 w ON w.mode=p.mode AND w.google_subject=? WHERE p.mode=?`,
    )
    .bind(subject, mode)
    .first();
  if (!row) throw new Error("credit_configuration");
  return {
    ...row,
    price_micros:
      row.cost_micros >= AI_LIMITS.reserveMicros
        ? creditPrice(row.cost_micros)
        : 0,
  };
}
export async function creditCapacity(db, mode, now = Date.now()) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(reserve_micros),0) AS reserved,COALESCE(SUM(CASE WHEN created_at>=? THEN reserve_micros ELSE 0 END),0) AS dailyReserved,COALESCE(SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END),0) AS dailyAttempts FROM streamlion_credit_turns_v1 WHERE mode=?`,
    )
    .bind(now - (now % 86400000), now - (now % 86400000), mode)
    .first();
}
export async function expireCreditTurns(db, mode, now = Date.now()) {
  await db
    .prepare(
      "UPDATE streamlion_credit_turns_v1 SET state='failed' WHERE mode=? AND state='reserved' AND created_at<?",
    )
    .bind(mode, now - 300000)
    .run();
}
export async function reserveCreditTurn(
  db,
  mode,
  subject,
  id,
  price,
  now = Date.now(),
) {
  return db
    .prepare(
      "INSERT INTO streamlion_credit_turns_v1(mode,google_subject,request_id,created_at,price_micros,reserve_micros) VALUES(?,?,?,?,?,?)",
    )
    .bind(mode, subject, id, now, price, AI_LIMITS.reserveMicros)
    .run();
}
export async function finishCreditTurn(db, mode, subject, id, state) {
  return db
    .prepare(
      "UPDATE streamlion_credit_turns_v1 SET state=? WHERE mode=? AND google_subject=? AND request_id=? AND state='reserved'",
    )
    .bind(state, mode, subject, id)
    .run();
}
