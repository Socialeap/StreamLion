import {
  getSession,
  googleConfigurationReady,
  hash,
  seal,
  unseal,
} from "./google-auth.js";
import { reserveSignIn } from "./google-limits.js";
import { hasPurchase, licenseRequired } from "./purchase-access.js";

// Pilot supports one pre-registered public client with PKCE. No dynamic registration,
// arbitrary client URLs, redirect wildcards, or caller-chosen Google accounts.
export const EXTENSION_CLIENT = "https://chatgpt.com/oauth/client.json";
export const EXTENSION_REDIRECT =
  "https://chatgpt.com/connector_platform_oauth_redirect";
export const EXTENSION_SCOPE = "records.read records.write";
const DAY = 86400000;
export const randomToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export class ExtensionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function extensionOrigin(env) {
  return new URL(env.GOOGLE_AUTH_ORIGIN).origin;
}
export function extensionResource(env) {
  return `${extensionOrigin(env)}/mcp-extension`;
}
export function extensionEnabled(env) {
  return (
    env.ENABLE_CHATGPT_EXTENSION === "true" && googleConfigurationReady(env)
  );
}
export async function requireExtension(env) {
  if (!extensionEnabled(env))
    throw new ExtensionError(
      "The ChatGPT pilot is not enabled. Your browser workspace remains available.",
      503,
    );
  const marker = await env.GOOGLE_SESSIONS.prepare(
    "SELECT version FROM streamlion_extension_schema_v1 WHERE version = 1",
  ).first();
  if (!marker)
    throw new ExtensionError("The ChatGPT pilot is not ready yet.", 503);
}
export function extensionJson(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...extra,
    },
  });
}
export function authenticateHeader(env) {
  return `Bearer resource_metadata="${extensionOrigin(env)}/.well-known/oauth-protected-resource/mcp-extension", scope="${EXTENSION_SCOPE}", error="invalid_token", error_description="Connect your StreamLion account to continue"`;
}
export async function extensionPrincipal(request, env) {
  await requireExtension(env);
  if (
    new URL(request.url).origin + new URL(request.url).pathname !==
    extensionResource(env)
  )
    throw new ExtensionError(
      "Reconnect through the production StreamLion extension.",
      401,
    );
  const raw = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/i)?.[1];
  if (!raw)
    throw new ExtensionError(
      "Connect your StreamLion account to open your Google projects.",
      401,
    );
  const grant = await env.GOOGLE_SESSIONS.prepare(
    `SELECT g.* FROM streamlion_extension_tokens_v1 t
    JOIN streamlion_extension_grants_v1 g ON g.grant_id = t.grant_id
    WHERE t.token_hash = ? AND t.kind = 'access' AND t.expires_at > ? AND g.expires_at > ? AND g.revoked = 0`,
  )
    .bind(await hash(raw), Date.now(), Date.now())
    .first();
  if (!grant)
    throw new ExtensionError(
      "Reconnect StreamLion to continue. Nothing has been saved.",
      401,
    );
  const session = await env.GOOGLE_SESSIONS.prepare(
    "SELECT * FROM streamlion_google_sessions_v1 WHERE session_hash = ? AND expires_at > ?",
  )
    .bind(grant.session_hash, Date.now())
    .first();
  if (!session)
    throw new ExtensionError(
      "Reconnect Google in StreamLion, then reconnect this extension.",
      401,
    );
  if (licenseRequired(env) && !(await hasPurchase(env, session.google_subject)))
    throw new ExtensionError(
      "This account does not have workspace access. Open the browser workspace to check your account.",
      403,
    );
  return { grant, session, bookId: grant.workbook_id };
}
function authorizeParams(url, env) {
  const p = Object.fromEntries(url.searchParams);
  if (
    p.client_id !== EXTENSION_CLIENT ||
    p.redirect_uri !== EXTENSION_REDIRECT ||
    p.response_type !== "code" ||
    p.code_challenge_method !== "S256" ||
    !tokenPattern.test(p.code_challenge || "") ||
    p.resource !== extensionResource(env) ||
    !p.state ||
    p.state.length > 2048
  )
    throw new ExtensionError(
      "This connection request is not supported. Start again from StreamLion in ChatGPT.",
    );
  const scopes = (p.scope || "").split(/\s+/).filter(Boolean);
  if (
    !scopes.includes("records.read") ||
    scopes.some((s) => !EXTENSION_SCOPE.split(" ").includes(s))
  )
    throw new ExtensionError("Unsupported access requested.");
  p.scope = [...new Set(scopes)].sort().join(" ");
  return p;
}
function page(body, env) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect StreamLion</title><style>body{font:17px system-ui;color:#153e30;background:#f5f7ef;margin:0;padding:32px 16px}main{max-width:540px;margin:8vh auto;background:white;border:1px solid #cdd9cc;border-radius:20px;padding:32px}h1{font-size:28px}p{line-height:1.6;overflow-wrap:anywhere}a,button{font:inherit;display:inline-block;border:0;border-radius:9px;padding:12px 18px;background:#194f39;color:white;text-decoration:none;cursor:pointer}small{display:block;color:#5f6d65;line-height:1.5;margin-top:20px}label{display:block;padding:12px 0}</style></head><body><main><h1>🦁 Connect StreamLion</h1>${body}<small>Google keeps your project records. This connection can be revoked in ChatGPT. Disconnecting Google in the browser workspace also ends access here.</small></main></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${extensionOrigin(env)}; base-uri 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
async function throttle(request, env, action) {
  const key = await hash(
    `extension:${env.GOOGLE_TOKEN_ENCRYPTION_KEY}:${request.headers.get("CF-Connecting-IP") || "unknown"}`,
  );
  const capacity = await reserveSignIn(
    env.GOOGLE_SESSIONS,
    key,
    `extension-${action}`,
  );
  if (!capacity.allowed)
    throw new ExtensionError("Please wait a minute before trying again.", 429);
}
export async function extensionMetadata(request, env, kind) {
  try {
    await requireExtension(env);
    if (new URL(request.url).origin !== extensionOrigin(env))
      throw new ExtensionError("Unknown metadata host.", 403);
    if (request.method !== "GET")
      return extensionJson({ error: "method_not_allowed" }, 405, {
        Allow: "GET",
      });
    const issuer = extensionOrigin(env);
    return extensionJson(
      kind === "resource"
        ? {
            resource: extensionResource(env),
            authorization_servers: [issuer],
            scopes_supported: EXTENSION_SCOPE.split(" "),
            bearer_methods_supported: ["header"],
          }
        : {
            issuer,
            authorization_endpoint: `${issuer}/api/extension/authorize`,
            token_endpoint: `${issuer}/api/extension/token`,
            revocation_endpoint: `${issuer}/api/extension/revoke`,
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
            scopes_supported: EXTENSION_SCOPE.split(" "),
          },
    );
  } catch {
    return extensionJson({ error: "temporarily_unavailable" }, 503);
  }
}
async function issueTokens(env, grant, previousRefresh) {
  const access = randomToken(),
    refresh = randomToken(),
    now = Date.now();
  // Rotation consumes the old refresh token atomically, so only one request wins.
  if (previousRefresh) {
    const consumed = await env.GOOGLE_SESSIONS.prepare(
      "DELETE FROM streamlion_extension_tokens_v1 WHERE token_hash = ? AND kind = 'refresh' AND expires_at > ? RETURNING grant_id",
    )
      .bind(previousRefresh, now)
      .first();
    if (consumed?.grant_id !== grant.grant_id)
      throw new ExtensionError("invalid_grant");
  }
  await env.GOOGLE_SESSIONS.batch([
    env.GOOGLE_SESSIONS.prepare(
      "INSERT INTO streamlion_extension_tokens_v1 VALUES (?, ?, 'access', ?)",
    ).bind(await hash(access), grant.grant_id, now + 3600000),
    env.GOOGLE_SESSIONS.prepare(
      "INSERT INTO streamlion_extension_tokens_v1 VALUES (?, ?, 'refresh', ?)",
    ).bind(await hash(refresh), grant.grant_id, grant.expires_at),
    env.GOOGLE_SESSIONS.prepare(
      "DELETE FROM streamlion_extension_tokens_v1 WHERE expires_at <= ?",
    ).bind(now),
    env.GOOGLE_SESSIONS.prepare(
      "DELETE FROM streamlion_extension_drafts_v1 WHERE expires_at <= ?",
    ).bind(now),
    env.GOOGLE_SESSIONS.prepare(
      "DELETE FROM streamlion_extension_codes_v1 WHERE expires_at <= ?",
    ).bind(now),
  ]);
  return extensionJson({
    access_token: access,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: refresh,
    scope: grant.scope,
  });
}
export async function handleExtensionAuth({ request, env, params }) {
  try {
    await requireExtension(env);
    if (new URL(request.url).origin !== extensionOrigin(env))
      throw new ExtensionError("Unknown connection host.", 403);
    const route = Array.isArray(params.path)
      ? params.path.join("/")
      : params.path;
    if (route === "authorize" && request.method === "GET") {
      const p = authorizeParams(new URL(request.url), env);
      await throttle(request, env, "authorize");
      const session = await getSession(request, env);
      if (!session)
        return page(
          `<p>Connect your Google account so ChatGPT can work with your StreamLion projects.</p><a href="${escape(`/api/google/start?returnTo=${encodeURIComponent(new URL(request.url).pathname + new URL(request.url).search)}`)}">Connect Google</a>`,
          env,
        );
      if (!session.workbook_id)
        return page(
          `<p>Choose the workbook you want to use. Open <strong>Connections</strong> in StreamLion, select your workbook, then return here.</p><a href="/" target="_blank" rel="noopener">Open StreamLion</a><p><a href="${escape(request.url)}">I’ve chosen my workbook</a></p>`,
          env,
        );
      if (
        licenseRequired(env) &&
        !(await hasPurchase(env, session.google_subject))
      )
        return page(
          `<p>This Google account does not have workspace access. Check the account in your browser workspace, then return here.</p><a href="/" target="_blank" rel="noopener">Open StreamLion</a>`,
          env,
        );
      const consent = await seal(
        env,
        {
          ...p,
          sessionHash: session.session_hash,
          bookId: session.workbook_id,
          expiresAt: Date.now() + 600000,
        },
        "extension-consent",
      );
      return page(
        `<p>Connect <strong>${escape(session.email)}</strong> to ChatGPT.</p><p>Destination: <a href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(session.workbook_id)}/edit" target="_blank" rel="noopener">Your selected StreamLion workbook</a></p><p>ChatGPT can read projects and field records from this workbook${p.scope.includes("records.write") ? ", and prepare changes for you to review. Saving requires a separate click in the workspace" : ""}.</p><form method="post"><input type="hidden" name="consent" value="${escape(consent)}"><button type="submit">Connect this workbook</button></form><p><a href="${escape(EXTENSION_REDIRECT + "?" + new URLSearchParams({ error: "access_denied", state: p.state }))}">Cancel</a></p>`,
        env,
      );
    }
    if (request.method !== "POST")
      return extensionJson({ error: "method_not_allowed" }, 405, {
        Allow: "POST",
      });
    if (Number(request.headers.get("Content-Length") || 0) > 12000)
      throw new ExtensionError("Request too large.", 413);
    const raw = await request.text();
    if (raw.length > 12000) throw new ExtensionError("Request too large.", 413);
    const form = new URLSearchParams(raw);
    if (route === "authorize") {
      if (request.headers.get("Origin") !== extensionOrigin(env))
        throw new ExtensionError(
          "Restart the connection from StreamLion.",
          403,
        );
      const session = await getSession(request, env);
      let p;
      try {
        p = await unseal(env, form.get("consent") || "", "extension-consent");
      } catch {
        throw new ExtensionError(
          "This connection request expired. Start again.",
          403,
        );
      }
      if (
        !session ||
        p.sessionHash !== session.session_hash ||
        p.bookId !== session.workbook_id ||
        p.expiresAt <= Date.now()
      )
        throw new ExtensionError(
          "Your account or workbook changed. Start again.",
          403,
        );
      // Re-validate the encrypted request, not form-supplied redirect parameters.
      authorizeParams(
        new URL(
          `/api/extension/authorize?${new URLSearchParams(p)}`,
          extensionOrigin(env),
        ),
        env,
      );
      if (
        licenseRequired(env) &&
        !(await hasPurchase(env, session.google_subject))
      )
        throw new ExtensionError(
          "Workspace access is unavailable for this account.",
          403,
        );
      await throttle(request, env, "consent");
      const code = randomToken();
      await env.GOOGLE_SESSIONS.prepare(
        "INSERT INTO streamlion_extension_codes_v1 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          await hash(code),
          p.client_id,
          p.redirect_uri,
          p.code_challenge,
          p.resource,
          p.scope,
          session.session_hash,
          p.bookId,
          Date.now() + 300000,
        )
        .run();
      return new Response(null, {
        status: 303,
        headers: {
          Location:
            EXTENSION_REDIRECT +
            "?" +
            new URLSearchParams({ code, state: p.state }),
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    if (form.get("client_id") !== EXTENSION_CLIENT)
      throw new ExtensionError("invalid_client");
    await throttle(request, env, "token");
    if (route === "revoke") {
      const token = form.get("token") || "";
      if (tokenPattern.test(token))
        await env.GOOGLE_SESSIONS.prepare(
          `UPDATE streamlion_extension_grants_v1 SET revoked = 1 WHERE client_id = ? AND grant_id IN (SELECT grant_id FROM streamlion_extension_tokens_v1 WHERE token_hash = ?)`,
        )
          .bind(EXTENSION_CLIENT, await hash(token))
          .run();
      return extensionJson({});
    }
    if (route !== "token") return extensionJson({ error: "not_found" }, 404);
    if (form.get("resource") !== extensionResource(env))
      throw new ExtensionError("invalid_target");
    if (form.get("grant_type") === "authorization_code") {
      const code = form.get("code") || "",
        verifier = form.get("code_verifier") || "";
      if (
        !tokenPattern.test(code) ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
        form.get("redirect_uri") !== EXTENSION_REDIRECT
      )
        throw new ExtensionError("invalid_grant");
      const row = await env.GOOGLE_SESSIONS.prepare(
        `DELETE FROM streamlion_extension_codes_v1 WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND challenge = ? AND resource = ? AND expires_at > ? RETURNING *`,
      )
        .bind(
          await hash(code),
          EXTENSION_CLIENT,
          EXTENSION_REDIRECT,
          await hash(verifier),
          extensionResource(env),
          Date.now(),
        )
        .first();
      if (!row) throw new ExtensionError("invalid_grant");
      const session = await env.GOOGLE_SESSIONS.prepare(
        "SELECT * FROM streamlion_google_sessions_v1 WHERE session_hash = ? AND expires_at > ?",
      )
        .bind(row.session_hash, Date.now())
        .first();
      if (!session) throw new ExtensionError("invalid_grant");
      const grant = {
        grant_id: crypto.randomUUID(),
        scope: row.scope,
        expires_at: Math.min(session.expires_at, Date.now() + 30 * DAY),
      };
      await env.GOOGLE_SESSIONS.prepare(
        "INSERT INTO streamlion_extension_grants_v1 VALUES (?, ?, ?, ?, ?, ?, 0)",
      )
        .bind(
          grant.grant_id,
          EXTENSION_CLIENT,
          row.session_hash,
          row.workbook_id,
          grant.scope,
          grant.expires_at,
        )
        .run();
      return await issueTokens(env, grant);
    }
    if (form.get("grant_type") === "refresh_token") {
      const token = form.get("refresh_token") || "";
      if (!tokenPattern.test(token)) throw new ExtensionError("invalid_grant");
      const tokenHash = await hash(token);
      const grant = await env.GOOGLE_SESSIONS.prepare(
        `SELECT g.* FROM streamlion_extension_tokens_v1 t JOIN streamlion_extension_grants_v1 g ON g.grant_id = t.grant_id
        JOIN streamlion_google_sessions_v1 s ON s.session_hash = g.session_hash
        WHERE t.token_hash = ? AND t.kind = 'refresh' AND t.expires_at > ? AND g.expires_at > ? AND g.revoked = 0 AND s.expires_at > ? AND g.client_id = ?`,
      )
        .bind(tokenHash, Date.now(), Date.now(), Date.now(), EXTENSION_CLIENT)
        .first();
      if (!grant) throw new ExtensionError("invalid_grant");
      if (form.get("scope") && form.get("scope") !== grant.scope)
        throw new ExtensionError("invalid_scope");
      return await issueTokens(env, grant, tokenHash);
    }
    throw new ExtensionError("unsupported_grant_type");
  } catch (error) {
    const known = error instanceof ExtensionError;
    return extensionJson(
      {
        error: known
          ? error.message
          : "Connection temporarily unavailable. Try again.",
      },
      known ? error.status : 503,
    );
  }
}
