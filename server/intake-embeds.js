import { CoordinationError } from "../src/client-workflow.js";
import { paymentMode } from "./purchase-access.js";
import { PROFILE_ISSUER } from "../src/f3d-profile.js";
import { randomProspectToken } from "./prospect-intake.js";

export const embedUnavailable = () =>
  new CoordinationError(
    "This website form is unavailable. Contact the provider.",
    404,
  );

const embedsEnabled = (env) => env.ENABLE_INTAKE_EMBEDS === "true";
const slugPattern = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

async function requirePublishedProfile({ profileId, slug, tokenHash }) {
  if (typeof slug !== "string" || !slugPattern.test(slug) || !tokenPattern.test(tokenHash)) throw embedUnavailable();
  try {
    const response = await fetch(PROFILE_ISSUER + "/api/public/intake-embed-publication", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, slug, tokenHash }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(1800),
    });
    if (response.status === 204) return;
  } catch {
    // Fail closed when the publication state cannot be verified.
  }
  throw embedUnavailable();
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

export async function approvedProfileEmbedId(env, formId, origin) {
  if (!embedsEnabled(env))
    return null;
  try {
    const row = await env.GOOGLE_SESSIONS.prepare(
      "SELECT id FROM streamlion_intake_embeds_v1 WHERE form_id=?",
    ).bind(formId).first();
    if (!row) return null;
    const embed = await readIntakeEmbed(env, row.id);
    return embed.formId === formId && embed.origins.includes(origin) ? embed.id : null;
  } catch {
    return null;
  }
}

export async function manageIntakeEmbed(env, { row: form, connection }, input, authorization) {
  if (!embedsEnabled(env)) throw embedUnavailable();
  const { accountId, profileId, slug, action, origins } = input;
  const db = env.GOOGLE_SESSIONS;
  const binding = await db.prepare(
    `SELECT 1 AS linked FROM streamlion_f3d_profile_v1
     WHERE mode=? AND google_subject=? AND f3d_account_id=?
       AND json_extract(snapshot,'$.businessProfile.id')=? AND verified_at IS NOT NULL`,
  ).bind(connection.mode, connection.google_subject, accountId, profileId).first();
  if (!binding) throw embedUnavailable();
  await requirePublishedProfile({ profileId, slug, tokenHash: form.token_hash });

  const values = [form.id, accountId, profileId];
  if (action === "read") {
    const row = await db.prepare(
      `SELECT id,origins FROM streamlion_intake_embeds_v1
       WHERE form_id=? AND f3d_account_id=? AND f3d_business_id=? AND f3d_profile_slug=?`,
    ).bind(...values, slug).first();
    return { embed: row ? configuration(row) : null };
  }
  const now = Date.now();
  if (authorization.expiresAt <= now) throw embedUnavailable();
  const consume = [
    db.prepare("DELETE FROM streamlion_f3d_embed_commands_v1 WHERE expires_at<=?").bind(now),
    db.prepare("INSERT INTO streamlion_f3d_embed_commands_v1(id,expires_at) VALUES(?,?)")
      .bind(input.commandId, authorization.expiresAt),
  ];
  if (action === "disable") {
    await db.batch([...consume, db.prepare(
      "DELETE FROM streamlion_intake_embeds_v1 WHERE form_id=? AND f3d_account_id=? AND f3d_business_id=?",
    ).bind(...values)]);
    return { embed: null };
  }

  const save = db.prepare(
    `INSERT INTO streamlion_intake_embeds_v1(id,form_id,f3d_account_id,f3d_business_id,origins,f3d_profile_slug)
     SELECT ?,f.id,p.f3d_account_id,?, ?, ?
     FROM streamlion_public_forms_v1 f
     JOIN streamlion_coordination_connections_v1 c ON c.id=f.connection_id
     JOIN streamlion_f3d_profile_v1 p ON p.mode=c.mode AND p.google_subject=c.google_subject
     WHERE f.id=? AND f.token_hash=? AND c.id=? AND f.active=1 AND c.revoked=0 AND c.expires_at>?
       AND p.f3d_account_id=? AND json_extract(p.snapshot,'$.businessProfile.id')=?
       AND p.verified_at IS NOT NULL
     ON CONFLICT(form_id) DO UPDATE SET
       id=CASE WHEN origins=excluded.origins AND f3d_account_id=excluded.f3d_account_id
         AND f3d_business_id=excluded.f3d_business_id AND f3d_profile_slug=excluded.f3d_profile_slug
         THEN id ELSE excluded.id END,
       f3d_account_id=excluded.f3d_account_id, f3d_business_id=excluded.f3d_business_id,
       origins=excluded.origins, f3d_profile_slug=excluded.f3d_profile_slug
     RETURNING id,origins`,
  ).bind(
    randomProspectToken(), profileId, JSON.stringify(normalizeOrigins(origins)), slug,
    form.id, form.token_hash, connection.id, now, accountId, profileId,
  );
  const [, , result] = await db.batch([...consume, save]);
  const row = result.results?.[0];
  if (!row) throw embedUnavailable();
  return { embed: configuration(row) };
}

export async function readIntakeEmbed(env, id) {
  if (!embedsEnabled(env) || typeof id !== "string" || !tokenPattern.test(id))
    throw embedUnavailable();
  let row;
  try {
    row = await env.GOOGLE_SESSIONS.prepare(
      `SELECT e.id,e.origins,e.f3d_business_id AS profileId,e.f3d_profile_slug AS slug,
              f.id AS form_id,f.token_hash AS tokenHash
       FROM streamlion_intake_embeds_v1 e
       JOIN streamlion_public_forms_v1 f ON f.id=e.form_id
       JOIN streamlion_coordination_connections_v1 c ON c.id=f.connection_id
       ${embedProfileJoin}
       WHERE e.id=? AND f.active=1 AND c.mode=? AND c.revoked=0 AND c.expires_at>?`,
    ).bind(id, paymentMode(env), Date.now()).first();
  } catch {
    throw embedUnavailable();
  }
  if (!row) throw embedUnavailable();
  await requirePublishedProfile(row);
  return { ...configuration(row), formId: row.form_id, tokenHash: row.tokenHash };
}
