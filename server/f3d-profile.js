import { getSession, hash } from "./google-auth.js";
import { paymentMode } from "./purchase-access.js";
import { boundedText } from "./request-body.js";
import {
  PROFILE_AUDIENCE,
  PROFILE_ISSUER,
  verifyProfileAssertion,
} from "../src/f3d-profile.js";
const table = "streamlion_f3d_profile_v1";
const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const b64 = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k));
function configured(env) {
  try {
    const key = JSON.parse(env.F3D_PROVIDER_PROFILE_PUBLIC_JWK);
    return (
      env.ENABLE_F3D_PROFILE_BRIDGE === "true" &&
      env.GOOGLE_AUTH_ORIGIN === PROFILE_AUDIENCE &&
      key.kty === "OKP" &&
      key.crv === "Ed25519" &&
      /^[A-Za-z0-9_-]{43}$/.test(key.x) &&
      !Object.hasOwn(key, "d")
    );
  } catch {
    return false;
  }
}
export async function handleF3DProfile({ request, env }) {
  try {
    if (!["GET", "POST"].includes(request.method))
      return reply({ error: "Method not allowed." }, 405);
    if (
      new URL(request.url).origin !== env.GOOGLE_AUTH_ORIGIN ||
      (request.method === "POST" &&
        request.headers.get("Origin") !== env.GOOGLE_AUTH_ORIGIN)
    )
      return reply(
        { error: "Use StreamLion Account to connect your profile." },
        403,
      );
    const session = await getSession(request, env);
    if (!session)
      return reply(
        { error: "Sign in to Google before connecting your F|3D profile." },
        401,
      );
    const mode = paymentMode(env),
      subject = session.google_subject;
    if (!["test", "live"].includes(mode))
      return reply({ error: "Profile connection is unavailable." }, 503);
    let row,
      available = configured(env);
    try {
      row = await env.GOOGLE_SESSIONS.prepare(
        `SELECT * FROM ${table} WHERE mode=? AND google_subject=?`,
      )
        .bind(mode, subject)
        .first();
    } catch (e) {
      if (/no such table.*streamlion_f3d_profile_v1/i.test(e.message))
        available = false;
      else throw e;
    }
    const result = () => ({
      subject,
      account: session.email,
      available,
      connected: available && !!row?.snapshot,
      snapshot: available && row?.snapshot ? JSON.parse(row.snapshot) : null,
      verifiedAt: available ? row?.verified_at || null : null,
    });
    if (request.method === "GET") return reply(result());
    if (request.headers.get("X-StreamLion-Account") !== subject)
      return reply(
        { error: "Your account changed. Reopen setup before connecting." },
        403,
      );
    if (!available)
      return reply(
        {
          error:
            "F|3D profile connection is not enabled yet. Your existing setup is unchanged.",
        },
        503,
      );
    if (!request.headers.get("Content-Type")?.startsWith("application/json"))
      return reply({ error: "Use JSON." }, 415);
    let body;
    try {
      body = JSON.parse(await boundedText(request, 18000));
    } catch (e) {
      return reply(
        { error: "Invalid profile connection request." },
        e.status === 413 ? 413 : 400,
      );
    }
    if (exact(body, ["action"]) && body.action === "start") {
      const nonce = b64(crypto.getRandomValues(new Uint8Array(32)));
      await env.GOOGLE_SESSIONS.prepare(
        `INSERT INTO ${table}(mode,google_subject,pending_nonce_hash,pending_session_hash,pending_expires_at) VALUES(?,?,?,?,?) ON CONFLICT(mode,google_subject) DO UPDATE SET pending_nonce_hash=excluded.pending_nonce_hash,pending_session_hash=excluded.pending_session_hash,pending_expires_at=excluded.pending_expires_at`,
      )
        .bind(
          mode,
          subject,
          await hash(nonce),
          session.session_hash,
          Date.now() + 600000,
        )
        .run();
      return reply({
        nonce,
        connectUrl: PROFILE_ISSUER + "/dashboard/profile?connect=streamlion",
      });
    }
    if (exact(body, ["action"]) && body.action === "unlink") {
      await env.GOOGLE_SESSIONS.prepare(
        `DELETE FROM ${table} WHERE mode=? AND google_subject=?`,
      )
        .bind(mode, subject)
        .run();
      row = null;
      return reply(result());
    }
    if (
      !exact(body, ["action", "nonce", "assertion"]) ||
      body.action !== "complete" ||
      typeof body.nonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.nonce)
    )
      return reply({ error: "Invalid profile connection request." }, 400);
    if (
      !row?.pending_nonce_hash ||
      row.pending_nonce_hash !== (await hash(body.nonce)) ||
      row.pending_session_hash !== session.session_hash ||
      row.pending_expires_at <= Date.now()
    )
      return reply(
        {
          error:
            "This connection expired or belongs to another session. Start again.",
        },
        409,
      );
    let snapshot;
    try {
      snapshot = await verifyProfileAssertion(
        body.assertion,
        body.nonce,
        env.GOOGLE_AUTH_ORIGIN,
        JSON.parse(env.F3D_PROVIDER_PROFILE_PUBLIC_JWK),
      );
    } catch {
      return reply(
        {
          error:
            "The F|3D profile could not be verified. Start the connection again.",
        },
        400,
      );
    }
    const now = Date.now();
    const updated = await env.GOOGLE_SESSIONS.prepare(
      `UPDATE ${table} SET snapshot=?,f3d_account_id=?,verified_at=?,pending_nonce_hash=NULL,pending_session_hash=NULL,pending_expires_at=NULL WHERE mode=? AND google_subject=? AND pending_nonce_hash=? AND pending_session_hash=? AND pending_expires_at>? AND (f3d_account_id IS NULL OR f3d_account_id=?)`,
    )
      .bind(
        JSON.stringify(snapshot),
        snapshot.accountId,
        now,
        mode,
        subject,
        await hash(body.nonce),
        session.session_hash,
        now,
        snapshot.accountId,
      )
      .run();
    if (updated.meta.changes !== 1)
      return reply(
        {
          error:
            "This connection was used or a different F|3D account is already linked. Unlink before changing accounts.",
        },
        409,
      );
    row = { snapshot: JSON.stringify(snapshot), verified_at: now };
    return reply(result());
  } catch {
    return reply(
      {
        error:
          "Could not reach your profile connection. Your existing setup is unchanged.",
      },
      503,
    );
  }
}
