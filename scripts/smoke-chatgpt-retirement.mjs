import assert from "node:assert/strict";

// Read-only retirement checks plus a synthetic MCP initialization. No credentials,
// workbook selection, provider calls, credit mutations or real project data.
const origin = new URL(process.argv[2] || "http://127.0.0.1:8788").origin;
for (const path of [
  "/mcp",
  "/mcp-extension",
  "/mcp/tools/list",
  "/mcp-extension/resources/read",
  "/api/extension/authorize",
  "/api/extension/token",
  "/api/extension/revoke",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource/mcp-extension",
  "/extension.html",
]) {
  for (const method of ["GET", "POST"]) {
    const response = await fetch(origin + path, {
      method,
      redirect: "manual",
      ...(method === "POST"
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {},
            }),
          }
        : {}),
    });
    assert.equal(response.status, 410, `${method} ${path}`);
    assert.equal(response.headers.get("Cache-Control"), "no-store", path);
    assert.equal((await response.json()).error, "chatgpt_route_retired", path);
  }
}
console.log(
  "PASS: retired ChatGPT MCP, OAuth, descendant and fixture routes return HTTP 410 (GET and POST).",
);
