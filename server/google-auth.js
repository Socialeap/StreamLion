import { FOLDER_MIME } from "../src/drive-folders.js";
import { reserveGoogleRequest, reserveSignIn } from "./google-limits.js";
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
export function googleConfigurationReady(env) {
  if (!(
    env.ENABLE_PERSISTENT_GOOGLE === "true" &&
    env.GOOGLE_SESSIONS &&
    env.GOOGLE_CLIENT_SECRET &&
    env.GOOGLE_TOKEN_ENCRYPTION_KEY &&
    env.VITE_GOOGLE_CLIENT_ID &&
    env.GOOGLE_AUTH_ORIGIN
  ))
    return false;
  try {
    origin(env);
    return unb64(env.GOOGLE_TOKEN_ENCRYPTION_KEY).length === 32;
  } catch {
    return false;
  }
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
  // Navigation responses must not inherit the API download/sandbox headers.
  const h = new Headers({
    "Cache-Control": headers["Cache-Control"],
    "Referrer-Policy": headers["Referrer-Policy"],
    "X-Content-Type-Options": headers["X-Content-Type-Options"],
    Location: url,
  });
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
    "SELECT * FROM streamlion_google_sessions_v1 WHERE session_hash = ?",
  )
    .bind(await hash(id))
    .first();
  if (row && row.expires_at <= Date.now()) {
    await env.GOOGLE_SESSIONS.prepare(
      "DELETE FROM streamlion_google_sessions_v1 WHERE session_hash = ? AND expires_at <= ?",
    )
      .bind(row.session_hash, Date.now())
      .run();
    return null;
  }
  return row;
}
export async function googleFetch(url, options) {
  // Workers rejects redirect: "error". Never follow a credential-bearing
  // request to another destination: inspect and reject redirects ourselves.
  const response = await fetch(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error("google_redirect_rejected");
  return response;
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
    (method === "GET" && clean === "drive/v3/files") ||
    (method === "POST" &&
      ["upload/drive/v3/files", "drive/v3/files"].includes(clean)) ||
    (method === "PATCH" && /^drive\/v3\/files\/[\w-]+$/.test(clean));
  if (!(service === "sheets" ? sheets : drive)) throw new Error("bad_request");
  const url = new URL(root + path);
  if (url.origin !== new URL(root).origin) throw new Error("bad_request");
  return url;
}
export function validateDriveMutation(url, method, body) {
  if (method === "GET" || url.pathname === "/upload/drive/v3/files") return;
  let data;
  try {
    data = JSON.parse(decoder.decode(body));
  } catch {
    throw new Error("bad_request");
  }
  const validId = (value) =>
    typeof value === "string" && /^[\w-]{1,100}$/.test(value);
  if (method === "PATCH") {
    const allowed = ["addParents", "removeParents", "fields"];
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).length ||
      [...url.searchParams.keys()].some((key) => !allowed.includes(key)) ||
      !validId(url.searchParams.get("addParents")) ||
      (url.searchParams.has("removeParents") &&
        !url.searchParams.get("removeParents").split(",").every(validId))
    )
      throw new Error("bad_request");
    return;
  }
  if (
    method !== "POST" ||
    url.pathname !== "/drive/v3/files" ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).some(
      (key) =>
        !["id", "name", "mimeType", "parents", "appProperties"].includes(key),
    ) ||
    !validId(data.id) ||
    typeof data.name !== "string" ||
    !data.name ||
    data.name.length > 180 ||
    data.mimeType !== FOLDER_MIME ||
    (data.parents != null &&
      (!Array.isArray(data.parents) ||
        data.parents.length !== 1 ||
        !validId(data.parents[0]))) ||
    !["workspace", "project-files", "project"].includes(
      data.appProperties?.streamlionRole,
    ) ||
    Object.keys(data.appProperties).some(
      (key) =>
        !["streamlionRole", "streamlionBook", "streamlionProject"].includes(
          key,
        ),
    ) ||
    Object.values(data.appProperties).some(
      (value) => typeof value !== "string" || !/^[\w-]{1,100}$/.test(value),
    )
  )
    throw new Error("bad_request");
}
async function limitedBody(request, limit = 6 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
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
  if (!googleConfigurationReady(env))
    return json({ error: "Google connection setup is incomplete." }, 503);
  let callbackStage = "token_exchange";
  const failed = (reason, cookies = []) =>
    redirect(origin(env) + "/?google=failed&reason=" + reason, cookies);
  try {
    if (url.origin !== origin(env))
      return json(
        { error: "Use the StreamLion production address to connect Google." },
        403,
      );
    if (request.method !== "GET" && !sameOrigin(request, env))
      return json({ error: "Request origin rejected." }, 403);
    if (
      (route === "start" || route === "callback") &&
      request.method === "GET"
    ) {
      // Cloudflare supplies this header. Keep only a keyed hash, never raw IPs.
      const identity = await hash(
        `signin:${env.GOOGLE_TOKEN_ENCRYPTION_KEY}:${request.headers.get("CF-Connecting-IP") || "unknown"}`,
      );
      const capacity = await reserveSignIn(
        env.GOOGLE_SESSIONS,
        identity,
        route,
      );
      if (!capacity.allowed) {
        const limited = json(
          {
            error: "Too many sign-in attempts. Wait a minute, then try again.",
          },
          429,
        );
        limited.headers.set("Retry-After", String(capacity.retryAfter));
        return limited;
      }
    }
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
      const clearFlow = setCookie(FLOW, "", 0);
      let flow;
      try {
        flow = await unseal(env, cookie(request, FLOW), "oauth-flow");
      } catch {
        return redirect(origin(env) + "/?google=expired", [clearFlow]);
      }
      if (flow.expiresAt < Date.now())
        return redirect(origin(env) + "/?google=expired", [clearFlow]);
      if (flow.state !== url.searchParams.get("state"))
        // Another tab may own the current flow; reject without clearing it.
        return failed("state_mismatch");
      if (url.searchParams.has("error"))
        return redirect(origin(env) + "/?google=cancelled", [clearFlow]);
      const response = await tokenExchange(env, {
        grant_type: "authorization_code",
        code: url.searchParams.get("code") || "",
        code_verifier: flow.verifier,
        redirect_uri: origin(env) + "/api/google/callback",
      });
      const tokens = await response.json();
      if (!response.ok)
        return failed(
          tokens.error === "invalid_client"
            ? "client_rejected"
            : tokens.error === "invalid_grant"
              ? "grant_rejected"
              : "token_exchange",
          [clearFlow],
        );
      if (!tokens.refresh_token) return failed("offline_access", [clearFlow]);
      if (
        !tokens.access_token ||
        !Number.isFinite(Number(tokens.expires_in)) ||
        Number(tokens.expires_in) <= 0 ||
        !tokens.scope
          ?.split(" ")
          .includes("https://www.googleapis.com/auth/drive.file")
      )
        return failed("token_response", [clearFlow]);
      callbackStage = "account_check";
      const identityResponse = await googleFetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      );
      const identity = await identityResponse.json();
      if (
        !identityResponse.ok ||
        !identity.sub ||
        !identity.email ||
        !identity.email_verified
      )
        return failed("account_check", [clearFlow]);
      callbackStage = "session_save";
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
      const folder =
        previous?.google_subject === identity.sub ? previous.folder_id : "";
      const workbook =
        previous?.google_subject === identity.sub ? previous.workbook_id : "";
      const statements = [
        env.GOOGLE_SESSIONS.prepare(
          "INSERT INTO streamlion_google_sessions_v1 (session_hash, google_subject, email, credentials, workbook_id, expires_at, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          sessionHash,
          identity.sub,
          identity.email,
          encrypted,
          workbook,
          Date.now() + MAX_AGE * 1000,
          folder || "",
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
        folderId: row.folder_id,
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
    if (["workbook", "folder"].includes(route) && request.method === "POST") {
      const isFolder = route === "folder";
      const body = await limitedBody(request, 4096);
      let bookId;
      try {
        const selection = JSON.parse(decoder.decode(body));
        bookId = isFolder ? selection.folderId : selection.bookId;
      } catch {
        throw new Error("bad_request");
      }
      if (!/^[\w-]{1,100}$/.test(bookId || ""))
        return json({ error: "Invalid workbook." }, 400);
      const capacity = await reserveGoogleRequest(
        env.GOOGLE_SESSIONS,
        row.google_subject,
        "GET",
      );
      if (!capacity.allowed) {
        const limited = json(
          {
            error:
              "Google is busy. Wait a moment, then retry choosing your workbook.",
          },
          429,
        );
        limited.headers.set("Retry-After", String(capacity.retryAfter));
        return limited;
      }
      const check = await googleFetch(
        isFolder
          ? `https://www.googleapis.com/drive/v3/files/${bookId}?fields=id,mimeType,trashed,capabilities(canAddChildren)`
          : `https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=spreadsheetId`,
        {
          headers: { Authorization: `Bearer ${await accessToken(env, row)}` },
        },
      );
      if (!check.ok)
        return json(
          { error: "Workbook access could not be verified." },
          check.status === 403 || check.status === 404 ? 403 : 503,
        );
      if (isFolder) {
        const file = await check.json();
        if (
          file.mimeType !== FOLDER_MIME ||
          file.trashed ||
          !file.capabilities?.canAddChildren
        )
          return json({ error: "Choose a writable Drive folder." }, 403);
      }
      const saved = await env.GOOGLE_SESSIONS.prepare(
        isFolder
          ? "UPDATE streamlion_google_sessions_v1 SET folder_id = ? WHERE session_hash = ? AND expires_at > ?"
          : "UPDATE streamlion_google_sessions_v1 SET workbook_id = ? WHERE session_hash = ? AND expires_at > ?",
      )
        .bind(bookId, row.session_hash, Date.now())
        .run();
      if (!saved.meta.changes) return json({ error: "Reconnect Google." }, 401);
      return json(isFolder ? { folderId: bookId } : { bookId });
    }
    if (route === "picker-token" && request.method === "POST")
      return json({ accessToken: await accessToken(env, row) });
    if (
      (route === "sheets" || route === "drive") &&
      ["GET", "POST", "PATCH"].includes(request.method)
    ) {
      const target = upstreamURL(
        route,
        url.searchParams.get("path"),
        request.method,
      );
      if (Number(request.headers.get("Content-Length")) > 6 * 1024 * 1024)
        return json({ error: "File too large." }, 413);
      const body =
        request.method !== "GET" ? await limitedBody(request) : undefined;
      if (route === "drive")
        validateDriveMutation(target, request.method, body);
      if (body?.byteLength > 6 * 1024 * 1024)
        return json({ error: "File too large." }, 413);
      const capacity = await reserveGoogleRequest(
        env.GOOGLE_SESSIONS,
        row.google_subject,
        request.method,
      );
      if (!capacity.allowed) {
        const limited = json(
          {
            error:
              "Google is busy. Your draft is kept. Wait a moment, then retry.",
          },
          429,
        );
        limited.headers.set("Retry-After", String(capacity.retryAfter));
        return limited;
      }
      const response = await googleFetch(target, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${await accessToken(env, row)}`,
          "Content-Type":
            request.headers.get("Content-Type") || "application/json",
        },
        body,
      });
      // Never replay a mutation automatically after an uncertain upstream outcome.
      return new Response(response.body, {
        status: response.status,
        headers: {
          ...headers,
          "Content-Type":
            response.headers.get("Content-Type") || "application/octet-stream",
          ...(response.headers.has("Retry-After")
            ? { "Retry-After": response.headers.get("Retry-After") }
            : {}),
        },
      });
    }
    return json({ error: "Unknown Google operation." }, 404);
  } catch (e) {
    if (
      route === "callback" &&
      request.method === "GET" &&
      url.origin === origin(env)
    )
      return failed(callbackStage, [setCookie(FLOW, "", 0)]);
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
              : status === 413
                ? "This request is too large. Keep the original file and use a smaller attachment."
                : "Google is temporarily unavailable. Your connection and drafts are preserved. Retry shortly.",
      },
      status,
    );
  }
}
