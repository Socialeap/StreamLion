import { hash, seal, unseal } from "./google-auth.js";
import { hasPurchase, paymentMode } from "./purchase-access.js";
import { randomProspectToken } from "./prospect-intake.js";
import { CoordinationEngine, operationID } from "./coordination-engine.js";
import {
  enqueueNotice,
  emailDeliveryStatus,
} from "./coordination-notifications.js";
import {
  newClientJob,
  validatePatch,
  CoordinationError,
  DAY,
  stableJSON,
} from "../src/client-workflow.js";
import { validateFields } from "../src/project-schema.js";
import { validateIntakeAnswers } from "../src/intake-templates.js";
import { captureEstimate } from "../src/capture-estimate.js";
const validToken = (t) => /^[A-Za-z0-9_-]{43}$/.test(t || "");
const unavailable = () =>
  new CoordinationError("This form is unavailable. Contact the provider.", 404);
export async function publicIntakeSchema(env) {
  try {
    return Boolean(
      await env.GOOGLE_SESSIONS.prepare(
        "SELECT version FROM streamlion_public_intake_schema_v1 WHERE version=1",
      ).first(),
    );
  } catch {
    return false;
  }
}
async function connectionFor(env, id) {
  const c = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
  )
    .bind(id)
    .first();
  if (
    !c ||
    c.revoked ||
    c.expires_at <= Date.now() ||
    c.mode !== paymentMode(env) ||
    !(await hasPurchase(env, c.google_subject))
  )
    throw unavailable();
  return c;
}
export async function publicForm(env, token) {
  if (!validToken(token) || !(await publicIntakeSchema(env)))
    throw unavailable();
  const row = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_public_forms_v1 WHERE token_hash=? AND active=1",
  )
    .bind(await hash(token))
    .first();
  if (!row) throw unavailable();
  return { row, connection: await connectionFor(env, row.connection_id) };
}
async function formView(env, row) {
  const descriptor = await unseal(env, row.descriptor, "public-form:" + row.id);
  const token = await unseal(
    env,
    row.token_cipher,
    "public-form-token:" + row.id,
  );
  return {
    id: row.id,
    ...descriptor,
    active: Boolean(row.active),
    verificationRequired: Boolean(row.verification_required),
    openedAt: row.opened_at,
    requestCount: row.request_count || 0,
    url: env.GOOGLE_AUTH_ORIGIN + "/api/client-portal#form=" + token,
  };
}
export async function formsForProvider(env, c) {
  if (!(await publicIntakeSchema(env))) return [];
  const rows = await env.GOOGLE_SESSIONS.prepare(
    "SELECT f.*,(SELECT COUNT(*) FROM streamlion_public_submissions_v1 s WHERE s.form_id=f.id AND s.state='complete') AS request_count FROM streamlion_public_forms_v1 f WHERE connection_id=? ORDER BY created_at DESC",
  )
    .bind(c.id)
    .all();
  return Promise.all(rows.results.map((row) => formView(env, row)));
}
export async function createPublicForm(
  env,
  c,
  operation,
  job,
  verificationRequired = false,
) {
  if (!(await publicIntakeSchema(env)))
    throw new CoordinationError("Public forms await activation.", 503);
  if (!operationID(operation))
    throw new CoordinationError("Invalid form identity.");
  const id = "form-" + operation,
    descriptor = { brand: c.client_brand, intake: job.intake || null },
    token = randomProspectToken();
  const old = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_public_forms_v1 WHERE id=?",
  )
    .bind(id)
    .first();
  if (old) {
    if (
      old.connection_id !== c.id ||
      stableJSON(await unseal(env, old.descriptor, "public-form:" + id)) !==
        stableJSON(descriptor) ||
      Boolean(old.verification_required) !== verificationRequired
    )
      throw new CoordinationError("Form identity changed.", 409);
    return formView(env, old);
  }
  await env.GOOGLE_SESSIONS.prepare(
    "INSERT OR IGNORE INTO streamlion_public_forms_v1(id,connection_id,token_hash,token_cipher,descriptor,verification_required,created_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM streamlion_public_forms_v1 WHERE connection_id=?)<20",
  )
    .bind(
      id,
      c.id,
      await hash(token),
      await seal(env, token, "public-form-token:" + id),
      await seal(env, descriptor, "public-form:" + id),
      verificationRequired ? 1 : 0,
      Date.now(),
      c.id,
    )
    .run();
  const saved = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_public_forms_v1 WHERE id=?",
  )
    .bind(id)
    .first();
  if (!saved)
    throw new CoordinationError(
      "This workspace supports 20 public forms. Reuse or pause an existing form.",
      409,
    );
  // A concurrent retry may have inserted this identity first.
  if (
    saved.connection_id !== c.id ||
    stableJSON(await unseal(env, saved.descriptor, "public-form:" + id)) !==
      stableJSON(descriptor) ||
    Boolean(saved.verification_required) !== verificationRequired
  )
    throw new CoordinationError("Form identity changed.", 409);
  return formView(env, saved);
}
export async function updatePublicForm(env, c, body) {
  if (
    typeof body.active !== "boolean" ||
    typeof body.verificationRequired !== "boolean"
  )
    throw new CoordinationError(
      "Choose public access and email confirmation preferences.",
    );
  const result = await env.GOOGLE_SESSIONS.prepare(
    "UPDATE streamlion_public_forms_v1 SET active=?,verification_required=? WHERE id=? AND connection_id=?",
  )
    .bind(
      body.active ? 1 : 0,
      body.verificationRequired ? 1 : 0,
      body.formId,
      c.id,
    )
    .run();
  if (result.meta.changes !== 1) throw unavailable();
  return { updated: true };
}
export async function openPublicForm(env, token) {
  const { row } = await publicForm(env, token),
    now = Date.now();
  await env.GOOGLE_SESSIONS.prepare(
    "UPDATE streamlion_public_forms_v1 SET opened_at=COALESCE(opened_at,?) WHERE id=?",
  )
    .bind(now, row.id)
    .run();
  const descriptor = await unseal(env, row.descriptor, "public-form:" + row.id);
  return {
    ...descriptor,
    reusable: true,
    verificationRequired: Boolean(row.verification_required),
    visit: await seal(env, { formId: row.id, openedAt: now }, "public-visit"),
  };
}
export async function syncPublicSubmission(env, engine, jobId) {
  if (!(await publicIntakeSchema(env))) return;
  const s = await env.GOOGLE_SESSIONS.prepare(
    "SELECT s.* FROM streamlion_public_submissions_v1 s JOIN streamlion_coordination_jobs_v1 j ON j.id=s.job_id WHERE s.job_id=? AND j.connection_id=? AND j.archived=0 AND s.state IN('pending','expired')",
  )
    .bind(jobId, engine.connection.id)
    .first();
  if (!s) return;
  if (s.state === "expired") {
    const id = await hash("public-expiry:" + s.operation);
    const prior = await engine.operation(id);
    if (prior) {
      if (prior.state !== "complete") await engine.run(id);
    } else {
      const job = (await engine.google.snapshot()).heads.get(jobId);
      if (!job || job.accepted)
        throw new CoordinationError(
          "Expired request needs reconciliation review.",
          409,
        );
      if (!job.closedAt)
        await engine.command(
          id,
          jobId,
          { action: "expire_request", expectedRevision: job.revision },
          { role: "system" },
        );
    }
    await env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_public_submissions_v1 SET state='complete' WHERE job_id=? AND state='expired'",
    )
      .bind(jobId)
      .run();
    return;
  }
  const prior = await engine.operation(s.operation);
  if (prior) {
    if (prior.state !== "complete") await engine.run(prior.id);
  } else
    await engine.submitPublicRequest(
      s.operation,
      await unseal(env, s.payload, "public-submission:" + jobId),
    );
  await env.GOOGLE_SESSIONS.prepare(
    "UPDATE streamlion_public_submissions_v1 SET state='complete',payload=NULL,challenge_token=NULL WHERE job_id=? AND state='pending' AND EXISTS(SELECT 1 FROM streamlion_coordination_operations_v1 o WHERE o.id=? AND o.connection_id=? AND o.state='complete')",
  )
    .bind(jobId, s.operation, engine.connection.id)
    .run();
}
export async function submitPublicForm(
  env,
  body,
  makeEngine = (c) => new CoordinationEngine(env, c),
) {
  const { row, connection } = await publicForm(env, body.token);
  if (
    !operationID(body.operation) ||
    body.operation.length > 73 ||
    !validToken(body.accessToken)
  )
    throw new CoordinationError("Invalid submission identity.");
  // Reject hidden client-supplied finance and state; all estimates are recomputed.
  const patch = validatePatch(body.fields, "client");
  const op = "public-" + body.operation,
    id = "job-" + op,
    now = Date.now();
  let s = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_public_submissions_v1 WHERE operation=?",
  )
    .bind(op)
    .first();
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (
    (email &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) ||
    (row.verification_required && !email && !s)
  )
    throw new CoordinationError(
      "Provide a valid email for the provider's email confirmation option.",
    );
  const fingerprint = await hash(
    stableJSON({
      form: row.id,
      fields: patch,
      email,
      creative: body.creative === true,
      access: await hash(body.accessToken),
    }),
  );
  if (s && (s.form_id !== row.id || s.fingerprint !== fingerprint))
    throw new CoordinationError(
      "Submission identity changed. Start a new request.",
      409,
    );
  if (!s) {
    const descriptor = await unseal(
      env,
      row.descriptor,
      "public-form:" + row.id,
    );
    let fields;
    try {
      fields = validateFields(
        { ...patch, requesterEmail: email },
        { requireTitle: false },
      );
    } catch (e) {
      throw new CoordinationError(e.message);
    }
    if (!fields.requesterName || !fields.address || !fields.scope)
      throw new CoordinationError(
        "Provide your contact name, site address and requested scope.",
      );
    validateIntakeAnswers({ intake: descriptor.intake }, fields);
    const job = newClientJob({
      id,
      provider: connection.google_subject,
      clientEmail: email,
      title: fields.title,
      prospect: true,
      now,
    });
    job.fields = { ...job.fields, ...fields };
    job.intake = descriptor.intake;
    job.state = "submitted";
    job.submittedAt = now;
    job.openedAt = now;
    job.source = "public-form";
    job.emailVerified = false;
    job.requestExpiresAt = now + 30 * DAY;
    if (body.visit) {
      const v = await unseal(env, body.visit, "public-visit");
      if (
        v.formId !== row.id ||
        v.openedAt > now ||
        now - v.openedAt > 30 * DAY
      )
        throw unavailable();
      job.openedAt = v.openedAt;
    }
    const estimate = captureEstimate(
      descriptor.intake?.estimateProfile,
      fields.propertySizeSqFt,
      body.creative === true,
    );
    if (estimate) job.estimate = estimate;
    const challenge = randomProspectToken(),
      challengeHash = row.verification_required ? await hash(challenge) : null;
    if (row.verification_required && !(await emailDeliveryStatus(env)).email)
      throw new CoordinationError(
        "Email confirmation is temporarily unavailable. Contact the provider.",
        503,
      );
    // One transaction enforces the workspace bound even for concurrent public submissions.
    await env.GOOGLE_SESSIONS.batch([
      env.GOOGLE_SESSIONS.prepare(
        "INSERT OR IGNORE INTO streamlion_coordination_jobs_v1(id,connection_id,project_id,client_email,created_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM streamlion_coordination_jobs_v1 WHERE connection_id=? AND archived=0 AND closed_at IS NULL)<100 AND EXISTS(SELECT 1 FROM streamlion_public_forms_v1 f JOIN streamlion_coordination_connections_v1 c ON c.id=f.connection_id WHERE f.id=? AND f.active=1 AND c.revoked=0 AND c.expires_at>? AND c.mode=? AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 p WHERE p.google_subject=c.google_subject AND p.mode=c.mode AND p.status='paid'))",
      ).bind(
        id,
        connection.id,
        id,
        await seal(env, email, "job-email:" + id),
        now,
        connection.id,
        row.id,
        now,
        paymentMode(env),
      ),
      env.GOOGLE_SESSIONS.prepare(
        "INSERT OR IGNORE INTO streamlion_public_submissions_v1(job_id,form_id,operation,fingerprint,access_hash,payload,state,challenge_hash,challenge_token,challenge_expires,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM streamlion_coordination_jobs_v1 WHERE id=? AND connection_id=?)",
      ).bind(
        id,
        row.id,
        op,
        fingerprint,
        await hash(body.accessToken),
        await seal(env, job, "public-submission:" + id),
        row.verification_required ? "verification" : "pending",
        challengeHash,
        row.verification_required
          ? await seal(env, challenge, "public-confirm:" + id)
          : null,
        row.verification_required ? now + 20 * 60000 : null,
        now,
        now + 30 * DAY,
        id,
        connection.id,
      ),
    ]);
    s = await env.GOOGLE_SESSIONS.prepare(
      "SELECT * FROM streamlion_public_submissions_v1 WHERE operation=?",
    )
      .bind(op)
      .first();
    if (!s)
      throw new CoordinationError(
        "The provider's request inbox is full. Contact them directly.",
        409,
      );
    if (s.fingerprint !== fingerprint || s.form_id !== row.id)
      throw new CoordinationError("Submission identity changed.", 409);
  }
  if (s.state === "verification") {
    if (s.challenge_expires <= now)
      throw new CoordinationError(
        "Confirmation expired. Start a new request.",
        409,
      );
    const mailRow = await env.GOOGLE_SESSIONS.prepare(
      "SELECT * FROM streamlion_coordination_jobs_v1 WHERE id=?",
    )
      .bind(id)
      .first();
    const challenge = await unseal(
      env,
      s.challenge_token,
      "public-confirm:" + id,
    );
    await enqueueNotice(env, mailRow, "public-verify-" + s.challenge_hash, {
      subject: "Confirm your work-order request",
      text: "The provider requires email confirmation before receiving this request. No agreement or payment occurs here. This confirmation link expires in 20 minutes.",
      url:
        env.GOOGLE_AUTH_ORIGIN +
        "/api/client-portal?job=" +
        id +
        "#verify=" +
        challenge,
      expiresAt: s.challenge_expires,
    });
  }
  if (s.state === "verification")
    return {
      verificationRequired: true,
      message:
        "Check your email to confirm and submit this request. No payment is due.",
    };
  if (s.state === "expired" || s.expires_at <= now) throw unavailable();
  await syncPublicSubmission(env, makeEngine(connection), id);
  await env.GOOGLE_SESSIONS.prepare(
    "INSERT OR IGNORE INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) VALUES(?,?,?)",
  )
    .bind(s.access_hash, id, s.expires_at)
    .run();
  return {
    jobId: id,
    url:
      env.GOOGLE_AUTH_ORIGIN +
      "/api/client-portal?job=" +
      id +
      "#access=" +
      body.accessToken,
    expiresAt: s.expires_at,
    message:
      "Request submitted. Save your private status link to follow the provider's response.",
  };
}
export async function verifyPublicSubmission(
  env,
  challengeHash,
  sessionHash,
  now,
) {
  if (!(await publicIntakeSchema(env))) return false;
  const s = await env.GOOGLE_SESSIONS.prepare(
    "SELECT s.*,f.connection_id FROM streamlion_public_submissions_v1 s JOIN streamlion_public_forms_v1 f ON f.id=s.form_id WHERE s.challenge_hash=?",
  )
    .bind(challengeHash)
    .first();
  if (!s) return false;
  if (
    s.state !== "verification" ||
    s.challenge_expires <= now ||
    s.expires_at <= now
  )
    throw new CoordinationError("Confirmation expired or already used.", 401);
  await connectionFor(env, s.connection_id);
  const job = await unseal(env, s.payload, "public-submission:" + s.job_id);
  job.emailVerified = true;
  const result = await env.GOOGLE_SESSIONS.batch([
    env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_public_submissions_v1 SET state='pending',verified_at=?,payload=?,verified_session_hash=? WHERE job_id=? AND state='verification' AND challenge_expires>? AND expires_at>? AND EXISTS(SELECT 1 FROM streamlion_public_forms_v1 f JOIN streamlion_coordination_connections_v1 c ON c.id=f.connection_id JOIN streamlion_coordination_jobs_v1 j ON j.connection_id=c.id WHERE f.id=? AND f.active=1 AND j.id=streamlion_public_submissions_v1.job_id AND j.archived=0 AND j.closed_at IS NULL AND c.revoked=0 AND c.expires_at>? AND c.mode=? AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 p WHERE p.google_subject=c.google_subject AND p.mode=c.mode AND p.status='paid'))",
    ).bind(
      now,
      await seal(env, job, "public-submission:" + s.job_id),
      sessionHash,
      s.job_id,
      now,
      now,
      s.form_id,
      now,
      paymentMode(env),
    ),
    env.GOOGLE_SESSIONS.prepare(
      "INSERT OR IGNORE INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) SELECT ?,job_id,expires_at FROM streamlion_public_submissions_v1 WHERE job_id=? AND state='pending' AND verified_session_hash=?",
    ).bind(sessionHash, s.job_id, sessionHash),
  ]);
  if (result[0].meta.changes !== 1)
    throw new CoordinationError(
      "Confirmation expired or already used. Submit a new request.",
      401,
    );
  return true;
}
