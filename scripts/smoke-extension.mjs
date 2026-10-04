import assert from "node:assert/strict";
const endpoint = process.argv[2] || "http://127.0.0.1:8788/mcp-extension";
let id = 0;
async function call(method, params) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  const body = await response.text(),
    line = body.split(/\r?\n/).find((l) => l.startsWith("data: "));
  const result = JSON.parse(line ? line.slice(6) : body);
  assert.ifError(result.error);
  return result.result;
}
const init = await call("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "streamlion-extension-smoke", version: "1.0" },
});
assert.equal(init.serverInfo.name, "StreamLion extension pilot");
const { tools } = await call("tools/list");
assert.deepEqual(
  tools.find((t) => t.name === "show_streamlion_workspace")._meta["openai/ui"]
    .entrypoints,
  [{ type: "global" }],
);
assert.deepEqual(
  tools.find((t) => t.name === "show_streamlion_current_project")._meta[
    "openai/ui"
  ].entrypoints,
  [{ type: "thread" }],
);
assert.deepEqual(
  tools.find((t) => t.name === "save_streamlion_review")._meta.ui.visibility,
  ["app"],
);
assert.ok(
  tools
    .find((t) => t.name === "get_streamlion_project")
    .securitySchemes.some((s) => s.type === "oauth2"),
);
for (const tool of tools) {
  assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes);
  for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"])
    assert.equal(
      typeof tool.annotations[hint],
      "boolean",
      `${tool.name}: ${hint}`,
    );
}
assert.equal(
  tools.find((t) => t.name === "save_streamlion_review").annotations
    .idempotentHint,
  true,
);
const launch = await call("tools/call", {
  name: "show_streamlion_workspace",
  arguments: {},
});
assert.equal(launch.structuredContent.kind, "workspace");
const example = await call("tools/call", {
  name: "show_streamlion_example",
  arguments: {},
});
assert.equal(example.structuredContent.kind, "example");
const denied = await call("tools/call", {
  name: "list_streamlion_projects",
  arguments: {},
});
assert.equal(denied.isError, true);
assert.equal(denied.structuredContent, undefined);
const resource = await call("resources/read", {
  uri: "ui://streamlion/extension-v1.html",
});
assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
assert.deepEqual(
  resource.contents[0]._meta["openai/ui"].availableDisplayModes,
  ["fullscreen"],
);
assert.deepEqual(resource.contents[0]._meta.ui.csp, {});
assert.match(resource.contents[0].text, /Connect my workbook/);
console.log(
  `Extension smoke passed: ${tools.length} tools, sidebar/thread entrypoints, app-only save, protected reads, self-contained fullscreen UI.`,
);
