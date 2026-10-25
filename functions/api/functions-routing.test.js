import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const routes = () => {
  const file = new URL("../../public/_routes.json", import.meta.url);
  // Wrangler's current default with root middleware: every request invokes it.
  return existsSync(file)
    ? JSON.parse(readFileSync(file))
    : { version: 1, include: ["/*"], exclude: [] };
};
const matches = (pattern, path) =>
  new RegExp(
    "^" +
      pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  ).test(path);
const invokes = (config, path) =>
  config.include.some((pattern) => matches(pattern, path)) &&
  !config.exclude.some((pattern) => matches(pattern, path));

const staticApiShells = [
  ...readdirSync(new URL("../../api/", import.meta.url)),
  ...readdirSync(new URL("../../public/api/", import.meta.url)),
]
  .filter((file) => file.endsWith(".html"))
  .map((file) => "/api/" + file.replace(/\.html$/, ""));

test("public assets and application shells bypass Pages Functions", () => {
  const config = routes();
  assert.equal(config.version, 1);
  for (const path of [
    "/",
    "/index.html",
    "/assets/app.js",
    "/fonts/manrope-400.ttf",
    "/sw.js",
    "/notification-sw.js",
    "/manifest.webmanifest",
    "/release.json",
    "/welcome/capture.webp",
    "/privacy",
    "/privacy.html",
    "/client/",
    "/coordination/",
    ...staticApiShells.flatMap((path) => [path, path + "/", path + ".html"]),
  ])
    assert.equal(invokes(config, path), false, path);
});

test("every dynamic server entry point retains Functions routing including trailing slashes", () => {
  const config = routes();
  const files = readdirSync(new URL("../../functions/", import.meta.url), {
    recursive: true,
  });
  for (const file of files.filter(
    (name) =>
      name.endsWith(".js") &&
      !name.endsWith(".test.js") &&
      !name.includes("_middleware"),
  )) {
    const path = "/" + file.replace(/\.js$/, "").replace(/\/\[\[path\]\]$/, "");
    for (const suffix of [
      ...(staticApiShells.includes(path) ? [] : ["", "/"]),
      ...(file.includes("[[path]]") ? ["/synthetic/action"] : []),
    ])
      assert.equal(invokes(config, path + suffix), true, file + suffix);
  }
  assert.equal(invokes(config, "/api/new-endpoint"), true);
  for (const path of [
    "/api/purchase/status",
    "/extension.html",
    "/mcp/tools/list",
    "/mcp-extension/resources/read",
    "/api/purchase/checkout",
    "/api/purchase/webhook",
    "/api/credits/status",
    "/api/credits/checkout",
    "/api/credits/webhook",
    "/api/admin/session",
    "/api/admin/users",
    "/api/admin/overview",
    "/api/admin/authorize",
    "/api/admin/grants",
    "/api/admin/reversals",
    "/api/google/callback",
    "/api/google/session",
    "/api/coordination/provider/jobs",
    "/api/coordination/client/verify",
  ]) {
    assert.equal(invokes(config, path), true, path);
    assert.equal(invokes(config, path + "/"), true, path + "/");
  }
});
