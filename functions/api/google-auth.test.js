import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  handleGoogle,
  seal,
  unseal,
  hash,
  upstreamURL,
  validateDriveMutation,
} from "../../server/google-auth.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(
      new URL("../../migrations/0001_google_sessions.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL(
        "../../migrations/0002_google_request_limits.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      new URL(
        "../../migrations/0003_google_workspace_folder.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const wrap = (sql, values = []) => ({
    bind: (...args) => wrap(sql, args),
    first: async () => db.prepare(sql).get(...values) || null,
    run: async () => ({
      meta: { changes: db.prepare(sql).run(...values).changes },
    }),
  });
  const env = {
    ENABLE_PERSISTENT_GOOGLE: "true",
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    VITE_GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "server-secret",
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
  async function session({
    expiredToken = false,
    subject = "account-a",
    id = "a".repeat(43),
  } = {}) {
    const sessionHash = await hash(id);
    const credentials = await seal(
      env,
      {
        accessToken: "synthetic-access",
        refreshToken: "synthetic-refresh",
        expiresAt: Date.now() + (expiredToken ? -1000 : 3600000),
      },
      sessionHash,
    );
    db.prepare(
      "INSERT INTO streamlion_google_sessions_v1 (session_hash,google_subject,email,credentials,workbook_id,expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      sessionHash,
      subject,
      "provider@example.com",
      credentials,
      "book-a",
      Date.now() + 86400000,
    );
    return id;
  }
  function request(
    route,
    {
      method = "GET",
      cookie = "",
      origin = "https://app.example",
      account = "account-a",
      body,
    } = {},
  ) {
    return handleGoogle({
      env,
      params: { path: [route] },
      request: new Request("https://app.example/api/google/" + route, {
        method,
        headers: {
          Cookie: cookie ? `__Host-streamlion-session=${cookie}` : "",
          Origin: origin,
          "X-StreamLion-Account": account,
          "Content-Type": "application/json",
        },
        body,
      }),
    });
  }
  return { db, env, session, request };
}

test("vault encryption binds ciphertext to its session and never stores plaintext credentials", async () => {
  const { env, db, session } = fixture();
  await session();
  const row = db.prepare("SELECT * FROM streamlion_google_sessions_v1").get();
  assert.ok(!row.credentials.includes("synthetic"));
  assert.equal(
    (await unseal(env, row.credentials, row.session_hash)).refreshToken,
    "synthetic-refresh",
  );
  await assert.rejects(unseal(env, row.credentials, "different-session"));
});

test("sign-in attempts are limited across requests without storing a raw network address or issuing another authorization cookie", async (t) => {
  t.mock.method(Date, "now", () => 120000);
  const { env, db } = fixture();
  async function start() {
    return handleGoogle({
      env,
      params: { path: ["start"] },
      request: new Request("https://app.example/api/google/start", {
        headers: { "CF-Connecting-IP": "192.0.2.123" },
      }),
    });
  }
  for (let count = 0; count < 5; count++)
    assert.equal((await start()).status, 303);
  const limited = await start();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) >= 1);
  assert.equal(limited.headers.has("Set-Cookie"), false);
  const scopes = db
    .prepare("SELECT scope FROM streamlion_google_request_limits_v1")
    .all();
  assert.equal(JSON.stringify(scopes).includes("192.0.2.123"), false);
  assert.equal(
    JSON.stringify(scopes).includes(env.GOOGLE_TOKEN_ENCRYPTION_KEY),
    false,
  );
  assert.equal(
    db
      .prepare(
        "SELECT used FROM streamlion_google_request_limits_v1 WHERE scope='project:signin:start'",
      )
      .get().used,
    5,
  );
});

test("OAuth start uses PKCE, offline access, fixed callback and secure short-lived flow cookie", async () => {
  const { request } = fixture();
  const response = await request("start");
  assert.equal(response.status, 303);
  const target = new URL(response.headers.get("Location"));
  assert.equal(target.searchParams.get("access_type"), "offline");
  assert.equal(target.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    target.searchParams.get("redirect_uri"),
    "https://app.example/api/google/callback",
  );
  assert.match(
    response.headers.get("Set-Cookie"),
    /Secure; HttpOnly; SameSite=Lax; Max-Age=600/,
  );
  assert.equal(response.headers.has("Content-Disposition"), false);
  assert.equal(response.headers.has("Content-Security-Policy"), false);
  const missingFlow = await request("callback");
  assert.equal(missingFlow.status, 303);
  assert.equal(
    missingFlow.headers.get("Location"),
    "https://app.example/?google=expired",
  );
});

