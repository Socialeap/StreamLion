import { getSession } from "./google-auth.js";
import { paymentMode } from "./purchase-access.js";
import { boundedText } from "./request-body.js";
import { validatePricing } from "../src/provider-pricing.js";
import { CoordinationError } from "../src/coordination-contract.js";
const table = "streamlion_provider_pricing_v1";
const validID = (id) => typeof id === "string" && /^[\w-]{1,80}$/.test(id);
export async function pricingProfiles(env, subject, mode) {
  try {
    const rows = await env.GOOGLE_SESSIONS.prepare(
      `SELECT id,name,config,version FROM ${table} WHERE mode=? AND google_subject=? ORDER BY id='default' DESC,name`,
    )
      .bind(mode, subject)
      .all();
    return {
      available: true,
      profiles: rows.results.map((row) => ({
        ...row,
        config: JSON.parse(row.config),
      })),
    };
  } catch (error) {
    if (/no such table.*streamlion_provider_pricing_v1/i.test(error.message))
      return { available: false, profiles: [] };
    throw error;
  }
}
export async function pricingForConnection(env, connection, id = "default") {
  if (!validID(id))
    throw new CoordinationError("Choose a valid pricing profile.");
  const { profiles } = await pricingProfiles(
      env,
      connection.google_subject,
      connection.mode,
    ),
    row = profiles.find((p) => p.id === id);
  if (!row) {
    if (id === "default") return null;
    throw new CoordinationError(
      "This service’s pricing profile is unavailable. Choose another profile before sharing.",
      503,
    );
  }
  return {
    profileId: row.id,
    name: row.name,
    version: row.version,
    key: row.id + ":" + row.version,
    config: row.config,
  };
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
export async function handleProviderPricing({ request, env }) {
  try {
    if (!["GET", "POST"].includes(request.method))
      return reply({ error: "Method not allowed." }, 405);
    if (
      new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
      (request.method === "POST" &&
        request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
    )
      return reply({ error: "Use your StreamLion Account page." }, 403);
    const session = await getSession(request, env);
    if (!session)
      return reply({ error: "Sign in to Google to manage pricing." }, 401);
    const mode = paymentMode(env);
    if (!["test", "live"].includes(mode))
      return reply({ error: "Pricing is unavailable." }, 503);
    const list = await pricingProfiles(env, session.google_subject, mode);
    if (request.method === "GET")
      return reply({
        subject: session.google_subject,
        account: session.email,
        ...list,
      });
    if (request.headers.get("X-StreamLion-Account") !== session.google_subject)
      return reply(
        { error: "Your Google account changed. Reopen Account before saving." },
        403,
      );
    if (!list.available)
      return reply(
        {
          error:
            "Pricing setup awaits its database migration. Existing requests are kept.",
        },
        503,
      );
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply({ error: "Use JSON." }, 415);
    let body, config;
    try {
      body = JSON.parse(await boundedText(request, 20000));
      config = validatePricing(body.config);
    } catch (error) {
      return reply({ error: error.message }, 400);
    }
    if (
      !validID(body.id) ||
      !Number.isSafeInteger(body.version) ||
      body.version < 0 ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 80 ||
      /[\x00-\x1f\x7f]/.test(body.name)
    )
      return reply(
        { error: "Enter a profile name and valid saved version." },
        400,
      );
    const statement =
      body.version === 0
        ? env.GOOGLE_SESSIONS.prepare(
            `INSERT INTO ${table}(mode,google_subject,id,name,config,version,updated_at) SELECT ?,?,?,?,?,1,? WHERE (SELECT COUNT(*) FROM ${table} WHERE mode=? AND google_subject=?)<10 ON CONFLICT(mode,google_subject,id) DO NOTHING`,
          ).bind(
            mode,
            session.google_subject,
            body.id,
            body.name.trim(),
            JSON.stringify(config),
            Date.now(),
            mode,
            session.google_subject,
          )
        : env.GOOGLE_SESSIONS.prepare(
            `UPDATE ${table} SET name=?,config=?,version=version+1,updated_at=? WHERE mode=? AND google_subject=? AND id=? AND version=?`,
          ).bind(
            body.name.trim(),
            JSON.stringify(config),
            Date.now(),
            mode,
            session.google_subject,
            body.id,
            body.version,
          );
    const result = await statement.run();
    if (result.meta.changes !== 1)
      return reply(
        {
          error:
            "Pricing changed in another tab, or the 10-profile limit was reached. Reopen Account and review before saving.",
        },
        409,
      );
    return reply({
      subject: session.google_subject,
      account: session.email,
      ...(await pricingProfiles(env, session.google_subject, mode)),
    });
  } catch {
    return reply(
      {
        error:
          "Could not load or save pricing. Existing settings and requests are kept.",
      },
      503,
    );
  }
}
