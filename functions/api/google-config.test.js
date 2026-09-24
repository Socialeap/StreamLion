import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet } from "./google-config.js";

test("Google config endpoint returns only browser-visible settings without caching", async () => {
  const response = onRequestGet({
    env: {
      VITE_GOOGLE_CLIENT_ID: "public-client-id",
      VITE_GOOGLE_PICKER_API_KEY: "public-picker-key",
      VITE_GOOGLE_PROJECT_NUMBER: "123456789",
      UNRELATED_SECRET: "must-not-be-returned",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), {
    clientId: "public-client-id",
    apiKey: "public-picker-key",
    appId: "123456789",
  });
});

test("Google config endpoint returns empty settings when the owner has not configured them", async () => {
  const response = onRequestGet({ env: {} });
  assert.deepEqual(await response.json(), {
    clientId: "",
    apiKey: "",
    appId: "",
  });
});
