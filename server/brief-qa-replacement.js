import { BRIEF_QA } from "./brief-qa.js";

// One review-scoped amendment to the original window, never a recurring grant.
// No owner identity, credential, source text or live request ID is committed.
export const BRIEF_QA_REPLACEMENT = Object.freeze({
  ...BRIEF_QA,
  attempts: 4,
  budget: 400000,
  replacement: true,
  attemptLimit: 1,
  start: "2026-10-17T00:46:02.266Z",
  until: "2026-10-18T00:46:02.266Z",
});

export async function briefQALimits(env, window, db) {
  const approval = env.STREAMLION_BRIEF_IMPORT_QA_REPLACEMENT_APPROVED;
  if (approval === undefined || approval === "false") return BRIEF_QA;
  if (
    approval !== "true" ||
    !window ||
    window.start !== Date.parse(BRIEF_QA_REPLACEMENT.start) ||
    window.until !== Date.parse(BRIEF_QA_REPLACEMENT.until)
  )
    return null;
  const { results } = await db
    .prepare(
      "SELECT * FROM streamlion_brief_jobs_v1 WHERE mode='test' ORDER BY created_at,request_id LIMIT 3",
    )
    .all();
  if (
    results.length !== 3 ||
    results.some(
      (row) =>
        row.google_subject !== window.subject ||
        row.state !== "failed" ||
        row.result !== null ||
        row.price_micros !== BRIEF_QA.price ||
        row.reserve_micros !== BRIEF_QA.reserve ||
        row.promotional !== 0 ||
        row.purchased !== BRIEF_QA.price ||
        row.created_at < window.start ||
        row.created_at >= window.until ||
        row.expires_at !== row.created_at + BRIEF_QA.duration,
    )
  )
    return null;
  return BRIEF_QA_REPLACEMENT;
}
