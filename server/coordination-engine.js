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
import {
  reviseIntakeTemplate,
  isIntakeTemplate,
} from "../src/intake-templates.js";
import { archiveFileID, sha256Hex } from "./coordination-archive.js";
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
      const values = [
        id,
        this.connection.id,
        jobId,
        actor,
        fingerprint,
        await seal(this.env, plan, "operation:" + id),
        Date.now(),
      ];
      if (
        plan.endAccess &&
        command.action === "archive_early" &&
        actor === "provider"
      ) {
        const deadline = plan.endAccess;
        // Match this exact encrypted journal as well as its identity. A racing
        // retry that did not insert must not mutate an older pending journal.
        const fence =
          "EXISTS(SELECT 1 FROM streamlion_coordination_operations_v1 WHERE id=? AND connection_id=? AND job_id=? AND fingerprint=? AND payload=? AND state='pending')";
        const match = [id, this.connection.id, jobId, fingerprint, values[5]];
        const result = await this.db.batch([
          this.db
            .prepare(
              "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) SELECT ?,?,?,?,?,?,? FROM streamlion_coordination_jobs_v1 WHERE id=? AND connection_id=? AND archived=0 AND closed_at=? AND archive_at IS ?",
            )
            .bind(
              ...values,
              jobId,
              this.connection.id,
              deadline.closedAt,
              deadline.previousArchiveAt,
            ),
          this.db
            .prepare(
              "UPDATE streamlion_coordination_jobs_v1 SET archive_at=?,reminder_at=NULL WHERE id=? AND connection_id=? AND " +
                fence,
            )
            .bind(deadline.until, jobId, this.connection.id, ...match),
          this.db
            .prepare(
              "UPDATE streamlion_coordination_sessions_v1 SET revoked=1 WHERE job_id=? AND " +
                fence,
            )
            .bind(jobId, ...match),
          this.db
            .prepare(
              "UPDATE streamlion_coordination_challenges_v1 SET consumed=1 WHERE job_id=? AND " +
                fence,
            )
            .bind(jobId, ...match),
        ]);
        if (result[0]?.meta?.changes !== 1)
          throw new CoordinationError(
            "Closed-job metadata changed. Preserve the record and review current status before archiving.",
            409,
          );
      } else {
        await this.db
          .prepare(
            "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(...values)
          .run();
      }
    } catch (error) {
      const existing = await this.operation(id);
      if (!existing && error instanceof CoordinationError) throw error;
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
    if (
      isIntakeTemplate(job) ||
      snapshot.heads.has(job.id) ||
      snapshot.templates?.has(job.id)
    )
      throw new CoordinationError("This job already exists.", 409);
    return this.store(
      id,
      job.id,
      "provider",
      { action: "create", job },
      { events: [eventFor(id, job, "provider", "create")] },
    );
  }
  async submitPublicRequest(id, job) {
    if (
      !operationID(id) ||
      job.source !== "public-form" ||
      job.state !== "submitted" ||
      job.provider !== this.connection.google_subject ||
      job.accepted ||
      job.providerApproved ||
      job.clientApproved
    )
      throw new CoordinationError("Invalid public request.", 403);
    const command = { action: "submit_public_request", job },
      prior = await this.operation(id);
    if (prior) {
      if (
        prior.actor !== "system" ||
        prior.job_id !== job.id ||
        prior.fingerprint !== (await hash(stableJSON(command)))
      )
        throw new CoordinationError("Request identity changed.", 409);
      return this.run(id);
    }
    if ((await this.google.snapshot()).heads.has(job.id))
      throw new CoordinationError("This request already exists.", 409);
    return this.store(id, job.id, "system", command, {
      events: [eventFor(id, job, "system", "submit_public_request")],
    });
  }
  async saveTemplate(id, input) {
    if (!operationID(id))
      throw new CoordinationError("Invalid operation identity.");
    const command = { action: "template-save", ...input };
    const prior = await this.operation(id);
    if (prior) {
      if (
        prior.actor !== "provider" ||
        prior.job_id !== input.id ||
        prior.fingerprint !== (await hash(stableJSON(command)))
      )
        throw new CoordinationError("Operation identity changed.", 409);
      return this.run(id);
    }
    const snapshot = await this.google.snapshot();
    const previous = snapshot.templates?.get(input.id);
    if (
      snapshot.heads.has(input.id) ||
      (!previous && (snapshot.templates?.size || 0) >= 20)
    )
      throw new CoordinationError(
        "This workspace supports 20 saved service templates.",
        409,
      );
    const record = reviseIntakeTemplate(
      previous,
      { ...input, provider: this.connection.google_subject },
      Date.now(),
    );
    return this.store(id, record.id, "provider", command, {
      template: eventFor(id, record, "provider", "template-save"),
    });
  }
  async restoreArchive(id, value) {
    if (!operationID(id))
      throw new CoordinationError("Invalid recovery identity.");
    const fileId = archiveFileID(value),
      command = { action: "archive-import", fileId };
    const fingerprint = await hash(stableJSON(command)),
      prior = await this.operation(id);
    if (prior) {
      if (prior.actor !== "provider" || prior.fingerprint !== fingerprint)
        throw new CoordinationError("Recovery identity changed.", 409);
      return this.run(id);
    }
    const archive = await this.google.loadArchive(fileId);
    const source = await this.db
      .prepare(
        "SELECT * FROM streamlion_coordination_connections_v1 WHERE workbook_id=? AND google_subject=? AND mode=?",
      )
      .bind(
        archive.source.workbookId,
        this.connection.google_subject,
        this.connection.mode,
      )
      .first();
    if (
      !source ||
      source.id === this.connection.id ||
      source.folder_id !== this.connection.folder_id
    )
      throw new CoordinationError(
        "Select a different compatible workbook with the archive's original private Drive folder.",
        409,
      );
    const row = await this.db
      .prepare(
        "SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=? AND connection_id=? AND archived=1 AND closed_at=? AND archive_at=?",
      )
      .bind(
        archive.job.id,
        source.id,
        archive.job.closedAt,
        archive.job.archiveAt,
      )
      .first();
    if (!row || archive.job.archiveAt > Date.now())
      throw new CoordinationError(
        "This archive is stale or the original job is still active. Preserve both versions for review.",
        409,
      );
    const guard = "cold-" + (await hash(id)),
      at = Date.now();
    const plan = {
      archiveImport: {
        archive,
        fileId,
        at,
        sourceConnection: source.id,
        guard,
      },
    };
    const insert = (operation, connection, payload) =>
      this.db
        .prepare(
          "INSERT INTO streamlion_coordination_operations_v1(id,connection_id,job_id,actor,fingerprint,payload,created_at) VALUES(?,?,?,'provider',?,?,?)",
        )
        .bind(operation, connection, archive.job.id, fingerprint, payload, at);
    try {
      // Both workbook gates are acquired together. No partial lock survives a
      // failed acquisition; pending recovery blocks every managed writer.
      await this.db.batch([
        insert(
          guard,
          source.id,
          await seal(
            this.env,
            {
              archiveDelegate: {
                operation: id,
                connection: this.connection.id,
              },
            },
            "operation:" + guard,
          ),
        ),
        insert(
          id,
          this.connection.id,
          await seal(this.env, plan, "operation:" + id),
        ),
      ]);
    } catch {
      const existing = await this.operation(id);
      if (
        !existing ||
        existing.fingerprint !== fingerprint ||
        existing.actor !== "provider"
      )
        throw new CoordinationError(
          "Another save is being recovered in the source or destination workbook. Recover it before restoring this archive.",
          409,
        );
    }
    return this.run(id);
  }
  async runArchiveImport(operation, plan) {
    const p = plan.archiveImport,
      archived = p.archive.job;
    const source = await this.db
      .prepare(
        "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
      )
      .bind(p.sourceConnection)
      .first();
    const guard = await this.db
      .prepare(
        "SELECT * FROM streamlion_coordination_operations_v1 WHERE id=? AND connection_id=? AND state='pending'",
      )
      .bind(p.guard, p.sourceConnection)
      .first();
    const row = await this.db
      .prepare("SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?")
      .bind(archived.id)
      .first();
    if (
      !source ||
      source.google_subject !== this.connection.google_subject ||
      source.mode !== this.connection.mode ||
      source.workbook_id !== p.archive.source.workbookId ||
      source.folder_id !== this.connection.folder_id ||
      !guard ||
      guard.actor !== "provider" ||
      guard.job_id !== archived.id ||
      guard.fingerprint !== operation.fingerprint ||
      !row ||
      row.connection_id !== source.id ||
      !row.archived ||
      row.closed_at !== archived.closedAt ||
      row.archive_at !== archived.archiveAt
    )
      throw new CoordinationError(
        "Archive source changed during recovery. Preserve both workbooks for review.",
        409,
      );
    await this.google.importArchive(p, operation.id);
    const targetJob =
      "EXISTS(SELECT 1 FROM streamlion_coordination_jobs_v1 WHERE id=? AND connection_id=? AND archived=1 AND closed_at=? AND archive_at=?)";
    const match = [
      archived.id,
      this.connection.id,
      archived.closedAt,
      archived.archiveAt,
    ];
    await this.db.batch([
      this.db
        .prepare(
          "UPDATE streamlion_coordination_jobs_v1 SET connection_id=? WHERE id=? AND connection_id=? AND archived=1 AND closed_at=? AND archive_at=?",
        )
        .bind(
          this.connection.id,
          archived.id,
          source.id,
          archived.closedAt,
          archived.archiveAt,
        ),
      this.db
        .prepare(
          "UPDATE streamlion_coordination_sessions_v1 SET revoked=1 WHERE job_id=? AND " +
            targetJob,
        )
        .bind(archived.id, ...match),
      this.db
        .prepare(
          "UPDATE streamlion_coordination_challenges_v1 SET consumed=1 WHERE job_id=? AND " +
            targetJob,
        )
        .bind(archived.id, ...match),
      this.db
        .prepare(
          "UPDATE streamlion_coordination_operations_v1 SET state='complete',completed_at=? WHERE id=? AND connection_id=? AND state='pending' AND " +
            targetJob,
        )
        .bind(Date.now(), operation.id, this.connection.id, ...match),
      this.db
        .prepare(
          "UPDATE streamlion_coordination_operations_v1 SET state='complete',completed_at=? WHERE id=? AND connection_id=? AND state='pending' AND EXISTS(SELECT 1 FROM streamlion_coordination_operations_v1 WHERE id=? AND state='complete')",
        )
        .bind(Date.now(), p.guard, source.id, operation.id),
    ]);
    if ((await this.operation(operation.id))?.state !== "complete")
      throw new CoordinationError(
        "Recovery records could not be finalized. Retry the original operation.",
        503,
      );
    return {
      operation: operation.id,
      complete: true,
      jobId: archived.id,
      archived: true,
    };
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
    if (command.action === "decline")
      plan.notifyDecline = command.notify === true;
    const archiving = ["archive", "archive_early"].includes(command.action);
    plan.revokeSessions =
      archiving ||
      Boolean(
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
    if (archiving && next.accepted) {
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
    if (archiving) {
      // Package the exact planned final archive event/projection. Its source
      // job is eligible for recovery only after this journal is completed.
      plan.archive = await this.google.archivePlan(next, {
        ...snapshot,
        events: new Map([...snapshot.events, [id, plan.events[0]]]),
        projects: {
          ...snapshot.projects,
          revisions: [
            ...snapshot.projects.revisions,
            ...(plan.projection ? [plan.projection] : []),
          ],
        },
      });
      if (command.action === "archive_early")
        plan.endAccess = {
          closedAt: job.closedAt,
          previousArchiveAt: job.archiveAt,
          until: next.archiveAt,
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
      sha256: await sha256Hex(bytes),
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
      return {
        operation: id,
        complete: true,
        ...(plan.archiveImport
          ? { jobId: plan.archiveImport.archive.job.id, archived: true }
          : {}),
      };
    if (this.connection.revoked || this.connection.expires_at <= Date.now())
      throw new CoordinationError(
        "Provider Google connection needs renewal.",
        409,
      );
    if (plan.archiveDelegate) {
      const target = await this.db
        .prepare(
          "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
        )
        .bind(plan.archiveDelegate.connection)
        .first();
      if (
        !target ||
        target.id === this.connection.id ||
        target.google_subject !== this.connection.google_subject ||
        target.mode !== this.connection.mode
      )
        throw new CoordinationError(
          "Archive recovery ownership changed. Stop for review.",
          409,
        );
      const engine = new CoordinationEngine(this.env, target);
      const primary = await engine.operation(plan.archiveDelegate.operation);
      if (
        !primary ||
        primary.actor !== "provider" ||
        primary.fingerprint !== operation.fingerprint ||
        primary.job_id !== operation.job_id
      )
        throw new CoordinationError(
          "Archive recovery journal needs review.",
          409,
        );
      const primaryPlan = await unseal(
        this.env,
        primary.payload,
        "operation:" + primary.id,
      );
      if (
        primaryPlan.archiveImport?.sourceConnection !== this.connection.id ||
        primaryPlan.archiveImport?.guard !== id
      )
        throw new CoordinationError(
          "Archive recovery journal needs review.",
          409,
        );
      return engine.run(primary.id);
    }
    if (plan.archiveImport) return this.runArchiveImport(operation, plan);
    if (plan.template) {
      // Templates share the workbook writer gate, but never a job's charge,
      // invitation, projection or client-grant lifecycle.
      await this.google.event(plan.template);
    } else if (plan.core) {
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
        await this.db.batch([
          this.db
            .prepare(
              "UPDATE streamlion_coordination_sessions_v1 SET revoked=1 WHERE job_id=?",
            )
            .bind(last.jobId),
          this.db
            .prepare(
              "UPDATE streamlion_coordination_challenges_v1 SET consumed=1 WHERE job_id=?",
            )
            .bind(last.jobId),
        ]);
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
      if (last.job.source === "public-form") {
        if (first.action === "reopen" && !last.job.accepted)
          await this.db
            .prepare(
              "UPDATE streamlion_public_submissions_v1 SET expires_at=? WHERE job_id=? AND state='complete'",
            )
            .bind(last.job.requestExpiresAt, last.jobId)
            .run();
        if (last.job.accepted)
          await this.db
            .prepare(
              "UPDATE streamlion_public_submissions_v1 SET expires_at=0 WHERE job_id=? AND state='complete'",
            )
            .bind(last.jobId)
            .run();
        if (last.job.accepted || last.job.closedAt || first.action === "reopen")
          await this.db
            .prepare(
              "UPDATE streamlion_coordination_sessions_v1 SET expires_at=? WHERE job_id=? AND revoked=0",
            )
            .bind(
              last.job.archiveAt ||
                (!last.job.accepted && last.job.requestExpiresAt) ||
                Date.now() + 90 * 86400000,
              last.jobId,
            )
            .run();
      }
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
        for (const role of recipients) {
          if (
            role === "client" &&
            ((first.action === "decline" && !plan.notifyDecline) ||
              (last.job.source === "public-form" &&
                !last.job.emailVerified &&
                !(first.action === "decline" && plan.notifyDecline)) ||
              !last.job.fields.requesterEmail)
          )
            continue;
          await queueNotice(
            this.env,
            row,
            "notice-" + id + "-" + role,
            {
              subject:
                first.action === "decline"
                  ? "Your work-order request was declined"
                  : "Your StreamLion project was updated",
              text:
                first.action === "decline"
                  ? (last.job.declineMessage ||
                      "The provider is unable to accept this request.") +
                    " Your request status page remains available for 30 days."
                  : "The project has an update. Review the current brief, outstanding actions and status in StreamLion.",
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
