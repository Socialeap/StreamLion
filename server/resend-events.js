export async function applyResendEvents(db, providerId) {
  await db
    .prepare(
      `UPDATE streamlion_coordination_outbox_v1 SET status=COALESCE(
    (SELECT status FROM streamlion_coordination_email_events_v1 WHERE provider_id=?
      ORDER BY CASE status WHEN 'complained' THEN 0 WHEN 'bounced' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END LIMIT 1),status)
    WHERE provider_id=? AND status IN ('accepted','delivered','bounced','complained','failed')`,
    )
    .bind(providerId, providerId)
    .run();
}
