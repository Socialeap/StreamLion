import { coordinationReady } from "./client-coordination.js";
import { CoordinationEngine, queueNotice } from "./coordination-engine.js";
import { hash } from "./google-auth.js";
import { DAY } from "../src/client-workflow.js";
import { dispatchNotifications } from "./coordination-notifications.js";
import { hasPurchase } from "./purchase-access.js";
import { prospectSchema, syncProspectClaim } from "./prospect-intake.js";
import { publicIntakeSchema, syncPublicSubmission } from "./public-intake.js";
import {
  coordinationRuntime,
  deferWork,
  completeWork,
} from "./coordination-runtime.js";
export async function maintainCoordination(env, now = Date.now()) {
  const counts = {
    recovered: 0,
    archived: 0,
    reminders: 0,
    sent: 0,
    retained: 0,
    skipped: 0,
    pushed: 0,
  };
  const db = env.GOOGLE_SESSIONS;
  const started = Date.now();
  const hasProspects = await prospectSchema(env);
  const hasPublic = await publicIntakeSchema(env);
  // Privacy cleanup is D1-only: entitlement and Google availability cannot
  // extend an unaccepted request's retention period. Pending journals are
  // preserved until their authoritative agreement outcome is known.
  if (hasPublic) {
    const expired = await db
      .prepare(
        "SELECT s.job_id,s.state FROM streamlion_public_submissions_v1 s JOIN streamlion_coordination_jobs_v1 j ON j.id=s.job_id WHERE s.state IN('verification','complete') AND s.expires_at>0 AND s.expires_at<=? AND j.archived=0 AND j.closed_at IS NULL AND NOT EXISTS(SELECT 1 FROM streamlion_coordination_operations_v1 o WHERE o.job_id=s.job_id AND o.state='pending') ORDER BY s.expires_at LIMIT 20",
      )
      .bind(now)
      .all();
    for (const s of expired.results) {
      await db.batch([
        db
          .prepare(
            "UPDATE streamlion_coordination_jobs_v1 SET archived=CASE WHEN ?='verification' THEN 1 ELSE 0 END,closed_at=?,archive_at=?,client_email=CASE WHEN ?='verification' THEN '' ELSE client_email END WHERE id=? AND archived=0 AND closed_at IS NULL AND EXISTS(SELECT 1 FROM streamlion_public_submissions_v1 s WHERE s.job_id=? AND s.state=? AND s.expires_at>0 AND s.expires_at<=?) AND NOT EXISTS(SELECT 1 FROM streamlion_coordination_operations_v1 o WHERE o.job_id=? AND o.state='pending')",
          )
          .bind(
            s.state,
            now,
            now,
            s.state,
            s.job_id,
            s.job_id,
            s.state,
            now,
            s.job_id,
          ),
        db
          .prepare(
            "UPDATE streamlion_public_submissions_v1 SET state='expired',payload=NULL,challenge_hash=NULL,challenge_token=NULL,challenge_expires=NULL,verified_session_hash=NULL WHERE job_id=? AND state=? AND EXISTS(SELECT 1 FROM streamlion_coordination_jobs_v1 j WHERE j.id=? AND j.closed_at=? AND j.archive_at=?)",
          )
          .bind(s.job_id, s.state, s.job_id, now, now),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_outbox_v1 WHERE job_id=? AND id LIKE 'public-verify-%' AND EXISTS(SELECT 1 FROM streamlion_public_submissions_v1 s WHERE s.job_id=? AND s.state='expired')",
          )
          .bind(s.job_id, s.job_id),
      ]);
    }
  }
  if (!(await coordinationReady(env))) return counts;
  if (hasPublic) {
    const rows = await db
      .prepare(
        "SELECT s.*,j.connection_id FROM streamlion_public_submissions_v1 s JOIN streamlion_coordination_jobs_v1 j ON j.id=s.job_id JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id LEFT JOIN streamlion_coordination_work_schedule_v1 w ON w.kind='recovery' AND w.id=s.operation WHERE j.archived=0 AND c.revoked=0 AND c.expires_at>? AND c.mode=? AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 b WHERE b.google_subject=c.google_subject AND b.mode=c.mode AND b.status='paid') AND COALESCE(w.next_attempt_at,0)<=? AND s.state IN('pending','expired') ORDER BY s.created_at LIMIT 5",
      )
      .bind(now, env.STREAMLION_PAYMENTS_MODE, now)
      .all();
    for (const s of rows.results) {
      if (Date.now() - started >= 10000) break;
      try {
        const c = await db
          .prepare(
            "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
          )
          .bind(s.connection_id)
          .first();
        await syncPublicSubmission(
          env,
          new CoordinationEngine(env, c),
          s.job_id,
        );
        counts.recovered++;
        await completeWork(db, "recovery", s.operation);
      } catch {
        await deferWork(db, "recovery", s.operation, now);
        counts.retained++;
      }
    }
  }
  if (hasProspects) {
    const claims = await db
      .prepare(
        "SELECT p.job_id,p.claim_operation,j.connection_id FROM streamlion_prospect_links_v1 p JOIN streamlion_coordination_jobs_v1 j ON j.id=p.job_id JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id LEFT JOIN streamlion_coordination_work_schedule_v1 w ON w.kind='recovery' AND w.id=p.claim_operation WHERE p.claimed_at IS NOT NULL AND p.synced_at IS NULL AND j.archived=0 AND j.closed_at IS NULL AND c.revoked=0 AND c.expires_at>? AND c.mode=? AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 b WHERE b.google_subject=c.google_subject AND b.mode=c.mode AND b.status='paid') AND COALESCE(w.next_attempt_at,0)<=? ORDER BY p.claimed_at LIMIT 5",
      )
      .bind(now, env.STREAMLION_PAYMENTS_MODE, now)
      .all();
    for (const claim of claims.results) {
      if (Date.now() - started >= 10000) break;
      const connection = await db
        .prepare(
          "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
        )
        .bind(claim.connection_id)
        .first();
      try {
        await syncProspectClaim(
          env,
          new CoordinationEngine(env, connection),
          claim.job_id,
        );
        await completeWork(db, "recovery", claim.claim_operation);
        counts.recovered++;
      } catch {
        await deferWork(db, "recovery", claim.claim_operation, now);
        counts.retained++;
      }
    }
  }
  // Bounded batches. One unresolved operation always blocks later workbook writes.
  const pending = await db
    .prepare(
      "SELECT o.id,o.connection_id FROM streamlion_coordination_operations_v1 o JOIN streamlion_coordination_connections_v1 c ON c.id=o.connection_id LEFT JOIN streamlion_coordination_work_schedule_v1 w ON w.kind='recovery' AND w.id=o.id WHERE o.state='pending' AND c.revoked=0 AND c.expires_at>? AND c.mode=? AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 p WHERE p.google_subject=c.google_subject AND p.mode=c.mode AND p.status='paid') AND COALESCE(w.next_attempt_at,0)<=? ORDER BY o.created_at LIMIT 10",
    )
    .bind(now, env.STREAMLION_PAYMENTS_MODE, now)
    .all();
  for (const operation of pending.results) {
    if (Date.now() - started >= 20000) break;
    const connection = await db
      .prepare(
        "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=? AND revoked=0 AND expires_at>? AND mode=?",
      )
      .bind(operation.connection_id, now, env.STREAMLION_PAYMENTS_MODE)
      .first();
    if (!connection || !(await hasPurchase(env, connection.google_subject)))
      continue;
    try {
      await new CoordinationEngine(env, connection).run(operation.id);
      await completeWork(db, "recovery", operation.id);
      counts.recovered++;
    } catch {
      await deferWork(db, "recovery", operation.id, now);
      counts.retained++;
    }
  }
  const due = await db
    .prepare(
      "SELECT j.* FROM streamlion_coordination_jobs_v1 j JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id LEFT JOIN streamlion_coordination_work_schedule_v1 w ON w.kind='archive' AND w.id=j.id WHERE j.archived=0 AND j.archive_at IS NOT NULL AND j.archive_at<=? AND (j.archive_at<=? OR j.reminder_at IS NULL) AND c.revoked=0 AND c.expires_at>? AND c.mode=? AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 p WHERE p.google_subject=c.google_subject AND p.mode=c.mode AND p.status='paid') AND COALESCE(w.next_attempt_at,0)<=? AND NOT EXISTS(SELECT 1 FROM streamlion_coordination_operations_v1 o WHERE o.connection_id=j.connection_id AND o.state='pending') ORDER BY j.archive_at LIMIT 10",
    )
    .bind(now + 14 * DAY, now, now, env.STREAMLION_PAYMENTS_MODE, now)
    .all();
  for (const row of due.results) {
    if (Date.now() - started >= 20000) break;
    const connection = await db
      .prepare(
        "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=? AND revoked=0 AND expires_at>? AND mode=?",
      )
      .bind(row.connection_id, now, env.STREAMLION_PAYMENTS_MODE)
      .first();
    if (!connection || !(await hasPurchase(env, connection.google_subject)))
      continue;
    try {
      if (row.archive_at > now && !row.reminder_at) {
        await queueNotice(env, row, "expiry-" + row.id + "-" + row.archive_at, {
          subject: "Your project access ends soon",
          text:
            "Client access ends on " +
            new Date(row.archive_at).toISOString().slice(0, 10) +
            ". Save any deliverables you need or contact your provider.",
          url: env.GOOGLE_AUTH_ORIGIN + "/api/client-portal?job=" + row.id,
        });
        await db
          .prepare(
            "UPDATE streamlion_coordination_jobs_v1 SET reminder_at=? WHERE id=? AND archive_at=?",
          )
          .bind(now, row.id, row.archive_at)
          .run();
        counts.reminders++;
      }
      if (row.archive_at <= now) {
        const engine = new CoordinationEngine(env, connection);
        const job = (await engine.google.snapshot()).heads.get(row.id);
        if (job && job.state !== "archived") {
          await engine.command(
            await hash("archive:" + row.id + ":" + row.archive_at),
            row.id,
            { action: "archive", expectedRevision: job.revision },
            { role: "system" },
          );
          counts.archived++;
        } else throw new Error("archive_state_requires_review");
      }
      await completeWork(db, "archive", row.id);
    } catch {
      await deferWork(db, "archive", row.id, now);
      counts.retained++;
    }
  }
  const delivery = await dispatchNotifications(env, now);
  counts.sent += delivery.sent;
  counts.retained += delivery.retained;
  counts.skipped = delivery.skipped;
  counts.pushed = delivery.pushed;
  const cleanupAt = now + coordinationRuntime(env).cleanupMs;
  const cleanup = await db
    .prepare(
      "UPDATE streamlion_coordination_maintenance_v1 SET next_cleanup_at=? WHERE mode=? AND next_cleanup_at<=? RETURNING mode",
    )
    .bind(cleanupAt, env.STREAMLION_PAYMENTS_MODE, now)
    .first();
  if (cleanup)
    try {
      if (hasProspects)
        await db
          .prepare(
            "DELETE FROM streamlion_prospect_challenges_v1 WHERE hash IN (SELECT hash FROM streamlion_prospect_challenges_v1 WHERE expires_at<? OR consumed=1 ORDER BY expires_at LIMIT 100)",
          )
          .bind(now - DAY)
          .run();
      await db.batch([
        db
          .prepare(
            "DELETE FROM streamlion_coordination_challenges_v1 WHERE expires_at<?",
          )
          .bind(now - DAY),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_sessions_v1 WHERE expires_at<? OR revoked=1",
          )
          .bind(now),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_rates_v1 WHERE window<?",
          )
          .bind(Math.floor(now / 3600000) - 24),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_outbox_v1 WHERE sent_at<?",
          )
          .bind(now - 7 * DAY),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_push_subscriptions_v1 WHERE expires_at<?",
          )
          .bind(now),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_push_outbox_v1 WHERE sent_at<? OR (attempts>=5 AND created_at<?)",
          )
          .bind(now - 7 * DAY, now - 30 * DAY),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_email_budget_v1 WHERE day<?",
          )
          .bind(Math.floor(now / DAY) - 62),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_email_events_v1 WHERE created_at<?",
          )
          .bind(now - 7 * DAY),
        // Encrypted in-flight copies are removed after verified completion. Audit events remain in Google.
        db
          .prepare(
            "DELETE FROM streamlion_coordination_operations_v1 WHERE state='complete' AND completed_at<?",
          )
          .bind(now - 30 * DAY),
        db.prepare(
          "DELETE FROM streamlion_coordination_work_schedule_v1 WHERE (kind='recovery' AND NOT EXISTS(SELECT 1 FROM streamlion_coordination_operations_v1 o WHERE o.id=streamlion_coordination_work_schedule_v1.id AND o.state='pending')" +
            (hasProspects
              ? " AND NOT EXISTS(SELECT 1 FROM streamlion_prospect_links_v1 p WHERE p.claim_operation=streamlion_coordination_work_schedule_v1.id AND p.claimed_at IS NOT NULL AND p.synced_at IS NULL)"
              : "") +
            ") OR (kind='archive' AND NOT EXISTS(SELECT 1 FROM streamlion_coordination_jobs_v1 j WHERE j.id=streamlion_coordination_work_schedule_v1.id AND j.archived=0))",
        ),
        db
          .prepare(
            "DELETE FROM streamlion_coordination_reads_v1 WHERE verified_at<?",
          )
          .bind(now - DAY),
      ]);
    } catch (error) {
      await db
        .prepare(
          "UPDATE streamlion_coordination_maintenance_v1 SET next_cleanup_at=0 WHERE mode=? AND next_cleanup_at=?",
        )
        .bind(env.STREAMLION_PAYMENTS_MODE, cleanupAt)
        .run();
      throw error;
    }
  return counts;
}
