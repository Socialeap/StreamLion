import assert from "node:assert/strict";

const endpoint = process.argv[2] || "http://127.0.0.1:8788/mcp";
let requestId = 0;

async function call(method, params) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  const body = await response.text();
  const line = body.split(/\r?\n/).find((item) => item.startsWith("data: "));
  const result = JSON.parse(line ? line.slice(6) : body);
  assert.ifError(result.error);
  return result.result;
}

const init = await call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "streamlion-smoke", version: "0.1" },
});
assert.equal(init.serverInfo.name, "StreamLion UI prototype");

const tools = await call("tools/list");
assert.deepEqual(
  tools.tools.map((tool) => tool.name).sort(),
  ["show_streamlion_example", "show_streamlion_workspace"],
);
for (const tool of tools.tools) {
  assert.equal(tool._meta?.ui?.resourceUri, "ui://streamlion/workspace-v1.html");
  assert.equal(tool.annotations.readOnlyHint, true);
}

const workspace = await call("tools/call", {
  name: "show_streamlion_workspace",
  arguments: {},
});
assert.deepEqual(workspace.structuredContent, { kind: "workspace" });

const example = await call("tools/call", {
  name: "show_streamlion_example",
  arguments: {},
});
assert.equal(example.structuredContent.kind, "sample");
assert.equal(example.structuredContent.title, "Example venue capture");

const resource = await call("resources/read", {
  uri: "ui://streamlion/workspace-v1.html",
});
assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
assert.match(resource.contents[0].text, /Open workspace here/);
assert.deepEqual(resource.contents[0]._meta.ui.csp.frameDomains, [
  "https://streamlion.transcendencemedia.com",
]);

console.log("MCP smoke test passed: 2 read-only tools and one UI resource.");