test("callback rejects mismatched state without calling Google", async () => {
  const { env, request } = fixture();
  const start = await request("start");
  const flow = start.headers.get("Set-Cookie").split(";")[0];
  const response = await handleGoogle({
    env,
    params: { path: ["callback"] },
    request: new Request(
      "https://app.example/api/google/callback?state=attacker&code=bad",
      { headers: { Cookie: flow } },
    ),
  });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    "https://app.example/?google=failed",
  );
  assert.equal(response.headers.has("Content-Disposition"), false);
  assert.equal(response.headers.has("Content-Security-Policy"), false);
});

test("expired OAuth flows return to the app without exchanging a code", async () => {
  const { env } = fixture();
  const flow = await seal(
    env,
    { expiresAt: Date.now() - 1000, state: "expired" },
    "oauth-flow",
  );
  const response = await handleGoogle({
    env,
    params: { path: ["callback"] },
    request: new Request(
      "https://app.example/api/google/callback?state=expired&code=synthetic",
      {
      headers: { Cookie: `__Host-streamlion-oauth=${flow}` },
      },
    ),
  });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("Location"),
    "https://app.example/?google=expired",
  );
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/);
});

test("Google exchange failures return to Connections rather than an API download", async () => {
  const { env, request } = fixture();
  const start = await request("start");
  const flowCookie = start.headers.get("Set-Cookie").split(";")[0];
  const flow = await unseal(env, flowCookie.split("=")[1], "oauth-flow");
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("temporary upstream failure");
  };
  try {
    const response = await handleGoogle({
      env,
      params: { path: ["callback"] },
      request: new Request(
        `https://app.example/api/google/callback?state=${flow.state}&code=synthetic`,
        {
          headers: { Cookie: flowCookie },
        },
      ),
    });
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("Location"),
      "https://app.example/?google=failed",
    );
    assert.equal(response.headers.has("Content-Disposition"), false);
  } finally {
    globalThis.fetch = original;
  }
});

for (const subject of ["account-a", "account-b"])
  test(`callback ${subject === "account-a" ? "preserves" : "isolates"} workbook and folder selection and replaces the old session`, async () => {
    const f = fixture();
    const id = await f.session();
    f.db.exec(
      "UPDATE streamlion_google_sessions_v1 SET folder_id = 'folder-a'",
    );
    const start = await f.request("start");
    const flowCookie = start.headers.get("Set-Cookie").split(";")[0];
    const flow = await unseal(f.env, flowCookie.split("=")[1], "oauth-flow");
    const original = globalThis.fetch;
    globalThis.fetch = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/token")
            ? {
                access_token: "new-token",
                refresh_token: "new-refresh",
                expires_in: 3600,
                scope:
                  "openid email https://www.googleapis.com/auth/drive.file",
              }
            : {
                sub: subject,
                email: "second@example.com",
                email_verified: true,
              },
        ),
      );
    try {
      const response = await handleGoogle({
        env: f.env,
        params: { path: ["callback"] },
        request: new Request(
          `https://app.example/api/google/callback?state=${flow.state}&code=synthetic-code`,
          {
            headers: {
              Cookie: flowCookie + `; __Host-streamlion-session=${id}`,
            },
          },
        ),
      });
      assert.equal(response.status, 303);
      const rows = f.db
        .prepare("SELECT * FROM streamlion_google_sessions_v1")
        .all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].google_subject, subject);
      assert.equal(
        rows[0].workbook_id,
        subject === "account-a" ? "book-a" : "",
      );
      assert.equal(
        rows[0].folder_id,
        subject === "account-a" ? "folder-a" : "",
      );
      assert.equal((await f.request("session", { cookie: id })).status, 200);
      assert.equal(
        (await (await f.request("session", { cookie: id })).json()).connected,
        false,
      );
      assert.match(
        response.headers.get("Set-Cookie"),
        /__Host-streamlion-session=/,
      );
    } finally {
      globalThis.fetch = original;
    }
  });

