import { getSession } from "./google-auth.js";
import { paymentMode } from "./purchase-access.js";
import { boundedText } from "./request-body.js";
import { emptyBranding, validateBranding } from "../src/provider-branding.js";
const table = "streamlion_provider_branding_v1";
const missing = (error) =>
  /no such table.*streamlion_provider_branding_v1/i.test(
    String(error?.message || error),
  );
async function profileRow(env, subject, mode) {
  try {
    return {
      available: true,
      row: await env.GOOGLE_SESSIONS.prepare(
        `SELECT profile,version FROM ${table} WHERE mode=? AND google_subject=?`,
      )
        .bind(mode, subject)
        .first(),
    };
  } catch (error) {
    // Rolling deployments retain legacy form branding until the migration is applied.
    if (missing(error)) return { available: false, row: null };
    throw error;
  }
}
export async function brandingForConnection(
  env,
  connection,
  fallback = connection?.client_brand || "",
) {
  const { row } = await profileRow(
    env,
    connection.google_subject,
    connection.mode,
  );
  return row ? JSON.parse(row.profile) : { ...emptyBranding(), name: fallback };
}
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function handleProviderBranding({ request, env }) {
  try {
    if (!["GET", "POST"].includes(request.method))
      return reply({ error: "Method not allowed." }, 405);
    if (
      new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
      (request.method === "POST" &&
        request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
    )
      return reply({ error: "Use your StreamLion account page." }, 403);
    const session = await getSession(request, env);
    if (!session)
      return reply(
        { error: "Sign in to Google to manage your business branding." },
        401,
      );
    const mode = paymentMode(env);
    if (!["test", "live"].includes(mode))
      return reply({ error: "Business branding is unavailable." }, 503);
    const subject = session.google_subject;
    const { available, row } = await profileRow(env, subject, mode);
    if (request.method === "GET") {
      let legacy;
      if (!row) {
        try {
          legacy = await env.GOOGLE_SESSIONS.prepare(
            "SELECT client_brand FROM streamlion_coordination_connections_v1 WHERE google_subject=? AND mode=? AND workbook_id=?",
          )
            .bind(subject, mode, session.workbook_id || "")
            .first();
        } catch (error) {
          if (!/no such table/i.test(error.message)) throw error;
        }
      }
      return reply({
        subject,
        account: session.email,
        available,
        version: row?.version || 0,
        branding: row
          ? JSON.parse(row.profile)
          : { ...emptyBranding(), name: legacy?.client_brand || "" },
      });
    }
    if (request.headers.get("X-StreamLion-Account") !== subject)
      return reply(
        { error: "Your Google account changed. Reopen Account before saving." },
        403,
      );
    if (!available)
      return reply(
        {
          error:
            "Business branding awaits its database migration. Your existing forms are kept.",
        },
        503,
      );
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply({ error: "Use JSON." }, 415);
    let body, branding;
    try {
      body = JSON.parse(await boundedText(request, 120000));
      branding = validateBranding(body.branding);
    } catch (error) {
      return reply({ error: error.message || "Invalid branding." }, 400);
    }
    if (!Number.isSafeInteger(body.version) || body.version < 0)
      return reply({ error: "Reload your saved branding before saving." }, 400);
    const statement =
      body.version === 0
        ? env.GOOGLE_SESSIONS.prepare(
            `INSERT INTO ${table}(mode,google_subject,profile,version,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(mode,google_subject) DO NOTHING`,
          ).bind(mode, subject, JSON.stringify(branding), Date.now())
        : env.GOOGLE_SESSIONS.prepare(
            `UPDATE ${table} SET profile=?,version=version+1,updated_at=? WHERE mode=? AND google_subject=? AND version=?`,
          ).bind(
            JSON.stringify(branding),
            Date.now(),
            mode,
            subject,
            body.version,
          );
    const {
      meta: { changes },
    } = await statement.run();
    if (changes !== 1)
      return reply(
        {
          error:
            "Branding changed in another tab. Reopen Account and review before saving again.",
        },
        409,
      );
    return reply({
      subject,
      account: session.email,
      available: true,
      version: body.version + 1,
      branding,
    });
  } catch {
    return reply(
      {
        error:
          "Could not load or save business branding. Your existing settings are kept. Try again.",
      },
      503,
    );
  }
}
