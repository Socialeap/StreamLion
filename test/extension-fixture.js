import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { hash, seal } from "../server/google-auth.js";
import {
  EXTENSION_CLIENT,
  EXTENSION_REDIRECT,
  EXTENSION_SCOPE,
  handleExtensionAuth,
  extensionPrincipal,
} from "../server/extension-auth.js";
import { TABS } from "../src/workbook.js";

export async function extensionFixture({ redirect = EXTENSION_REDIRECT } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "0001_google_sessions.sql",
    "0002_google_request_limits.sql",
    "0003_google_workspace_folder.sql",
    "0004_streamlion_purchases.sql",
    "0005_streamlion_launch_200.sql",
    "0006_chatgpt_extension.sql",
  ])
    db.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    );
  const wrap = (sql, values = []) => ({
    bind: (...v) => wrap(sql, v),
    first: async () => db.prepare(sql).get(...values) || null,
    all: async () => ({ results: db.prepare(sql).all(...values) }),
    run: async () => ({
      meta: { changes: db.prepare(sql).run(...values).changes },
    }),
  });
  const env = {
    ENABLE_CHATGPT_EXTENSION: "true",
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    VITE_GOOGLE_CLIENT_ID: "synthetic.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "synthetic-secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    GOOGLE_SESSIONS: {
      prepare: wrap,
      batch: async (statements) => {
        db.exec("BEGIN");
        try {
          const results = [];
          for (const s of statements) results.push(await s.run());
          db.exec("COMMIT");
          return results;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    },
  };
  const cookie = "a".repeat(43),
    sessionHash = await hash(cookie);
  const credentials = await seal(
    env,
    {
      accessToken: "synthetic-google-access",
      refreshToken: "synthetic-refresh",
      expiresAt: Date.now() + 3600000,
    },
    sessionHash,
  );
  db.prepare(
    "INSERT INTO streamlion_google_sessions_v1 VALUES (?, 'account-a', 'provider@example.com', ?, 'book-a', ?, 'folder-a')",
  ).run(sessionHash, credentials, Date.now() + 86400000);
  const verifier = "v".repeat(43);
  const authorization = new URLSearchParams({
    client_id: EXTENSION_CLIENT,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: await hash(verifier),
    resource: "https://app.example/mcp-extension",
    state: "synthetic-state",
    scope: EXTENSION_SCOPE,
  });
  const auth = (
    route,
    {
      method = "GET",
      body,
      params = authorization,
      origin = "https://app.example",
      cookieValue = cookie,
    } = {},
  ) =>
    handleExtensionAuth({
      env,
      params: { path: [route] },
      request: new Request(
        `https://app.example/api/extension/${route}${method === "GET" ? `?${params}` : ""}`,
        {
          method,
          headers: {
            Cookie: `__Host-streamlion-session=${cookieValue}`,
            Origin: origin,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          ...(body ? { body: new URLSearchParams(body) } : {}),
        },
      ),
    });
  async function code() {
    const page = await auth("authorize"),
      html = await page.text();
    const consent = html.match(/name="consent" value="([^"]+)"/)?.[1];
    if (!consent) throw new Error(html);
    const response = await auth("authorize", {
      method: "POST",
      body: { consent },
    });
    return new URL(response.headers.get("Location")).searchParams.get("code");
  }
  const exchange = (c) =>
    auth("token", {
      method: "POST",
      body: {
        client_id: EXTENSION_CLIENT,
        grant_type: "authorization_code",
        code: c,
        code_verifier: verifier,
        redirect_uri: redirect,
        resource: "https://app.example/mcp-extension",
      },
    });
  async function connect() {
    const response = await exchange(await code());
    const tokens = await response.json();
    const request = new Request("https://app.example/mcp-extension", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    return {
      tokens,
      request,
      principal: await extensionPrincipal(request, env),
    };
  }
  const sheets = {
    Projects: [[...TABS.Projects]],
    Observations: [[...TABS.Observations]],
  };
  let writes = 0,
    afterWriteFailure = false;
  const fetch = async (url, options = {}) => {
    if (!url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/book-a"))
      throw new Error(`Unexpected destination ${url}`);
    if (options.headers.Authorization !== "Bearer synthetic-google-access")
      throw new Error("Wrong Google token");
    if (options.method === "POST") {
      const tab = decodeURIComponent(new URL(url).pathname).includes(
        "Projects!",
      )
        ? "Projects"
        : "Observations";
      const values = JSON.parse(options.body).values;
      sheets[tab].push(...values);
      writes++;
      if (afterWriteFailure) {
        afterWriteFailure = false;
        throw new Error("synthetic timeout after accepted append");
      }
      return new Response(JSON.stringify({ updates: { updatedRows: 1 } }));
    }
    if (url.includes("values:batchGet"))
      return new Response(
        JSON.stringify({
          valueRanges: Object.values(sheets).map((values) => ({ values })),
        }),
      );
    return new Response(
      JSON.stringify({
        properties: { title: "Synthetic workbook" },
        sheets: Object.keys(sheets).map((title) => ({
          properties: { title, gridProperties: { rowCount: 100 } },
        })),
      }),
    );
  };
  return {
    env,
    db,
    cookie,
    sessionHash,
    verifier,
    authorization,
    auth,
    code,
    exchange,
    connect,
    fetch,
    sheets,
    get writes() {
      return writes;
    },
    failAfterAppend() {
      afterWriteFailure = true;
    },
  };
}
