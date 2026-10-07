import { coordinationReady } from "./client-coordination.js";
import { CoordinationEngine, queueNotice } from "./coordination-engine.js";
import { unseal, seal, hash } from "./google-auth.js";
import { DAY } from "../src/client-workflow.js";
export async function maintainCoordination(env, now = Date.now()) {
  const counts = {
    recovered: 0,
    archived: 0,
    reminders: 0,
    sent: 0,
    retained: 0,
  };
  if (!(await coordinationReady(env))) return counts;
  const db = env.GOOGLE_SESSIONS;
  // Bounded batches. One unresolved operation always blocks later workbook writes.
  const pending = await db
    .prepare(
      "SELECT id,connection_id FROM streamlion_coordination_operations_v1 WHERE state='pending' ORDER BY created_at LIMIT 10",
    )
    .all();
  for (const operation of pending.results) {
    const connection = await db
      .prepare(
        "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=? AND revoked=0 AND expires_at>? AND mode=?",
      )
      .bind(operation.connection_id, now, env.STREAMLION_PAYMENTS_MODE)
      .first();
    if (!connection) continue;
    try {
      await new CoordinationEngine(env, connection).run(operation.id);
      counts.recovered++;
    } catch {
      counts.retained++;
    }
  }
  const due = await db
    .prepare(
      "SELECT * FROM streamlion_coordination_jobs_v1 WHERE archived=0 AND archive_at IS NOT NULL AND archive_at<=? ORDER BY archive_at LIMIT 10",
    )
    .bind(now + 14 * DAY)
    .all();
  for (const row of due.results) {
    const connection = await db
      .prepare(
        "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=? AND revoked=0 AND expires_at>? AND mode=?",
      )
      .bind(row.connection_id, now, env.STREAMLION_PAYMENTS_MODE)
      .first();
    if (!connection) continue;
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
      try {
        const job = (await engine.google.snapshot()).heads.get(row.id);
        if (job && job.state !== "archived") {
          await engine.command(
            await hash("archive:" + row.id + ":" + row.archive_at),
            row.id,
            { action: "archive", expectedRevision: job.revision },
            { role: "system" },
          );
          counts.archived++;
        }
      } catch {
        counts.retained++;
      }
    }
  }
  const mail = await db
    .prepare(
      "SELECT * FROM streamlion_coordination_outbox_v1 WHERE sent_at IS NULL AND attempts<10 ORDER BY created_at LIMIT 20",
    )
    .all();
  for (const row of mail.results) {
    await db
      .prepare(
        "UPDATE streamlion_coordination_outbox_v1 SET attempts=attempts+1 WHERE id=? AND sent_at IS NULL AND attempts<10",
      )
      .bind(row.id)
      .run();
    try {
      const payload = await unseal(env, row.payload, "mail:" + row.id);
      const grant = await db
        .prepare(
          "SELECT c.revoked,c.expires_at,j.archived,j.archive_at FROM streamlion_coordination_jobs_v1 j JOIN streamlion_coordination_connections_v1 c ON c.id=j.connection_id WHERE j.id=?",
        )
        .bind(row.job_id)
        .first();
      if (
        grant &&
        !grant.revoked &&
        grant.expires_at > now &&
        !grant.archived &&
        (!grant.archive_at || grant.archive_at > now) &&
        (!payload.expiresAt || payload.expiresAt > now)
      ) {
        const response = await env.COORDINATION_MAILER.fetch(
          new Request("https://mailer.internal/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": row.id,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
          }),
        );
        if (!response.ok) throw new Error("mail_unverified");
        const receipt = await response.json();
        if (receipt.accepted !== true || receipt.idempotencyKey !== row.id)
          throw new Error("mail_unverified");
      }
      await db
        .prepare(
          "UPDATE streamlion_coordination_outbox_v1 SET sent_at=?,payload=? WHERE id=? AND sent_at IS NULL",
        )
        .bind(
          now,
          await seal(env, { delivered: true }, "mail:" + row.id),
          row.id,
        )
        .run();
      counts.sent++;
    } catch {
      counts.retained++;
    }
  }
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
      .prepare("DELETE FROM streamlion_coordination_rates_v1 WHERE window<?")
      .bind(Math.floor(now / 3600000) - 24),
    db
      .prepare("DELETE FROM streamlion_coordination_outbox_v1 WHERE sent_at<?")
      .bind(now - 7 * DAY),
    // Encrypted in-flight copies are removed after verified completion. Audit events remain in Google.
    db
      .prepare(
        "DELETE FROM streamlion_coordination_operations_v1 WHERE state='complete' AND completed_at<?",
      )
      .bind(now - 30 * DAY),
  ]);
  return counts;
}
