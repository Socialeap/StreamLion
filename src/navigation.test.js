import test from "node:test";
import assert from "node:assert/strict";
import { navigationFallbackDenylist } from "../vite.config.js";

test("the installed PWA sends sign-in and policy navigation to their real routes while keeping workspace navigation offline", async () => {
  globalThis.self = { __WB_DISABLE_DEV_LOGS: true };
  const { NavigationRoute } =
    await import("workbox-routing/NavigationRoute.js");
  const route = new NavigationRoute(() => {}, {
    denylist: navigationFallbackDenylist,
  });
  const matches = (path) =>
    route.match({
      url: new URL(path, "https://app.example"),
      request: { mode: "navigate" },
    });
  for (const path of [
    "/api/google/start",
    "/api/google/callback?state=synthetic",
    "/api/health",
    "/client/?job=synthetic",
    "/coordination/",
    "/api/client-portal?job=synthetic",
    "/api/client-requests",
    "/api/welcome",
    "/api/welcome.html",
    "/api/welcome?source=launch",
    "/mcp?session=synthetic",
    "/api/privacy",
    "/api/privacy.html",
    "/api/terms",
    "/api/terms.html",
    "/privacy",
    "/privacy.html",
    "/privacy.html?review=1",
    "/release.json?receipt=1",
    "/welcome.html",
    "/welcome.html?source=launch",
    "/welcome",
    "/welcome?source=launch",
    "/welcome/",
  ])
    assert.equal(matches(path), false, path);
  for (const path of ["/", "/?embedded=1", "/index.html"])
    assert.equal(matches(path), true, path);
});

// Navigation contract shipped before the landing page (main ea002ab).
// Exercise that worker, rather than assuming users already received the new one.
test("the public landing entry bypasses the previously deployed worker on its first visit", async () => {
  globalThis.self = { __WB_DISABLE_DEV_LOGS: true };
  const { NavigationRoute } =
    await import("workbox-routing/NavigationRoute.js");
  const oldRoute = new NavigationRoute(() => {}, {
    denylist: [
      /^\/api(?:[/?]|$)/,
      /^\/mcp(?:[/?]|$)/,
      /^\/privacy\.html(?:\?|$)/,
      /^\/release\.json(?:\?|$)/,
    ],
  });
  const matches = (path) =>
    oldRoute.match({
      url: new URL(path, "https://app.example"),
      request: { mode: "navigate" },
    });
  for (const path of [
    "/api/welcome",
    "/api/welcome.html",
    "/api/welcome?source=launch",
    "/api/welcome.html?source=launch",
    "/api/privacy",
    "/api/privacy.html",
    "/api/terms",
    "/api/terms.html",
  ])
    assert.equal(matches(path), false, path);
  assert.equal(
    matches("/welcome"),
    true,
    "old worker reproduces the reported interception",
  );
  assert.equal(matches("/"), true, "workspace remains available offline");
});
