-- HOLD: review artifact only. Execute only after separate activation approval.
-- Bind ?1 to the verified private owner Google subject, ?2 to operator Date.now().
-- No job/history/balance/window changes. A repeat changes zero rows; verify state.
UPDATE streamlion_brief_policy_v1
SET daily_budget_micros=400000,total_budget_micros=400000,daily_requests=4
WHERE mode='test' AND active=1 AND price_micros=100000 AND reserve_micros=100000
  AND daily_budget_micros=300000 AND total_budget_micros=300000 AND daily_requests=3
  AND typeof(?1)='text' AND length(?1) BETWEEN 1 AND 255
  AND typeof(?2) IN ('integer','real') AND ?2=CAST(?2 AS INTEGER)
  AND ?2>=1792197962266 AND ?2<1792284362266
  AND (SELECT COUNT(*) FROM streamlion_brief_jobs_v1 WHERE mode='test')=3
  AND (SELECT COUNT(*) FROM streamlion_brief_jobs_v1
    WHERE mode='test' AND google_subject=?1 AND state='failed' AND result IS NULL
      AND price_micros=100000 AND reserve_micros=100000
      AND promotional=0 AND purchased=100000
      AND created_at>=1792197962266 AND created_at<1792284362266
      AND expires_at=created_at+86400000)=3;
