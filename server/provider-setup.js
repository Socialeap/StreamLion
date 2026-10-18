import { getSession } from "./google-auth.js";
import { paymentMode } from "./purchase-access.js";
import { boundedText } from "./request-body.js";
import { parseSetup } from "../src/setup-assistant.js";
const table = "streamlion_provider_setup_v1";
const missing = (error) =>
  /no such table.*streamlion_provider_setup_v1/i.test(
    String(error?.message || error),
  );
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
// The setup assistant's answers for the signed-in Google account. The newest
// saved state wins, so an older device cannot overwrite newer answers.
export async function handleProviderSetup({ request, env }) {
  try {
    if (!["GET", "POST"].includes(request.method))
      return reply({ error: "Method not allowed." }, 405);
    if (
      new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
      (request.method === "POST" &&
        request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
    )
      return reply({ error: "Use StreamLion to save your setup." }, 403);
    const session = await getSession(request, env);
    if (!session)
      return reply({ error: "Sign in to Google to keep your setup." }, 401);
    const mode = paymentMode(env);
    if (!["test", "live"].includes(mode))
      return reply({ error: "Saved setup is unavailable." }, 503);
    const subject = session.google_subject;
    let row;
    try {
      row = await env.GOOGLE_SESSIONS.prepare(
        `SELECT state,updated_at FROM ${table} WHERE mode=? AND google_subject=?`,
      )
        .bind(mode, subject)
        .first();
    } catch (error) {
      // Until the migration is applied, setup stays on each device.
      if (missing(error))
        return reply({ subject, account: session.email, available: false });
      throw error;
    }
    if (request.method === "GET")
      return reply({
        subject,
        account: session.email,
        available: true,
        state: row ? JSON.parse(row.state) : null,
      });
    if (request.headers.get("X-StreamLion-Account") !== subject)
      return reply(
        { error: "Your Google account changed. Reopen setup before saving." },
        403,
      );
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply({ error: "Use JSON." }, 415);
    let state;
    try {
      state = parseSetup(
        JSON.stringify(JSON.parse(await boundedText(request, 260000)).state),
      );
    } catch {
      state = null;
    }
    const text = state && JSON.stringify(state);
    const updated = Date.parse(state?.updatedAt);
    if (!state || text.length > 250000 || !Number.isFinite(updated))
      return reply({ error: "These setup answers could not be saved." }, 400);
    // Keep whichever copy was changed most recently.
    await env.GOOGLE_SESSIONS.prepare(
      `INSERT INTO ${table}(mode,google_subject,state,updated_at) VALUES(?,?,?,?) ON CONFLICT(mode,google_subject) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at WHERE excluded.updated_at>=${table}.updated_at`,
    )
      .bind(mode, subject, text, updated)
      .run();
    const saved = await env.GOOGLE_SESSIONS.prepare(
      `SELECT state FROM ${table} WHERE mode=? AND google_subject=?`,
    )
      .bind(mode, subject)
      .first();
    return reply({
      subject,
      account: session.email,
      available: true,
      state: JSON.parse(saved.state),
    });
  } catch {
    return reply(
      {
        error:
          "Could not reach your saved setup. Your answers stay on this device; try again.",
      },
      503,
    );
  }
}