test("session restores metadata, never exposes tokens, and rejects cross-origin/account mutations", async () => {
  const { request, session } = fixture();
  const id = await session();
  const response = await request("session", { cookie: id });
  assert.deepEqual(await response.json(), {
    enabled: true,
    connected: true,
    account: "provider@example.com",
    subject: "account-a",
    bookId: "book-a",
    folderId: "",
  });
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
  assert.equal(
    (
      await request("disconnect", {
        method: "POST",
        cookie: id,
        origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("disconnect", {
        method: "POST",
        cookie: id,
        account: "account-b",
      })
    ).status,
    401,
  );
  assert.equal(
    (await request("disconnect", { method: "POST", cookie: id })).status,
    200,
  );
  assert.equal(
    (await (await request("session", { cookie: id })).json()).connected,
    false,
  );
});

test("transient refresh failures preserve the vault; revocation removes the session", async () => {
  const { request, session, db } = fixture();
  const id = await session({ expiredToken: true });
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "temporarily_unavailable" }), {
        status: 503,
      });
    assert.equal((await request("session", { cookie: id })).status, 503);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM streamlion_google_sessions_v1")
        .get().n,
      1,
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    assert.equal((await request("session", { cookie: id })).status, 401);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM streamlion_google_sessions_v1")
        .get().n,
      0,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("concurrent expired-session reads share renewal and disconnect cannot resurrect the token", async () => {
  const { request, session, db } = fixture();
  const id = await session({ expiredToken: true });
  let complete,
    calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    calls++;
    return new Promise((resolve) => {
      complete = () =>
        resolve(
          new Response(
            JSON.stringify({ access_token: "renewed", expires_in: 3600 }),
          ),
        );
    });
  };
  try {
    const a = request("session", { cookie: id }),
      b = request("session", { cookie: id });
    while (!complete) await new Promise((resolve) => setTimeout(resolve, 0));
    await request("disconnect", { method: "POST", cookie: id });
    complete();
    assert.equal((await a).status, 401);
    assert.equal((await b).status, 401);
    assert.equal(calls, 1);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM streamlion_google_sessions_v1")
        .get().n,
      0,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("proxy allows only required fixed-host operations", () => {
  assert.equal(
    upstreamURL(
      "sheets",
      "/book/values/Projects!A%3AB:append?valueInputOption=RAW",
      "POST",
    ).hostname,
    "sheets.googleapis.com",
  );
  assert.equal(
    upstreamURL("drive", "upload/drive/v3/files?uploadType=multipart", "POST")
      .hostname,
    "www.googleapis.com",
  );
  for (const [service, path, method] of [
    ["sheets", "//attacker.example", "GET"],
    ["drive", "https://attacker.example", "GET"],
    ["drive", "drive/v3/files/book", "DELETE"],
    ["drive", "drive/v3/files/../other", "GET"],
    ["sheets", "/book:batchUpdate", "POST"],
  ])
    assert.throws(() => upstreamURL(service, path, method));
});

test("successful renewal is encrypted and reused without another Google refresh", async () => {
  const { request, session, db } = fixture();
  const id = await session({ expiredToken: true });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({ access_token: "renewed-access", expires_in: 3600 }),
    );
  };
  try {
    assert.equal((await request("session", { cookie: id })).status, 200);
    assert.equal((await request("session", { cookie: id })).status, 200);
    assert.equal(calls, 1);
    assert.ok(
      !db
        .prepare("SELECT credentials FROM streamlion_google_sessions_v1")
        .get()
        .credentials.includes("renewed-access"),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("workbook selection is remembered only after Google verifies access", async () => {
  const { request, session, db } = fixture();
  const id = await session();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("denied", { status: 403 });
    assert.equal(
      (
        await request("workbook", {
          cookie: id,
          method: "POST",
          body: JSON.stringify({ bookId: "new-book" }),
        })
      ).status,
      403,
    );
    assert.equal(
      db.prepare("SELECT workbook_id FROM streamlion_google_sessions_v1").get()
        .workbook_id,
      "book-a",
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ spreadsheetId: "new-book" }));
    assert.equal(
      (
        await request("workbook", {
          cookie: id,
          method: "POST",
          body: JSON.stringify({ bookId: "new-book" }),
        })
      ).status,
      200,
    );
    assert.equal(
      db.prepare("SELECT workbook_id FROM streamlion_google_sessions_v1").get()
        .workbook_id,
      "new-book",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("proxy carries RAW writes once and prevents Drive content from executing on the app origin", async () => {
  const f = fixture();
  const id = await f.session();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(new URL(url).searchParams.get("valueInputOption"), "RAW");
    assert.equal(options.headers.Authorization, "Bearer synthetic-access");
    assert.equal(
      new TextDecoder().decode(options.body),
      '{"values":[["=source text"]]}',
    );
    return new Response('{"ok":true}');
  };
  try {
    const response = await handleGoogle({
      env: f.env,
      params: { path: ["sheets"] },
      request: new Request(
        "https://app.example/api/google/sheets?path=" +
          encodeURIComponent(
            "/book-a/values/Projects!A%3AB:append?valueInputOption=RAW",
          ),
        {
          method: "POST",
          headers: {
            Cookie: `__Host-streamlion-session=${id}`,
            Origin: "https://app.example",
            "X-StreamLion-Account": "account-a",
          },
          body: '{"values":[["=source text"]]}',
        },
      ),
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
    assert.match(response.headers.get("Content-Security-Policy"), /sandbox/);
    assert.equal(response.headers.get("Content-Disposition"), "attachment");
  } finally {
    globalThis.fetch = original;
  }
});

test("persistent mode fails closed when configuration is missing", async () => {
  const { env, request } = fixture();
  env.GOOGLE_CLIENT_SECRET = "";
  assert.equal((await request("session")).status, 503);
  env.ENABLE_PERSISTENT_GOOGLE = "false";
  assert.deepEqual(await (await request("session")).json(), {
    enabled: false,
    connected: false,
  });
});
test("expired sessions are removed on lookup and malformed or oversized selections never call Google", async () => {
  const f = fixture();
  const id = await f.session();
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Google must not be called");
  };
  try {
    assert.equal(
      (await f.request("workbook", { cookie: id, method: "POST", body: "{" }))
        .status,
      400,
    );
    assert.equal(
      (
        await f.request("workbook", {
          cookie: id,
          method: "POST",
          body: "x".repeat(4097),
        })
      ).status,
      413,
    );
    f.db
      .prepare("UPDATE streamlion_google_sessions_v1 SET expires_at = 0")
      .run();
    assert.equal(
      (await (await f.request("session", { cookie: id })).json()).connected,
      false,
    );
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) AS count FROM streamlion_google_sessions_v1")
        .get().count,
      0,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("workbook selection shares the project quota and preserves the previous destination on rejection", async () => {
  const f = fixture();
  const id = await f.session();
  const window = Math.floor(Date.now() / 60000) * 60000;
  f.db
    .prepare("INSERT INTO streamlion_google_request_limits_v1 VALUES (?,?,?)")
    .run("project:read", window, 200);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}");
  };
  try {
    const response = await f.request("workbook", {
      cookie: id,
      method: "POST",
      body: JSON.stringify({ bookId: "another-book" }),
    });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("Retry-After")) > 0);
    assert.equal(calls, 0);
    assert.equal(
      f.db
        .prepare("SELECT workbook_id FROM streamlion_google_sessions_v1")
        .get().workbook_id,
      "book-a",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("folder destination is verified before persistence and restores with the same session", async () => {
  const f = fixture();
  const id = await f.session();
  const original = globalThis.fetch;
  let writable = false;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: "folder-a",
        mimeType: "application/vnd.google-apps.folder",
        capabilities: { canAddChildren: writable },
      }),
    );
  try {
    const select = () =>
      f.request("folder", {
        method: "POST",
        cookie: id,
        body: JSON.stringify({ folderId: "folder-a" }),
      });
    assert.equal((await select()).status, 403);
    assert.equal(
      f.db.prepare("SELECT folder_id FROM streamlion_google_sessions_v1").get()
        .folder_id,
      "",
    );
    writable = true;
    assert.equal((await select()).status, 200);
    assert.equal(
      (await (await f.request("session", { cookie: id })).json()).folderId,
      "folder-a",
    );
    assert.equal(
      (
        await f.request("folder", {
          method: "POST",
          cookie: id,
          account: "account-b",
          body: JSON.stringify({ folderId: "folder-b" }),
        })
      ).status,
      401,
    );
    assert.equal(
      f.db.prepare("SELECT folder_id FROM streamlion_google_sessions_v1").get()
        .folder_id,
      "folder-a",
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("folder proxy accepts only folder creation and parent-only moves, never sharing, trashing or replacing file content", () => {
  const body = (data) => new TextEncoder().encode(JSON.stringify(data));
  const folder = {
    id: "new-folder",
    name: "StreamLion",
    mimeType: "application/vnd.google-apps.folder",
    appProperties: { streamlionRole: "workspace" },
  };
  const create = upstreamURL("drive", "drive/v3/files?fields=id", "POST");
  validateDriveMutation(create, "POST", body(folder));
  for (const data of [
    { ...folder, mimeType: "text/plain" },
    { ...folder, permissions: [{}] },
    { ...folder, parents: ["a", "b"] },
    { ...folder, id: "../x" },
    { ...folder, trashed: true },
  ])
    assert.throws(
      () => validateDriveMutation(create, "POST", body(data)),
      /bad_request/,
    );
  const move = upstreamURL(
    "drive",
    "drive/v3/files/book?addParents=folder&removeParents=previous&fields=id,parents",
    "PATCH",
  );
  validateDriveMutation(move, "PATCH", body({}));
  assert.throws(
    () => validateDriveMutation(move, "PATCH", body({ trashed: true })),
    /bad_request/,
  );
  assert.throws(
    () =>
      validateDriveMutation(
        upstreamURL("drive", "drive/v3/files/book?fields=id", "PATCH"),
        "PATCH",
        body({}),
      ),
    /bad_request/,
  );
});
