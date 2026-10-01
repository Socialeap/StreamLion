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
    "/mcp?session=synthetic",
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
