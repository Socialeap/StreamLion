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

export function briefQAPolicy(policy, limits = BRIEF_QA) {
  return (
    !!limits &&
    policy?.active === 1 &&
    policy.price_micros === limits.price &&
    policy.reserve_micros === limits.reserve &&
    policy.daily_budget_micros === limits.budget &&
    policy.total_budget_micros === limits.budget &&
    policy.daily_requests === limits.attempts
  );
}

export async function briefQACapacity(db, limits = BRIEF_QA) {
  // All test-mode history counts, including failed/refunded jobs and old windows.
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS attempts,COALESCE(SUM(reserve_micros),0) AS reserved FROM streamlion_brief_jobs_v1 WHERE mode='test'",
    )
    .first();
  return {
    remaining: Math.max(0, limits.attempts - row.attempts),
    available:
      row.attempts < limits.attempts &&
      row.reserved + limits.reserve <= limits.budget,
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

// The old three reservations remain counted. Only one fourth reservation fits.
// Recheck the failed, refunded baseline inside the same atomic INSERT.
export const BRIEF_QA_REPLACEMENT_RESERVATION = ` AND p.active=1
  AND p.price_micros=100000 AND p.reserve_micros=100000
  AND p.daily_budget_micros=400000 AND p.total_budget_micros=400000 AND p.daily_requests=4
  AND COALESCE(w.balance_micros,0)=0
  AND (SELECT COUNT(*) FROM streamlion_brief_jobs_v1 WHERE mode='test')<4
  AND (SELECT COALESCE(SUM(reserve_micros),0) FROM streamlion_brief_jobs_v1 WHERE mode='test')+100000<=400000
  AND (SELECT COUNT(*) FROM
    (SELECT * FROM streamlion_brief_jobs_v1 WHERE mode='test' ORDER BY created_at,request_id LIMIT 3) original
    WHERE original.google_subject=? AND original.state='failed' AND original.result IS NULL
    AND original.price_micros=100000 AND original.reserve_micros=100000
    AND original.promotional=0 AND original.purchased=100000
    AND original.created_at>=? AND original.created_at<?
    AND original.expires_at=original.created_at+86400000)=3`;
