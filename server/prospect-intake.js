import { hash, seal, unseal } from "./google-auth.js";
import {
  CoordinationError,
  DAY,
  validatePatch,
} from "../src/client-workflow.js";
import { validateFields } from "../src/project-schema.js";
import { captureEstimate } from "../src/capture-estimate.js";
import { validateIntakeAnswers } from "../src/intake-templates.js";
import { enqueueNotice } from "./coordination-notifications.js";
import { hasPurchase, paymentMode } from "./purchase-access.js";

export const randomProspectToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const validToken = (s) => /^[A-Za-z0-9_-]{43}$/.test(s || "");
const unavailable = () =>
  new CoordinationError(
    "This intake link is unavailable. Ask the provider for a new invitation.",
    404,
  );
export async function prospectSchema(env) {
  try {
    return Boolean(
      await env.GOOGLE_SESSIONS.prepare(
        "SELECT version FROM streamlion_prospect_schema_v1 WHERE version=1",
      ).first(),
    );
  } catch {
    return false;
  }
}
export async function createProspectLink(env, row, job, connection) {
  if (!(await prospectSchema(env)))
    throw new CoordinationError(
      "Share-link intake awaits activation. Email invitations remain available.",
      503,
    );
  const old = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_prospect_links_v1 WHERE job_id=?",
  )
    .bind(row.id)
    .first();
  if (old) return prospectURL(env, old);
  const token = randomProspectToken();
  // Deliberately public service wording only. Never publish the private job,
  // starting contact details, provider ID, files, financial records or history.
  const descriptor = {
    brand: connection.client_brand,
    intake: job.intake || null,
  };
  await env.GOOGLE_SESSIONS.prepare(
    "INSERT OR IGNORE INTO streamlion_prospect_links_v1(job_id,token_hash,token_cipher,public_intake,expected_email_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      row.id,
      await hash(token),
      await seal(env, token, "prospect-token:" + row.id),
      await seal(env, descriptor, "prospect-public:" + row.id),
      job.fields.requesterEmail ? await hash(job.fields.requesterEmail) : null,
      row.created_at,
      row.created_at + 30 * DAY,
    )
    .run();
  return prospectURL(
    env,
    await env.GOOGLE_SESSIONS.prepare(
      "SELECT * FROM streamlion_prospect_links_v1 WHERE job_id=?",
    )
      .bind(row.id)
      .first(),
  );
}
async function prospectURL(env, link) {
  const token = await unseal(
    env,
    link.token_cipher,
    "prospect-token:" + link.job_id,
  );
  return (
    env.GOOGLE_AUTH_ORIGIN +
    "/api/client-portal?job=" +
    encodeURIComponent(link.job_id) +
    "#invite=" +
    token
  );
}
async function eligible(env, token) {
  if (!validToken(token) || !(await prospectSchema(env))) throw unavailable();
  const row = await env.GOOGLE_SESSIONS.prepare(
    "SELECT p.*,j.connection_id,j.client_email,j.archived,j.closed_at,j.archive_at FROM streamlion_prospect_links_v1 p JOIN streamlion_coordination_jobs_v1 j ON j.id=p.job_id WHERE p.token_hash=?",
  )
    .bind(await hash(token))
    .first();
  if (
    !row ||
    row.revoked ||
    row.expires_at <= Date.now() ||
    row.claimed_at ||
    row.archived ||
    row.closed_at
  )
    throw unavailable();
  const connection = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_coordination_connections_v1 WHERE id=?",
  )
    .bind(row.connection_id)
    .first();
  if (
    !connection ||
    connection.revoked ||
    connection.expires_at <= Date.now() ||
    connection.mode !== paymentMode(env) ||
    !(await hasPurchase(env, connection.google_subject))
  )
    throw unavailable();
  return { row, connection };
}
export async function openProspect(env, token) {
  const { row } = await eligible(env, token);
  await env.GOOGLE_SESSIONS.prepare(
    "UPDATE streamlion_prospect_links_v1 SET opened_at=COALESCE(opened_at,?) WHERE job_id=? AND revoked=0 AND claimed_at IS NULL",
  )
    .bind(Date.now(), row.job_id)
    .run();
  return {
    jobId: row.job_id,
    ...(await unseal(env, row.public_intake, "prospect-public:" + row.job_id)),
    expiresAt: row.expires_at,
  };
}
export async function requestProspectVerification(env, body) {
  const { row } = await eligible(env, body.token);
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new CoordinationError(
      "Provide a valid email for private project access.",
    );
  const emailHash = await hash(email);
  if (row.expected_email_hash && row.expected_email_hash !== emailHash)
    return {
      message:
        "If this email matches the invitation, a verification link will be sent.",
    };
  const fields = validatePatch(body.fields, "client");
  let checked;
  try {
    checked = validateFields(fields, { requireTitle: false });
  } catch (error) {
    throw new CoordinationError(error.message);
  }
  if (!checked.requesterName || !checked.address || !checked.scope)
    throw new CoordinationError(
      "Provide your contact name, site address and requested scope. The project name can wait.",
    );
  const descriptor = await unseal(
    env,
    row.public_intake,
    "prospect-public:" + row.job_id,
  );
  validateIntakeAnswers({ intake: descriptor.intake }, checked);
  const estimate = captureEstimate(
    descriptor.intake?.estimateProfile,
    checked.propertySizeSqFt,
    body.creative === true,
  );
  const payload = {
    email,
    openedAt: row.opened_at || Date.now(),
    fields: Object.fromEntries(Object.keys(fields).map((k) => [k, checked[k]])),
    ...(estimate ? { estimate } : {}),
  };
  const token = randomProspectToken(),
    tokenHash = await hash(token),
    operation = "claim-" + crypto.randomUUID();
  const emailCipher = await seal(env, email, "job-email:" + row.job_id);
  await env.GOOGLE_SESSIONS.prepare(
    "INSERT INTO streamlion_prospect_challenges_v1(hash,job_id,email_hash,email_cipher,payload,operation,expires_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      tokenHash,
      row.job_id,
      emailHash,
      emailCipher,
      await seal(env, payload, "prospect-claim:" + row.job_id),
      operation,
      Date.now() + 20 * 60000,
    )
    .run();
  await enqueueNotice(
    env,
    { ...row, id: row.job_id, client_email: emailCipher },
    "prospect-verify-" + tokenHash,
    {
      subject: "Verify your StreamLion work-order request",
      expiresAt: Date.now() + 20 * 60000,
      text: "Verify your email to submit your request to the provider. This is an estimate and availability request, not an agreement or payment. The link expires in 20 minutes.",
      url:
        env.GOOGLE_AUTH_ORIGIN +
        "/api/client-portal?job=" +
        row.job_id +
        "#verify=" +
        token,
    },
  );
  return {
    message:
      "Check your email. Verify the private link to submit this request. No payment is due.",
  };
}
export async function verifyProspect(env, challengeHash, sessionHash, now) {
  if (!(await prospectSchema(env))) return false;
  const challenge = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_prospect_challenges_v1 WHERE hash=?",
  )
    .bind(challengeHash)
    .first();
  if (!challenge) return false;
  const valid =
    "EXISTS(SELECT 1 FROM streamlion_prospect_challenges_v1 c JOIN streamlion_coordination_jobs_v1 j ON j.id=c.job_id JOIN streamlion_coordination_connections_v1 n ON n.id=j.connection_id WHERE c.hash=? AND c.job_id=streamlion_prospect_links_v1.job_id AND c.consumed=0 AND c.expires_at>? AND j.archived=0 AND j.closed_at IS NULL AND n.revoked=0 AND n.expires_at>? AND n.mode=? AND EXISTS(SELECT 1 FROM streamlion_purchases_v1 b WHERE b.google_subject=n.google_subject AND b.mode=n.mode AND b.status='paid'))";
  const result = await env.GOOGLE_SESSIONS.batch([
    env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_prospect_links_v1 SET claimed_at=?,claimed_email_hash=?,claim_payload=?,claim_operation=? WHERE job_id=? AND claimed_at IS NULL AND revoked=0 AND expires_at>? AND (expected_email_hash IS NULL OR expected_email_hash=?) AND " +
        valid,
    ).bind(
      now,
      challenge.email_hash,
      challenge.payload,
      challenge.operation,
      challenge.job_id,
      now,
      challenge.email_hash,
      challengeHash,
      now,
      now,
      paymentMode(env),
    ),
    env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_coordination_jobs_v1 SET client_email=? WHERE id=? AND EXISTS(SELECT 1 FROM streamlion_prospect_links_v1 p WHERE p.job_id=? AND p.claim_operation=?)",
    ).bind(
      challenge.email_cipher,
      challenge.job_id,
      challenge.job_id,
      challenge.operation,
    ),
    env.GOOGLE_SESSIONS.prepare(
      "INSERT INTO streamlion_coordination_sessions_v1(hash,job_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM streamlion_prospect_links_v1 p JOIN streamlion_prospect_challenges_v1 c ON c.job_id=p.job_id WHERE c.hash=? AND c.consumed=0 AND c.expires_at>? AND p.claim_operation=c.operation AND p.revoked=0)",
    ).bind(sessionHash, challenge.job_id, now + 7 * DAY, challengeHash, now),
    env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_prospect_challenges_v1 SET consumed=1 WHERE job_id=? AND EXISTS(SELECT 1 FROM streamlion_prospect_links_v1 p WHERE p.job_id=? AND p.claimed_at IS NOT NULL)",
    ).bind(challenge.job_id, challenge.job_id),
    // Previously queued email sign-ins must not become an alternate claim path.
    env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_coordination_challenges_v1 SET consumed=1 WHERE job_id=? AND EXISTS(SELECT 1 FROM streamlion_prospect_links_v1 p WHERE p.job_id=? AND p.claimed_at IS NOT NULL)",
    ).bind(challenge.job_id, challenge.job_id),
  ]);
  if (result[2].meta.changes !== 1)
    throw new CoordinationError(
      "Link expired, already used, or this request was claimed. Ask the provider for help.",
      401,
    );
  return true;
}
export async function syncProspectClaim(env, engine, jobId) {
  if (!(await prospectSchema(env))) return;
  const link = await env.GOOGLE_SESSIONS.prepare(
    "SELECT p.* FROM streamlion_prospect_links_v1 p JOIN streamlion_coordination_jobs_v1 j ON j.id=p.job_id WHERE p.job_id=? AND j.connection_id=? AND p.claimed_at IS NOT NULL",
  )
    .bind(jobId, engine.connection.id)
    .first();
  if (!link || link.synced_at) return;
  const prior = await engine.operation(link.claim_operation);
  if (prior) {
    if (prior.state !== "complete") await engine.run(prior.id);
  } else {
    const payload = await unseal(
      env,
      link.claim_payload,
      "prospect-claim:" + jobId,
    );
    const job = (await engine.google.snapshot()).heads.get(jobId);
    if (!job)
      throw new CoordinationError(
        "Your provider is preparing this request. Retry shortly.",
        409,
      );
    await engine.command(
      link.claim_operation,
      jobId,
      { action: "claim_request", expectedRevision: job.revision, ...payload },
      { role: "system" },
    );
  }
  await env.GOOGLE_SESSIONS.prepare(
    "UPDATE streamlion_prospect_links_v1 SET synced_at=?,claim_payload=NULL WHERE job_id=? AND claim_operation=? AND EXISTS(SELECT 1 FROM streamlion_coordination_operations_v1 o WHERE o.id=? AND o.connection_id=? AND o.state='complete')",
  )
    .bind(
      Date.now(),
      jobId,
      link.claim_operation,
      link.claim_operation,
      engine.connection.id,
    )
    .run();
}
export async function prospectLinksForProvider(env, connection) {
  if (!(await prospectSchema(env))) return [];
  const rows = await env.GOOGLE_SESSIONS.prepare(
    "SELECT p.* FROM streamlion_prospect_links_v1 p JOIN streamlion_coordination_jobs_v1 j ON j.id=p.job_id WHERE j.connection_id=?",
  )
    .bind(connection.id)
    .all();
  return Promise.all(
    rows.results.map(async (r) => ({
      jobId: r.job_id,
      openedAt: r.opened_at,
      claimedAt: r.claimed_at,
      expiresAt: r.expires_at,
      revoked: Boolean(r.revoked),
      url:
        !r.revoked && !r.claimed_at && r.expires_at > Date.now()
          ? await prospectURL(env, r)
          : null,
    })),
  );
}
