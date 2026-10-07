import { hash, seal, unseal } from "./google-auth.js";
import { CoordinationGoogle } from "./coordination-google.js";
import {
  grantStarter,
  reserveProject,
  finishProject,
} from "./shared-credits.js";
import {
  CoordinationError,
  stableJSON,
  reduceClientJob,
} from "../src/client-workflow.js";
import {
  PROJECT_HEADERS,
  NOTE_HEADERS,
  readRecordHistory,
  rowFor,
} from "../src/workbook.js";
import { FIELD_KEYS } from "../src/project-schema.js";
import { readiness } from "../src/client-workflow.js";
import { WORKFLOW_AREA, validateWorkflow } from "../src/workflow.js";
import { enqueueNotice } from "./coordination-notifications.js";
export const operationID = (value) =>
  typeof value === "string" && /^[\w-]{1,80}$/.test(value);
const eventFor = (id, job, actor, action) => ({
  id,
  jobId: job.id,
  revision: job.revision,
  parent: job.revision - 1,
  at: job.updatedAt,
  actor,
  action,
  job,
});
const projectionFor = (job, snapshot, id) =>
  job.accepted &&
  (snapshot.projects.heads.find((r) => r.recordId === job.id)?.reviewState !==
    "reviewed" ||
    stableJSON(job.accepted) !==
      stableJSON(
        Object.fromEntries(
          FIELD_KEYS.map((k) => [
            k,
            snapshot.projects.heads.find((r) => r.recordId === job.id)?.[k] ||
              "",
          ]),
        ),
      ))
    ? {
        ...job.accepted,
        recordId: job.id,
        revisionId: id + "-project",
        parentRevisionId:
          snapshot.projects.heads.find((r) => r.recordId === job.id)
            ?.revisionId || "",
        updatedAt: new Date(job.updatedAt).toISOString(),
        reviewState: "reviewed",
      }
    : null;
