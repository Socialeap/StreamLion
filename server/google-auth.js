const SESSION = "__Host-streamlion-session";
const FLOW = "__Host-streamlion-oauth";
const SCOPE = "openid email https://www.googleapis.com/auth/drive.file";
const MAX_AGE = 90 * 86400;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const unb64 = (text) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export async function hash(value) {
  return b64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}
function origin(env) {
  const url = new URL(env.GOOGLE_AUTH_ORIGIN || "");
  if (url.protocol !== "https:" || url.origin !== env.GOOGLE_AUTH_ORIGIN)
    throw new Error("configuration");
  return url.origin;
}
function configured(env) {
  return (
    env.ENABLE_PERSISTENT_GOOGLE === "true" &&
    env.GOOGLE_SESSIONS &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_TOKEN_ENCRYPTION_KEY &&
    env.VITE_GOOGLE_CLIENT_ID &&
    env.GOOGLE_AUTH_ORIGIN
  );
}
async function key(env) {
  const bytes = unb64(env.GOOGLE_TOKEN_ENCRYPTION_KEY);
  if (bytes.length !== 32) throw new Error("configuration");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(env, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await key(env),
    encoder.encode(JSON.stringify(value)),
  );
  return b64(iv) + "." + b64(new Uint8Array(encrypted));
}
export async function unseal(env, value, context) {
  const [iv, cipher] = value.split(".");
  return JSON.parse(
    decoder.decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: unb64(iv),
          additionalData: encoder.encode(context),
        },
        await key(env),
        unb64(cipher),
      ),
    ),
  );
}
function cookie(request, name) {
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
function setCookie(name, value, age) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Content-Disposition": "attachment",
};
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers });
}
function redirect(url, cookies = []) {
  const h = new Headers({ ...headers, Location: url });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers: h });
}
function sameOrigin(request, env) {
  return request.headers.get("Origin") === origin(env);
}
async function getSession(request, env) {
  const id = cookie(request, SESSION);
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const row = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_google_sessions_v1 WHERE session_hash = ? AND expires_at > ?",
  )
    .bind(await hash(id), Date.now())
    .first();
  return row;
}
function googleFetch(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
}
async function tokenExchange(env, params) {
  return googleFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.VITE_GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
    redirect: "error",
  });
}
const refreshing = new Map();
async function accessToken(env, row) {
  const credentials = await unseal(env, row.credentials, row.session_hash);
  if (credentials.expiresAt > Date.now() + 60000)
    return credentials.accessToken;
  if (refreshing.has(row.session_hash)) return refreshing.get(row.session_hash);
  const pending = (async () => {
    const response = await tokenExchange(env, {
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.error === "invalid_grant") {
        await env.GOOGLE_SESSIONS.prepare(
          "DELETE FROM streamlion_google_sessions_v1 WHERE session_hash = ? AND credentials = ?",
        )
          .bind(row.session_hash, row.credentials)
          .run();
        throw new Error("reconnect");
      }
      throw new Error("temporary");
    }
    if (!data.access_token || !Number.isFinite(Number(data.expires_in)))
      throw new Error("temporary");
    const next = await seal(
      env,
      {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || credentials.refreshToken,
        expiresAt: Date.now() + Number(data.expires_in) * 1000,
      },
      row.session_hash,
    );
    const update = await env.GOOGLE_SESSIONS.prepare(
      "UPDATE streamlion_google_sessions_v1 SET credentials = ? WHERE session_hash = ? AND credentials = ? AND expires_at > ?",
    )
      .bind(next, row.session_hash, row.credentials, Date.now())
      .run();
    // A disconnect or replacement while refreshing must not resurrect a session.
    if (!update.meta.changes) {
      const latest = await env.GOOGLE_SESSIONS.prepare(
        "SELECT * FROM streamlion_google_sessions_v1 WHERE session_hash = ? AND expires_at > ?",
      )
        .bind(row.session_hash, Date.now())
        .first();
      if (!latest) throw new Error("reconnect");
      return (await unseal(env, latest.credentials, latest.session_hash))
        .accessToken;
    }
    return data.access_token;
  })();
  refreshing.set(row.session_hash, pending);
  try {
    return await pending;
  } finally {
    refreshing.delete(row.session_hash);
  }
}
export function upstreamURL(service, path, method) {
  // Fixed Google hosts, narrow operations, no caller-controlled URL/redirect.
  if (typeof path !== "string" || path.length > 12000 || /[\\#\r\n]/.test(path))
    throw new Error("bad_request");
  const root =
    service === "sheets"
      ? "https://sheets.googleapis.com/v4/spreadsheets"
      : service === "drive"
        ? "https://www.googleapis.com/"
        : "";
  if (!root) throw new Error("bad_request");
  const clean = path.split("?")[0];
  const sheets =
    (method === "GET" && /^\/[\w-]+(?:\/values:batchGet)?$/.test(clean)) ||
    (method === "POST" &&
      (clean === "" ||
        /^\/[\w-]+\/values\/[A-Za-z0-9!%:_-]+:append$/.test(clean)));
  const drive =
    (method === "GET" &&
      /^drive\/v3\/files\/(?:generateIds|[\w-]+)$/.test(clean)) ||
    (method === "POST" && clean === "upload/drive/v3/files");
  if (!(service === "sheets" ? sheets : drive)) throw new Error("bad_request");
  const url = new URL(root + path);
  if (url.origin !== new URL(root).origin) throw new Error("bad_request");
  return url;
}
async function limitedBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 6 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
export async function handleGoogle({ request, env, params }) {
  const route = (params.path || []).join("/");
  const url = new URL(request.url);
  if (env.ENABLE_PERSISTENT_GOOGLE !== "true")
    return route === "session"
      ? json({ enabled: false, connected: false })
      : json({ error: "Persistent connection is not enabled." }, 503);
  if (!configured(env))
    return json({ error: "Google connection setup is incomplete." }, 503);
  try {
    if (url.origin !== origin(env))
      return json(
        { error: "Use the StreamLion production address to connect Google." },
        403,
      );
    if (request.method !== "GET" && !sameOrigin(request, env))
      return json({ error: "Request origin rejected." }, 403);
    if (route === "start" && request.method === "GET") {
      const stamp = await env.GOOGLE_SESSIONS.prepare(
        "SELECT version FROM streamlion_auth_schema_v1 WHERE version = 1",
      ).first();
      if (!stamp) throw new Error("configuration");
      if (request.headers.get("Sec-Fetch-Site") === "cross-site")
        return json({ error: "Open StreamLion to connect." }, 403);
      const verifier = random(),
        state = random();
      const flow = await seal(
        env,
        { verifier, state, expiresAt: Date.now() + 600000 },
        "oauth-flow",
      );
      const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      target.search = new URLSearchParams({
        client_id: env.VITE_GOOGLE_CLIENT_ID,
        redirect_uri: origin(env) + "/api/google/callback",
        response_type: "code",
        scope: SCOPE,
        access_type: "offline",
        prompt: "consent select_account",
        state,
        code_challenge: await hash(verifier),
        code_challenge_method: "S256",
      }).toString();
      return redirect(target.toString(), [setCookie(FLOW, flow, 600)]);
    }
    if (route === "callback" && request.method === "GET") {
      let flow;
      try {
        flow = await unseal(env, cookie(request, FLOW), "oauth-flow");
      } catch {
        return json(
          { error: "Sign-in expired. Return to StreamLion and try again." },
          400,
        );
      }
      if (
        flow.expiresAt < Date.now() ||
        flow.state !== url.searchParams.get("state")
      )
        return json({ error: "Sign-in could not be verified." }, 400);
      const clearFlow = setCookie(FLOW, "", 0);
      if (url.searchParams.has("error"))
        return redirect(origin(env) + "/?google=cancelled", [clearFlow]);
      const response = await tokenExchange(env, {
        grant_type: "authorization_code",
        code: url.searchParams.get("code") || "",
        code_verifier: flow.verifier,
        redirect_uri: origin(env) + "/api/google/callback",
      });
      const tokens = await response.json();
      if (
        !response.ok ||
        !tokens.access_token ||
        !tokens.refresh_token ||
        !Number.isFinite(Number(tokens.expires_in)) ||
        Number(tokens.expires_in) <= 0 ||
        !tokens.scope
          ?.split(" ")
          .includes("https://www.googleapis.com/auth/drive.file")
      )
        return redirect(origin(env) + "/?google=failed", [clearFlow]);
      const identityResponse = await googleFetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
          redirect: "error",
        },
      );
      const identity = await identityResponse.json();
      if (
        !identityResponse.ok ||
        !identity.sub ||
        !identity.email ||
        !identity.email_verified
      )
        return redirect(origin(env) + "/?google=failed", [clearFlow]);
      const previous = await getSession(request, env);
      const id = random(),
        sessionHash = await hash(id);
      const encrypted = await seal(
        env,
        {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + Number(tokens.expires_in) * 1000,
        },
        sessionHash,
      );
      const workbook =
        previous?.google_subject === identity.sub ? previous.workbook_id : "";
      const statements = [
        env.GOOGLE_SESSIONS.prepare(
          "INSERT INTO streamlion_google_sessions_v1 (session_hash, google_subject, email, credentials, workbook_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          sessionHash,
          identity.sub,
          identity.email,
          encrypted,
          workbook,
          Date.now() + MAX_AGE * 1000,
        ),
        env.GOOGLE_SESSIONS.prepare(
          "DELETE FROM streamlion_google_sessions_v1 WHERE expires_at <= ?",
        ).bind(Date.now()),
      ];
      if (previous)
        statements.push(
          env.GOOGLE_SESSIONS.prepare(
            "DELETE FROM streamlion_google_sessions_v1 WHERE session_hash = ?",
          ).bind(previous.session_hash),
        );
      await env.GOOGLE_SESSIONS.batch(statements);
      return redirect(origin(env) + "/?google=connected", [
        clearFlow,
        setCookie(SESSION, id, MAX_AGE),
      ]);
    }
    const row = await getSession(request, env);
    if (route === "session" && request.method === "GET") {
      if (!row) return json({ enabled: true, connected: false });
      await accessToken(env, row);
      return json({
        enabled: true,
        connected: true,
        account: row.email,
        subject: row.google_subject,
        bookId: row.workbook_id,
      });
    }
    if (!row) return json({ error: "Reconnect Google to continue." }, 401);
    if (request.headers.get("X-StreamLion-Account") !== row.google_subject)
      return json(
        {
          error: "Google account changed. Reopen StreamLion before continuing.",
        },
        401,
      );
    if (route === "disconnect" && request.method === "POST") {
      await env.GOOGLE_SESSIONS.prepare(
        "DELETE FROM streamlion_google_sessions_v1 WHERE session_hash = ?",
      )
        .bind(row.session_hash)
        .run();
      const response = json({ connected: false });
      response.headers.set("Set-Cookie", setCookie(SESSION, "", 0));
      return response;
    }
    if (route === "workbook" && request.method === "POST") {
      const { bookId } = await request.json();
      if (!/^[\w-]+$/.test(bookId || ""))
        return json({ error: "Invalid workbook." }, 400);
      const check = await googleFetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=spreadsheetId`,
        {
          headers: { Authorization: `Bearer ${await accessToken(env, row)}` },
          redirect: "error",
        },
      );
      if (!check.ok)
        return json(
          { error: "Workbook access could not be verified." },
          check.status === 403 || check.status === 404 ? 403 : 503,
        );
      const saved = await env.GOOGLE_SESSIONS.prepare(
        "UPDATE streamlion_google_sessions_v1 SET workbook_id = ? WHERE session_hash = ? AND expires_at > ?",
      )
        .bind(bookId, row.session_hash, Date.now())
        .run();
      if (!saved.meta.changes) return json({ error: "Reconnect Google." }, 401);
      return json({ bookId });
    }
    if (route === "picker-token" && request.method === "POST")
      return json({ accessToken: await accessToken(env, row) });
    if (
      (route === "sheets" || route === "drive") &&
      ["GET", "POST"].includes(request.method)
    ) {
      const target = upstreamURL(
        route,
        url.searchParams.get("path"),
        request.method,
      );
      if (Number(request.headers.get("Content-Length")) > 6 * 1024 * 1024)
        return json({ error: "File too large." }, 413);
      const body =
        request.method === "POST" ? await limitedBody(request) : undefined;
      if (body?.byteLength > 6 * 1024 * 1024)
        return json({ error: "File too large." }, 413);
      const response = await googleFetch(target, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${await accessToken(env, row)}`,
          "Content-Type":
            request.headers.get("Content-Type") || "application/json",
        },
        body,
        redirect: "error",
      });
      // Never replay a mutation automatically after an uncertain upstream outcome.
      return new Response(response.body, {
        status: response.status,
        headers: {
          ...headers,
          "Content-Type":
            response.headers.get("Content-Type") || "application/octet-stream",
        },
      });
    }
    return json({ error: "Unknown Google operation." }, 404);
  } catch (e) {
    const status =
      e.message === "reconnect"
        ? 401
        : e.message === "bad_request"
          ? 400
          : e.message === "too_large"
            ? 413
            : 503;
    return json(
      {
        error:
          status === 401
            ? "Reconnect Google to continue."
            : status === 400
              ? "Invalid Google request."
              : "Google is temporarily unavailable. Your connection and drafts are preserved. Retry shortly.",
      },
      status,
    );
  }
}
