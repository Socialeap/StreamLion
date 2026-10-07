import { hash } from "./google-auth.js";
import { stableJSON } from "../src/client-workflow.js";

const seconds = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
};
export function coordinationRuntime(env) {
  return {
    reconcileMs:
      1000 * seconds(env.COORDINATION_RECONCILE_SECONDS, 60, 30, 120),
    pollMs: 1000 * seconds(env.COORDINATION_POLL_SECONDS, 15, 15, 60),
    cleanupMs:
      1000 * seconds(env.COORDINATION_CLEANUP_SECONDS, 3600, 3600, 86400),
  };
}
export function coordinationMetric(env, values) {
  if (env.ENABLE_COORDINATION_METRICS === "true")
    console.log(
      JSON.stringify({ service: "streamlion-coordination-metric", ...values }),
    );
}
export async function efficiencySchema(env) {
  try {
    return Boolean(
      await env.GOOGLE_SESSIONS.prepare(
        "SELECT version FROM streamlion_coordination_efficiency_schema_v1 WHERE version=1",
      ).first(),
    );
  } catch {
    return false;
  }
}
// Called only AFTER live purchase/session/connection authorization. This is metadata,
// never a cached financial authority or a copy of a client/provider project view.
export async function beginRead(
  env,
  connection,
  jobId,
  request,
  extras = {},
  now = Date.now(),
) {
  const db = env.GOOGLE_SESSIONS;
  const generation = await db
    .prepare(
      "SELECT generation FROM streamlion_coordination_changes_v1 WHERE connection_id=? AND job_id=?",
    )
    .bind(connection.id, jobId)
    .first();
  const marker = await hash(
    stableJSON({
      connection: connection.id,
      mode: connection.mode,
      jobId,
      generation: generation?.generation || 0,
      brand: connection.client_brand,
      ...extras,
    }),
  );
  const previous = await db
    .prepare(
      "SELECT marker,token,verified_at FROM streamlion_coordination_reads_v1 WHERE connection_id=? AND job_id=?",
    )
    .bind(connection.id, jobId)
    .first();
  const runtime = coordinationRuntime(env);
  const token = previous?.marker === marker ? previous.token : marker;
  const unchanged =
    new URL(request.url).searchParams.get("refresh") === token &&
    previous?.marker === marker &&
    previous.verified_at <= now &&
    now - previous.verified_at < runtime.reconcileMs;
  coordinationMetric(env, {
    metric: "portal-read",
    audience: jobId ? "client" : "provider",
    unchanged,
  });
  return {
    marker,
    unchanged,
    refresh: {
      token,
      verifiedAt: unchanged ? previous.verified_at : now,
      reconcileAfterMs: runtime.reconcileMs,
      pollAfterMs: runtime.pollMs,
    },
  };
}
export async function finishRead(
  env,
  connection,
  jobId,
  read,
  snapshot,
  view = {},
) {
  const rowCounts = (snapshot.rows || []).map((r) => Math.max(0, r.length - 1));
  // Fingerprint only the authorized view. An external Google edit must change the
  // token even if another participant performed the last full reconciliation.
  read.refresh.token = await hash(stableJSON({ marker: read.marker, view }));
  await env.GOOGLE_SESSIONS.prepare(
    "INSERT INTO streamlion_coordination_reads_v1(connection_id,job_id,marker,token,verified_at,row_counts) VALUES(?,?,?,?,?,?) ON CONFLICT(connection_id,job_id) DO UPDATE SET marker=excluded.marker,token=excluded.token,verified_at=excluded.verified_at,row_counts=excluded.row_counts WHERE verified_at<=excluded.verified_at",
  )
    .bind(
      connection.id,
      jobId,
      read.marker,
      read.refresh.token,
      read.refresh.verifiedAt,
      JSON.stringify(rowCounts),
    )
    .run();
  return {
    rowCounts,
    capacityWarning: rowCounts.some((n) => n >= 8000),
    rowCeiling: 9999,
  };
}
export async function deferWork(db, kind, id, now) {
  await db
    .prepare(
      "INSERT INTO streamlion_coordination_work_schedule_v1(kind,id,attempts,next_attempt_at) VALUES(?,?,1,?) ON CONFLICT(kind,id) DO UPDATE SET attempts=attempts+1,next_attempt_at=?+MIN(3600000,60000*(1 << MIN(attempts,6)))",
    )
    .bind(kind, id, now + 60000, now)
    .run();
}
export async function completeWork(db, kind, id) {
  await db
    .prepare(
      "DELETE FROM streamlion_coordination_work_schedule_v1 WHERE kind=? AND id=?",
    )
    .bind(kind, id)
    .run();
}