export const queueNotice = enqueueNotice;
export class CoordinationEngine {
  constructor(
    env,
    connection,
    google = new CoordinationGoogle(env, connection),
  ) {
    this.env = env;
    this.db = env.GOOGLE_SESSIONS;
    this.connection = connection;
    this.google = google;
  }
  async operation(id) {
    return this.db
      .prepare(
        "SELECT * FROM streamlion_coordination_operations_v1 WHERE id=? AND connection_id=?",
      )
      .bind(id, this.connection.id)
      .first();
  }
  async store(id, jobId, actor, command, plan) {
    const fingerprint = await hash(stableJSON(command));
    try {
      await this.db
        .prepare(
          "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          this.connection.id,
          jobId,
          actor,
          fingerprint,
          await seal(this.env, plan, "operation:" + id),
          Date.now(),
        )
        .run();
    } catch {
      const existing = await this.operation(id);
      if (
        !existing ||
        existing.actor !== actor ||
        existing.job_id !== jobId ||
        existing.fingerprint !== fingerprint
      )
        throw new CoordinationError(
          "Another save is being recovered. Retry its original operation before changing this workbook.",
          409,
        );
    }
    return this.run(id);
  }
  async create(id, job) {
    if (!operationID(id))
      throw new CoordinationError("Invalid operation identity.");
    const prior = await this.operation(id);
    if (prior) {
      if (
        prior.actor !== "provider" ||
        prior.job_id !== job.id ||
        prior.fingerprint !==
          (await hash(stableJSON({ action: "create", job })))
      )
        throw new CoordinationError("Operation identity changed.", 409);
      return this.run(id);
    }
    const snapshot = await this.google.snapshot();
    if (snapshot.heads.has(job.id))
      throw new CoordinationError("This job already exists.", 409);
    return this.store(
      id,
      job.id,
      "provider",
      { action: "create", job },
      { events: [eventFor(id, job, "provider", "create")] },
    );
  }
  async command(id, jobId, command, actor) {
    if (!operationID(id))
      throw new CoordinationError("Invalid operation identity.");
    const prior = await this.operation(id);
    if (prior) {
      if (
        prior.actor !== actor.role ||
        prior.job_id !== jobId ||
        prior.fingerprint !== (await hash(stableJSON(command)))
      )
        throw new CoordinationError("Operation identity changed.", 409);
      return this.run(id);
    }
    const snapshot = await this.google.snapshot(),
      job = snapshot.heads.get(jobId);
    if (!job) throw new CoordinationError("Job unavailable.", 404);
    let next = reduceClientJob(job, { ...command, id }, actor, Date.now());
    const fieldHead = snapshot.projects.heads.find((r) => r.recordId === jobId);
    if (
      job.accepted &&
      (!fieldHead ||
        stableJSON(job.accepted) !==
          stableJSON(
            Object.fromEntries(FIELD_KEYS.map((k) => [k, fieldHead[k] || ""])),
          ))
    )
      throw new CoordinationError(
        "The agreed field brief changed outside coordination. Preserve both versions for review.",
        409,
      );
    const plan = { events: [eventFor(id, next, actor.role, command.action)] };
    plan.revokeSessions = Boolean(
      job.archiveAt &&
      job.archiveAt <= Date.now() &&
      ["extend", "restore", "reopen"].includes(command.action),
    );
    if (command.action === "approve" && actor.role === "provider") {
      const policy = await this.db
        .prepare(
          "SELECT * FROM streamlion_coordination_policy_v1 WHERE mode=? AND active=1",
        )
        .bind(this.connection.mode)
        .first();
      if (!policy || command.authorizedMicros !== policy.project_micros)
        throw new CoordinationError(
          "Review and authorize the current credit charge before approving.",
          409,
        );
      next.chargeAuthorizedMicros = policy.project_micros;
    }
    if (next.state === "activation_pending") {
      const policy = await this.db
        .prepare(
          "SELECT project_micros FROM streamlion_coordination_policy_v1 WHERE mode=? AND active=1",
        )
        .bind(this.connection.mode)
        .first();
      if (!policy || next.chargeAuthorizedMicros !== policy.project_micros)
        throw new CoordinationError(
          "Provider must approve the current credit price.",
          409,
        );
      next = reduceClientJob(
        next,
        { action: "activate", expectedRevision: next.revision },
        { role: "system" },
        next.updatedAt,
      );
      plan.activation = true;
      plan.events.push(eventFor(id + "-confirmed", next, "system", "activate"));
    }
    plan.projection = projectionFor(next, snapshot, id);
    if (plan.activation) {
      plan.projection.reviewState = "draft";
      plan.finalProjection = {
        ...plan.projection,
        reviewState: "reviewed",
        revisionId: id + "-ready",
        parentRevisionId: plan.projection.revisionId,
      };
    }
    if (command.action === "archive")
      plan.archive = await this.google.archivePlan(job);
    if (command.action === "archive" && next.accepted) {
      plan.projection = {
        ...next.accepted,
        recordId: next.id,
        revisionId: id + "-project",
        parentRevisionId:
          snapshot.projects.heads.find((r) => r.recordId === next.id)
            ?.revisionId || "",
        updatedAt: new Date(next.updatedAt).toISOString(),
        reviewState: "archived",
      };
    }
    return this.store(id, jobId, actor.role, command, plan);
  }
  async core(id, tab, revision) {
    const command = { tab, revision };
    const prior = await this.operation(id);
    if (prior) {
      if (
        prior.actor !== "provider" ||
        prior.fingerprint !== (await hash(stableJSON(command)))
      )
        throw new CoordinationError("Field revision identity changed.", 409);
      return this.run(id);
    }
    const snapshot = await this.google.snapshot();
    const headers = tab === "Projects" ? PROJECT_HEADERS : NOTE_HEADERS;
    readRecordHistory(
      [headers, rowFor({ ...revision, parentRevisionId: "" }, headers)],
      headers,
    );
    if (tab === "Projects" && snapshot.heads.has(revision.recordId))
      throw new CoordinationError(
        "Edit this coordinated project's brief and payment status in Client requests.",
        409,
      );
    const history = tab === "Projects" ? snapshot.projects : snapshot.notes;
    const found = history.revisions.find(
      (r) => r.revisionId === revision.revisionId,
    );
    if (found && stableJSON(found) !== stableJSON(revision))
      throw new CoordinationError("Revision identity changed.", 409);
    if (
      !found &&
      (history.heads.find((r) => r.recordId === revision.recordId)
        ?.revisionId || "") !== revision.parentRevisionId
    )
      throw new CoordinationError(
        "The field record changed. Refresh before saving.",
        409,
      );
    if (tab === "Observations") {
      const job = snapshot.heads.get(revision.projectId);
      if (job && (!job.accepted || job.closedAt))
        throw new CoordinationError(
          "This coordinated job is not open for field work.",
          409,
        );
      if (job && revision.area === WORKFLOW_AREA) {
        const checklist = validateWorkflow(JSON.parse(revision.text));
        if (
          readiness(job).length &&
          (checklist.visit === "captured" || checklist.delivery !== "not-sent")
        )
          throw new CoordinationError(
            "Resolve client questions, scope proposals and access updates before completing field work.",
            409,
          );
      }
    }
    return this.store(id, revision.recordId, "provider", command, {
      core: { tab, revision },
    });
  }
  async upload(id, jobId, data, actor) {
    if (!operationID(id))
      throw new CoordinationError("Invalid upload identity.");
    const command = { action: "upload", ...data };
    const prior = await this.operation(id);
    if (prior) {
      if (
        prior.actor !== actor.role ||
        prior.job_id !== jobId ||
        prior.fingerprint !== (await hash(stableJSON(command)))
      )
        throw new CoordinationError("Upload identity changed.", 409);
      return this.run(id);
    }
    if (
      !["application/pdf", "image/jpeg", "image/png"].includes(data.type) ||
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.length > 120 ||
      /[\\/\x00-\x1f]/.test(data.name) ||
      typeof data.content !== "string" ||
      data.content.length > 700000
    )
      throw new CoordinationError("Upload a PDF, JPEG or PNG up to 512 KiB.");
    let bytes;
    try {
      bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
    } catch {
      throw new CoordinationError("Invalid file.");
    }
    if (!bytes.length || bytes.length > 512 * 1024)
      throw new CoordinationError("Upload a file up to 512 KiB.", 413);
    const signature =
      data.type === "application/pdf"
        ? [37, 80, 68, 70, 45]
        : data.type === "image/png"
          ? [137, 80, 78, 71, 13, 10, 26, 10]
          : [255, 216, 255];
    if (signature.some((v, i) => bytes[i] !== v))
      throw new CoordinationError("File content does not match its format.");
    await this.google.privateFolder();
    const snapshot = await this.google.snapshot(),
      job = snapshot.heads.get(jobId);
    if (!job) throw new CoordinationError("Job unavailable.", 404);
    const generated = await this.google.json(
      "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files",
    );
    const attachment = {
      id,
      name: data.name.trim(),
      type: data.type,
      bytes: bytes.length,
      driveId: generated.ids[0],
      visibility:
        actor.role === "client" || data.visibility !== "provider"
          ? "client"
          : "provider",
      at: Date.now(),
    };
    const next = reduceClientJob(
      job,
      { action: "attach", attachment, expectedRevision: data.expectedRevision },
      actor,
      attachment.at,
    );
    return this.store(id, jobId, actor.role, command, {
      file: { attachment, content: data.content },
      events: [eventFor(id, next, actor.role, "attach")],
    });
  }
  async run(id) {
    const operation = await this.operation(id);
    if (!operation || operation.state === "failed")
      throw new CoordinationError("Operation unavailable.", 409);
    const plan = await unseal(this.env, operation.payload, "operation:" + id);
    if (operation.state === "complete")
      return { operation: id, complete: true };
    if (this.connection.revoked || this.connection.expires_at <= Date.now())
      throw new CoordinationError(
        "Provider Google connection needs renewal.",
        409,
      );
    if (plan.core) {
      const { tab, revision } = plan.core;
      const snapshot = await this.google.snapshot(),
        history = tab === "Projects" ? snapshot.projects : snapshot.notes;
      const found = history.revisions.find(
        (r) => r.revisionId === revision.revisionId,
      );
      if (found) {
        if (stableJSON(found) !== stableJSON(revision))
          throw new CoordinationError(
            "Revision conflict requires review.",
            409,
          );
      } else {
        if (
          (history.heads.find((r) => r.recordId === revision.recordId)
            ?.revisionId || "") !== revision.parentRevisionId
        )
          throw new CoordinationError(
            "Field record changed outside coordination. Preserve for review.",
            409,
          );
        await this.google.append(
          tab,
          rowFor(revision, tab === "Projects" ? PROJECT_HEADERS : NOTE_HEADERS),
        );
        const after = await this.google.snapshot();
        if (
          stableJSON(
            (tab === "Projects" ? after.projects : after.notes).revisions.find(
              (r) => r.revisionId === revision.revisionId,
            ),
          ) !== stableJSON(revision)
        )
          throw new CoordinationError(
            "Field save is unverified. Retry the same operation.",
            503,
          );
      }
    } else {
      const first = plan.events[0],
        last = plan.events.at(-1);
      if (plan.file) await this.google.upload(plan.file);
      if (plan.activation) {
        await grantStarter(
          this.db,
          this.connection.mode,
          this.connection.google_subject,
          Date.now(),
        );
        const spend = await reserveProject(
          this.db,
          this.connection.mode,
          this.connection.google_subject,
          last.jobId,
          Date.now(),
        );
        if (spend.amount !== last.job.chargeAuthorizedMicros)
          throw new CoordinationError(
            "Credit price changed. Stop for reconciliation.",
            409,
          );
      }
      if (plan.archive) await this.google.archive(last.job, id, plan.archive);
      await this.google.event(first);
      await this.google.projection(
        plan.projection,
        plan.finalProjection?.revisionId,
      );
      if (plan.activation) {
        await finishProject(
          this.db,
          this.connection.mode,
          this.connection.google_subject,
          last.jobId,
          "complete",
        );
        await this.google.event(last);
        await this.google.projection(plan.finalProjection);
      }
      if (plan.revokeSessions)
        await this.db
          .prepare(
            "UPDATE streamlion_coordination_sessions_v1 SET revoked=1 WHERE job_id=?",
          )
          .bind(last.jobId)
          .run();
      await this.db
        .prepare(
          "UPDATE streamlion_coordination_jobs_v1 SET closed_at=?,archive_at=?,archived=?,reminder_at=CASE WHEN archive_at IS NOT ? THEN NULL ELSE reminder_at END WHERE id=? AND connection_id=?",
        )
        .bind(
          last.job.closedAt,
          last.job.archiveAt,
          last.job.state === "archived" ? 1 : 0,
          last.job.archiveAt,
          last.jobId,
          this.connection.id,
        )
        .run();
      const row = await this.db
        .prepare(
          "SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=? AND connection_id=?",
        )
        .bind(last.jobId, this.connection.id)
        .first();
      if (
        row &&
        first.action !== "create" &&
        !(
          first.action === "attach" &&
          plan.file?.attachment.visibility === "provider"
        )
      ) {
        const recipients =
          operation.actor === "system"
            ? ["client", "provider"]
            : [operation.actor === "client" ? "provider" : "client"];
        for (const role of recipients)
          await queueNotice(
            this.env,
            row,
            "notice-" + id + "-" + role,
            {
              subject: "Your StreamLion project was updated",
              text: "The project has an update. Review the current brief, outstanding actions and status in StreamLion.",
              kind:
                ["edit", "attach"].includes(first.action) &&
                !last.job.updates.some((u) => u.id === id || !u.acknowledged)
                  ? "routine"
                  : "action",
              url:
                this.env.GOOGLE_AUTH_ORIGIN +
                (role === "client"
                  ? "/api/client-portal?job="
                  : "/api/client-requests?job=") +
                last.jobId,
            },
            role,
          );
      }
    }
    await this.db
      .prepare(
        "UPDATE streamlion_coordination_operations_v1 SET state='complete',completed_at=? WHERE id=? AND connection_id=? AND state='pending'",
      )
      .bind(Date.now(), id, this.connection.id)
      .run();
    return { operation: id, complete: true };
  }
}
// Every application writer enters the same durable gate for an enrolled workbook.
export async function managedAppend(env, session, url, body) {
  if (!env.GOOGLE_SESSIONS) return null;
  const present = await env.GOOGLE_SESSIONS.prepare(
    "SELECT name FROM sqlite_master WHERE name='streamlion_coordination_connections_v1' AND type='table'",
  ).first();
  if (!present) return null;
  const match = new URL(url).pathname.match(
    /^\/v4\/spreadsheets\/([\w-]+)\/values\/(.+):append$/,
  );
  if (!match) return null;
  const connection = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_coordination_connections_v1 WHERE google_subject=? AND workbook_id=?",
  )
    .bind(session.google_subject, match[1])
    .first();
  if (!connection) return null;
  if (connection.mode !== env.STREAMLION_PAYMENTS_MODE)
    throw new CoordinationError(
      "Coordination payment mode changed. Stop for review.",
      409,
    );
  const range = decodeURIComponent(match[2]),
    tab = range.split("!")[0];
  if (!["Projects", "Observations"].includes(tab))
    throw new CoordinationError(
      "Coordination history is writable only through its job workflow.",
      403,
    );
  const values = JSON.parse(
    typeof body === "string" ? body : new TextDecoder().decode(body),
  ).values;
  const headers = tab === "Projects" ? PROJECT_HEADERS : NOTE_HEADERS;
  if (
    !Array.isArray(values) ||
    values.length !== 1 ||
    values[0].length !== headers.length
  )
    throw new CoordinationError("Save one complete revision at a time.", 400);
  const revision = Object.fromEntries(
    headers.map((k, i) => [k, String(values[0][i] ?? "")]),
  );
  if (!operationID(revision.revisionId))
    throw new CoordinationError("Invalid field revision.");
  await new CoordinationEngine(env, connection).core(
    revision.revisionId,
    tab,
    revision,
  );
  return { updates: { updatedRows: 1 } };
}
