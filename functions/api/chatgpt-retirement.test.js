import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as middleware } from "../_middleware.js";
import { onRequest as legacyMcp } from "../mcp.js";
import { onRequest as extensionMcp } from "../mcp-extension.js";
import { onRequest as auth } from "./extension/[[path]].js";
import { onRequest as authorizationMetadata } from "../.well-known/oauth-authorization-server.js";
import { onRequest as resourceMetadata } from "../.well-known/oauth-protected-resource/mcp-extension.js";

const retiredRoutes = [
  ["/mcp", legacyMcp],
  ["/mcp-extension", extensionMcp],
  ["/api/extension/authorize", auth],
  ["/api/extension/token", auth],
  ["/api/extension/revoke", auth],
  ["/.well-known/oauth-authorization-server", authorizationMetadata],
  ["/.well-known/oauth-protected-resource/mcp-extension", resourceMetadata],
];

test("retired endpoints deny old clients without reading credentials, data or request bodies", async () => {
  for (const [path, handler] of retiredRoutes) {
    for (const method of ["GET", "POST", "HEAD", "OPTIONS"]) {
      const request = new Request(`https://app.example${path}`, {
        method,
        headers: { Authorization: "Bearer old-token" },
        ...(method === "POST"
          ? { body: "grant_type=refresh_token&refresh_token=old" }
          : {}),
      });
      const response = await handler({
        request,
        // Even a legacy deployment with the pilot flag on must be retired.
        env: {
          ENABLE_CHATGPT_EXTENSION: "true",
          GOOGLE_SESSIONS: new Proxy(
            {},
            {
              get() {
                throw Error("Retirement must not access the database");
              },
            },
          ),
        },
      });
      assert.equal(response.status, 410, `${method} ${path}`);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.equal(response.headers.get("Location"), null);
      assert.equal(response.headers.get("WWW-Authenticate"), null);
      assert.equal(request.bodyUsed, false);
      if (method === "HEAD") assert.equal(await response.text(), "");
      else assert.equal((await response.json()).error, "chatgpt_route_retired");
    }
  }
});

test("middleware retires discovery, descendants and fixture before route dispatch", async () => {
  for (const path of [
    ...retiredRoutes.map(([path]) => path),
    "/mcp/",
    "/mcp-extension/",
    "/mcp/tools/list",
    "/mcp-extension/resources/read",
    "/api/extension",
    "/api/extension/",
    "/api/extension/unknown",
    "/extension.html",
    "/extension.html/",
  ]) {
    const response = await middleware({
      request: new Request(`https://app.example${path}?old-client=1`),
      next() {
        throw Error("Retired request reached route dispatch");
      },
    });
    assert.equal(response.status, 410, path);
    assert.ok(response.headers.get("X-StreamLion-Request-ID"));
  }
});

test("retirement preserves Google, paid AI, imports, credits and ordinary workspace routes", async () => {
  for (const path of [
    "/",
    "/api/google/status",
    "/api/google/workbook",
    "/api/ai/answer",
    "/api/brief-import/config",
    "/api/credits/config",
    "/api/purchase/status",
    "/api/coordination",
    "/assets/app.js",
  ]) {
    let dispatches = 0;
    const response = await middleware({
      request: new Request(`https://app.example${path}`),
      next() {
        dispatches++;
        return Response.json({ existingGate: true }, { status: 403 });
      },
    });
    assert.equal(dispatches, 1, path);
    assert.equal(response.status, 403, path);
    assert.deepEqual(await response.json(), { existingGate: true });
  }
});
