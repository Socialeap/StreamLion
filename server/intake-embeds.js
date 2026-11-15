import { CoordinationError } from "../src/client-workflow.js";
import { paymentMode } from "./purchase-access.js";
import { randomProspectToken } from "./prospect-intake.js";

export const embedUnavailable = () =>
  new CoordinationError(
    "This website form is unavailable. Contact the provider.",
    404,
  );

function pilotEnabled(env, subject) {
  return (
    env.ENABLE_INTAKE_EMBEDS === "true" &&
    (env.INTAKE_EMBED_PILOT_SUBJECTS || "")
      .split(",")
      .some((entry) => entry.trim() === subject)
  );
}

async function embedSchema(env) {
  try {
    return Boolean(
      await env.GOOGLE_SESSIONS.prepare(
        "SELECT version FROM streamlion_intake_embed_schema_v1 WHERE version=1",
      ).first(),
    );
  } catch {
    return false;
  }
}

function normalizeOrigins(input) {
  if (!Array.isArray(input) || !input.length || input.length > 5)
    throw new CoordinationError("Enter one to five HTTPS website addresses.");
  const origins = input.map((value) => {
    if (
      typeof value === "string" &&
      /^https:\/\/[^\s/?#@\\*]+\/?$/i.test(value.trim()) &&
      value.length <= 200
    ) {
      try {
        const url = new URL(value.trim());
        if (
          /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
            url.hostname,
          )
        )
          return url.origin;
      } catch {
        // Reject malformed addresses below.
      }
    }
    throw new CoordinationError(
      "Use the website address without a page path, for example https://studio.example.",
    );
  });
  return [...new Set(origins)].sort();
}

// Used both when resolving the public ID and when admitting a new request.
export const embedProfileJoin = `JOIN streamlion_f3d_profile_v1 p
  ON p.mode=c.mode AND p.google_subject=c.google_subject
  AND p.f3d_account_id=e.f3d_account_id
  AND json_extract(p.snapshot,'$.businessProfile.id')=e.f3d_business_id`;

const configuration = (row) => ({
  id: row.id,
  origins: JSON.parse(row.origins),
});

export async function providerIntakeEmbeds(env, connection) {
  if (
    !pilotEnabled(env, connection.google_subject) ||
    !(await embedSchema(env))
  )
    return null;
  const { results } = await env.GOOGLE_SESSIONS.prepare(
    `SELECT e.id,e.form_id,e.origins FROM streamlion_intake_embeds_v1 e
     JOIN streamlion_public_forms_v1 f ON f.id=e.form_id WHERE f.connection_id=?`,
  )
    .bind(connection.id)
    .all();
  return Object.fromEntries(
    results.map((row) => [row.form_id, configuration(row)]),
  );
}

export async function saveIntakeEmbed(env, connection, body) {
  if (
    !pilotEnabled(env, connection.google_subject) ||
    !(await embedSchema(env))
  )
    throw embedUnavailable();
  if (typeof body?.formId !== "string" || typeof body.enabled !== "boolean")
    throw new CoordinationError("Choose a reusable public form.");
  const db = env.GOOGLE_SESSIONS;
  const form = await db
    .prepare(
      "SELECT active FROM streamlion_public_forms_v1 WHERE id=? AND connection_id=?",
    )
    .bind(body.formId, connection.id)
    .first();
  if (!form) throw embedUnavailable();
  if (!body.enabled) {
    await db
      .prepare("DELETE FROM streamlion_intake_embeds_v1 WHERE form_id=?")
      .bind(body.formId)
      .run();
    return { embed: null };
  }
  if (!form.active)
    throw new CoordinationError(
      "Make your public form available before enabling its embed.",
      409,
    );
  const origins = JSON.stringify(normalizeOrigins(body.origins));
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO streamlion_intake_embeds_v1(id,form_id,f3d_account_id,f3d_business_id,origins)
     SELECT ?,f.id,p.f3d_account_id,json_extract(p.snapshot,'$.businessProfile.id'),?
     FROM streamlion_public_forms_v1 f
     JOIN streamlion_coordination_connections_v1 c ON c.id=f.connection_id
     JOIN streamlion_f3d_profile_v1 p ON p.mode=c.mode AND p.google_subject=c.google_subject
     WHERE f.id=? AND c.id=? AND f.active=1 AND c.revoked=0 AND c.expires_at>?
       AND json_extract(p.snapshot,'$.businessProfile.id') IS NOT NULL
       AND p.verified_at BETWEEN ? AND ?
     ON CONFLICT(form_id) DO UPDATE SET
       id=CASE WHEN origins=excluded.origins AND f3d_account_id=excluded.f3d_account_id
         AND f3d_business_id=excluded.f3d_business_id THEN id ELSE excluded.id END,
       f3d_account_id=excluded.f3d_account_id,f3d_business_id=excluded.f3d_business_id,
       origins=excluded.origins
     RETURNING id,origins`,
    )
    .bind(
      randomProspectToken(),
      origins,
      body.formId,
      connection.id,
      now,
      now - 15 * 60000,
      now,
    )
    .first();
  if (!row)
    throw new CoordinationError(
      "Refresh your Frontiers|3D business profile connection in Account, then try again.",
      409,
    );
  return { embed: configuration(row) };
}

export async function readIntakeEmbed(env, id) {
  if (
    env.ENABLE_INTAKE_EMBEDS !== "true" ||
    typeof id !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(id) ||
    !(await embedSchema(env))
  )
    throw embedUnavailable();
  const row = await env.GOOGLE_SESSIONS.prepare(
    `SELECT e.id,e.origins,c.google_subject,f.id AS form_id,f.token_hash FROM streamlion_intake_embeds_v1 e
     JOIN streamlion_public_forms_v1 f ON f.id=e.form_id
     JOIN streamlion_coordination_connections_v1 c ON c.id=f.connection_id
     ${embedProfileJoin}
     WHERE e.id=? AND f.active=1 AND c.mode=? AND c.revoked=0 AND c.expires_at>?`,
  )
    .bind(id, paymentMode(env), Date.now())
    .first();
  if (!row || !pilotEnabled(env, row.google_subject)) throw embedUnavailable();
  return {
    ...configuration(row),
    formId: row.form_id,
    tokenHash: row.token_hash,
  };
}
