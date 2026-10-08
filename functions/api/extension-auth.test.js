import test from "node:test";
import assert from "node:assert/strict";
import { extensionFixture } from "../../test/extension-fixture.js";
import {
  EXTENSION_CLIENT,
  EXTENSION_REDIRECT,
  EXTENSION_APP_REDIRECT,
  extensionPrincipal,
  extensionMetadata,
} from "../../server/extension-auth.js";
import { googleReturnPath, hash } from "../../server/google-auth.js";

test("pilot fails closed without activation or schema; metadata is resource-bound", async () => {
  const f = await extensionFixture();
  let response = await extensionMetadata(
    new Request(
      "https://app.example/.well-known/oauth-protected-resource/mcp-extension",
    ),
    f.env,
    "resource",
  );
  assert.equal(
    (await response.json()).resource,
    "https://app.example/mcp-extension",
  );
  f.env.ENABLE_CHATGPT_EXTENSION = "false";
  assert.equal((await f.auth("authorize")).status, 503);
  await assert.rejects(
    () =>
      extensionPrincipal(
        new Request("https://app.example/mcp-extension"),
        f.env,
      ),
    /not enabled/,
  );
  f.env.ENABLE_CHATGPT_EXTENSION = "true";
  f.db.exec("DROP TABLE streamlion_extension_schema_v1");
  assert.equal((await f.auth("authorize")).status, 503);
});
test("redirect, client, resource and PKCE checks reject substitutions without redirecting", async () => {
  for (const [key, value] of [
    ["redirect_uri", "https://evil.example/callback"],
    ["client_id", "https://evil.example/client.json"],
    ["resource", "https://evil.example/mcp"],
    ["code_challenge_method", "plain"],
    ["scope", "records.read admin"],
  ]) {
    const f = await extensionFixture(),
      params = new URLSearchParams(f.authorization);
    params.set(key, value);
    const response = await f.auth("authorize", { params });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Location"), null);
  }
});
test("consent requires same origin, same live account and same selected workbook", async () => {
  const f = await extensionFixture(),
    page = await f.auth("authorize"),
    consent = (await page.text()).match(/name="consent" value="([^"]+)"/)[1];
  assert.equal(
    (
      await f.auth("authorize", {
        method: "POST",
        body: { consent },
        origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.auth("authorize", {
        method: "POST",
        body: { consent },
        cookieValue: "b".repeat(43),
      })
    ).status,
    403,
  );
  f.db
    .prepare("UPDATE streamlion_google_sessions_v1 SET workbook_id='book-b'")
    .run();
  assert.equal(
    (await f.auth("authorize", { method: "POST", body: { consent } })).status,
    403,
  );
  assert.equal(
    f.db
      .prepare("SELECT COUNT(*) AS n FROM streamlion_extension_codes_v1")
      .get().n,
    0,
  );
});
test("both exact callbacks retain consent, cancel and code-exchange destinations", async () => {
  for (const redirect of [EXTENSION_REDIRECT, EXTENSION_APP_REDIRECT]) {
    const f = await extensionFixture({ redirect });
    const html = await (await f.auth("authorize")).text();
    const cancel = html
      .match(/<a href="([^"]+)">Cancel<\/a>/)[1]
      .replaceAll("&amp;", "&");
    assert.equal(new URL(cancel).origin + new URL(cancel).pathname, redirect);
    const consent = html.match(/name="consent" value="([^"]+)"/)[1];
    const response = await f.auth("authorize", {
      method: "POST",
      body: { consent },
    });
    const target = new URL(response.headers.get("Location"));
    assert.equal(target.origin + target.pathname, redirect);
    assert.equal(target.searchParams.get("state"), "synthetic-state");
    const code = target.searchParams.get("code");
    const wrong =
      redirect === EXTENSION_REDIRECT
        ? EXTENSION_APP_REDIRECT
        : EXTENSION_REDIRECT;
    assert.equal(
      (
        await f.auth("token", {
          method: "POST",
          body: {
            client_id: EXTENSION_CLIENT,
            grant_type: "authorization_code",
            code,
            code_verifier: f.verifier,
            redirect_uri: wrong,
            resource: "https://app.example/mcp-extension",
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.exchange(code)).status,
      200,
      "wrong allowed callback does not consume the code",
    );
    assert.equal((await f.exchange(code)).status, 400);
  }
});
test("registered callback is an exact allowlist entry, never a prefix or wildcard", async () => {
  for (const redirect of [
    `${EXTENSION_APP_REDIRECT}/`,
    `${EXTENSION_APP_REDIRECT}?next=evil`,
    `${EXTENSION_APP_REDIRECT}#fragment`,
    "https://chatgpt.com/connector/oauth/another-app",
    "https://chatgpt.com.evil.example/connector/oauth/DPNQcee_niD1",
  ]) {
    const f = await extensionFixture({ redirect });
    const response = await f.auth("authorize");
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Location"), null);
  }
});
test("authorization codes are single-use; a bad verifier cannot consume the valid code", async () => {
  const f = await extensionFixture(),
    code = await f.code();
  const bad = await f.auth("token", {
    method: "POST",
    body: {
      client_id: EXTENSION_CLIENT,
      code,
      code_verifier: "x".repeat(43),
      grant_type: "authorization_code",
      redirect_uri: EXTENSION_REDIRECT,
      resource: "https://app.example/mcp-extension",
    },
  });
  assert.equal(bad.status, 400);
  const response = await f.exchange(code);
  assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.ok(tokens.access_token);
  assert.equal((await f.exchange(code)).status, 400);
  const stored = JSON.stringify(
    f.db.prepare("SELECT * FROM streamlion_extension_tokens_v1").all(),
  );
  assert.ok(!stored.includes(tokens.access_token));
  assert.ok(!stored.includes(tokens.refresh_token));
});
test("refresh rotates once; revocation and Google disconnect invalidate access", async () => {
  const f = await extensionFixture(),
    { tokens, request, principal } = await f.connect();
  assert.equal(principal.bookId, "book-a");
  f.db
    .prepare("UPDATE streamlion_google_sessions_v1 SET workbook_id='book-b'")
    .run();
  assert.equal(
    (await extensionPrincipal(request, f.env)).bookId,
    "book-a",
    "grant never silently follows a new workbook",
  );
  const refresh = () =>
    f.auth("token", {
      method: "POST",
      body: {
        client_id: EXTENSION_CLIENT,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        resource: "https://app.example/mcp-extension",
      },
    });
  const rotated = await refresh();
  assert.equal(rotated.status, 200);
  assert.equal((await refresh()).status, 400);
  const next = await rotated.json();
  await f.auth("revoke", {
    method: "POST",
    body: { client_id: EXTENSION_CLIENT, token: next.refresh_token },
  });
  await assert.rejects(
    () => extensionPrincipal(request, f.env),
    /Reconnect StreamLion/,
  );
  const g = await extensionFixture(),
    connected = await g.connect();
  g.db.prepare("DELETE FROM streamlion_google_sessions_v1").run();
  await assert.rejects(
    () => extensionPrincipal(connected.request, g.env),
    /Reconnect Google/,
  );
});
test("expired tokens and grants cannot read records; paid account gate is enforced", async () => {
  const f = await extensionFixture(),
    { tokens, request } = await f.connect();
  f.env.STREAMLION_REQUIRE_LICENSE = "true";
  f.env.STREAMLION_PAYMENTS_MODE = "test";
  await assert.rejects(
    () => extensionPrincipal(request, f.env),
    /does not have workspace access/,
  );
  f.env.STREAMLION_REQUIRE_LICENSE = "false";
  f.db
    .prepare(
      "UPDATE streamlion_extension_tokens_v1 SET expires_at=0 WHERE token_hash=?",
    )
    .run(await hash(tokens.access_token));
  await assert.rejects(
    () => extensionPrincipal(request, f.env),
    /Reconnect StreamLion/,
  );
});
test("Google continuation allows only the optional authorization page", () => {
  const env = {
    GOOGLE_AUTH_ORIGIN: "https://app.example",
    ENABLE_CHATGPT_EXTENSION: "true",
  };
  assert.equal(googleReturnPath("purchase", env), "/api/purchase");
  assert.equal(
    googleReturnPath("/api/client-requests", env),
    "/api/client-requests",
  );
  assert.equal(
    googleReturnPath("https://attacker.example/api/client-requests", env),
    "/",
  );
  assert.equal(
    googleReturnPath(
      "/api/client-requests?returnTo=https://attacker.example",
      env,
    ),
    "/",
  );
  assert.equal(
    googleReturnPath("/api/extension/authorize?state=abc", env),
    "/api/extension/authorize?state=abc",
  );
  for (const path of [
    "//evil.example/",
    "https://evil.example/",
    "/api/extension/authorize?state=a#fragment",
    "/api/extension/authorize?\\evil",
    "/api/google/disconnect",
  ])
    assert.equal(googleReturnPath(path, env), "/");
  assert.equal(
    googleReturnPath("/api/extension/authorize?state=abc", {
      ...env,
      ENABLE_CHATGPT_EXTENSION: "false",
    }),
    "/",
  );
});
