import { base64urlBytes } from "./base64.js";

// Fixed approval terms; settings may grant access, never increase these limits.
export const BRIEF_QA = Object.freeze({
  price: 100000,
  reserve: 100000,
  budget: 300000,
  attempts: 3,
  duration: 86400000,
});

export function briefQAWindow(env) {
  try {
    const subject = env.STREAMLION_BRIEF_IMPORT_QA_SUBJECT;
    const startText = env.STREAMLION_BRIEF_IMPORT_QA_START;
    const untilText = env.STREAMLION_BRIEF_IMPORT_QA_UNTIL;
    const start = Date.parse(startText),
      until = Date.parse(untilText);
    if (
      env.STREAMLION_BRIEF_IMPORT_QA_ENABLED !== "true" ||
      env.STREAMLION_BRIEF_IMPORT_QA_COST_APPROVED !== "true" ||
      env.STREAMLION_PAYMENTS_MODE !== "test" ||
      !env.OPENAI_API_KEY ||
      !env.GOOGLE_SESSIONS ||
      base64urlBytes(env.GOOGLE_TOKEN_ENCRYPTION_KEY || "").length !== 32 ||
      typeof subject !== "string" ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(subject) ||
      new Date(start).toISOString() !== startText ||
      new Date(until).toISOString() !== untilText ||
      until <= start ||
      until - start > BRIEF_QA.duration
    )
      return null;
    return { subject, start, until, expiresAt: untilText };
  } catch {
    return null;
  }
}

export function briefQAPolicy(policy) {
  return (
    policy?.active === 1 &&
    policy.price_micros === BRIEF_QA.price &&
    policy.reserve_micros === BRIEF_QA.reserve &&
    policy.daily_budget_micros === BRIEF_QA.budget &&
    policy.total_budget_micros === BRIEF_QA.budget &&
    policy.daily_requests === BRIEF_QA.attempts
  );
}

export async function briefQACapacity(db) {
  // All test-mode history counts, including failed/refunded jobs and old windows.
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS attempts,COALESCE(SUM(reserve_micros),0) AS reserved FROM streamlion_brief_jobs_v1 WHERE mode='test'",
    )
    .first();
  return {
    remaining: Math.max(0, BRIEF_QA.attempts - row.attempts),
    available:
      row.attempts < BRIEF_QA.attempts &&
      row.reserved + BRIEF_QA.reserve <= BRIEF_QA.budget,
  };
}

// Repeat fixed limits inside the atomic INSERT, protecting concurrent requests
// and a policy change after its initial read. Existing D1 triggers debit/refund.
export const BRIEF_QA_RESERVATION = ` AND p.active=1
  AND p.price_micros=100000 AND p.reserve_micros=100000
  AND p.daily_budget_micros=300000 AND p.total_budget_micros=300000 AND p.daily_requests=3
  AND COALESCE(w.balance_micros,0)=0
  AND (SELECT COUNT(*) FROM streamlion_brief_jobs_v1 WHERE mode='test')<3
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_brief_jobs_v1 WHERE mode='test')+100000<=300000`;
