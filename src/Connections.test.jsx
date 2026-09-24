import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://streamlion.transcendencemedia.com/",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});

const { render, act, cleanup } = await import("@testing-library/react");
const { default: Connections } = await import("./Connections.jsx");

test("Connections enables Google actions using the runtime public config", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPath;
  globalThis.fetch = async (path) => {
    requestedPath = path;
    return new Response(
      JSON.stringify({
        clientId: "public-client-id.apps.googleusercontent.com",
        apiKey: "public-picker-key",
        appId: "123456789",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const ui = render(
      <Connections
        onWorkbook={() => {}}
        onDisconnect={() => {}}
        onExport={() => {}}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(requestedPath, "/api/google-config");
    assert.equal(
      ui.getByRole("button", { name: "Connect Google" }).disabled,
      false,
    );
    assert.equal(
      ui.getByRole("button", { name: "Create workbook" }).disabled,
      true,
    );
    assert.equal(
      ui.getByRole("button", { name: "Choose workbook" }).disabled,
      true,
    );
    cleanup();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
