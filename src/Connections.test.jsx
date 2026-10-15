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

const { render, act, cleanup, fireEvent } =
  await import("@testing-library/react");
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

test("Connections lets the user retry a failed Google config request", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount <= 3) return new Response("unavailable", { status: 503 });
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

    assert.match(
      (await ui.findByRole("alert", {}, { timeout: 5000 })).textContent,
      /Couldn’t load Google connection settings/,
    );
    assert.equal(
      ui.getByRole("button", { name: "Connect Google" }).disabled,
      true,
    );
    assert.equal(ui.queryByText(/Google connection setup is incomplete/), null);

    fireEvent.click(ui.getByRole("button", { name: "Retry" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(requestCount, 4);
    assert.equal(ui.queryByRole("alert"), null);
    assert.equal(
      ui.getByRole("button", { name: "Connect Google" }).disabled,
      false,
    );
    cleanup();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Connections shows folder name, location and exact address; refresh reports restricted parents without losing selection", async (t) => {
  const google = await import("./google.js");
  google.disconnectGoogle();
  let restricted = false;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (url === "/api/google/session")
      return Response.json({
        enabled: true,
        connected: true,
        subject: "folder-owner",
        account: "owner@example.com",
        bookId: "book-a",
        folderId: "folder-a",
      });
    if (url === "/api/google-config")
      return Response.json({
        clientId: "synthetic",
        apiKey: "synthetic",
        appId: "123",
      });
    const path = new URL(
      String(url),
      "https://streamlion.transcendencemedia.com",
    ).searchParams.get("path");
    const id = path?.split("/").pop().split("?")[0];
    const files = {
      "folder-a": {
        id: "folder-a",
        name: "Capture projects",
        parents: ["parent-a"],
      },
      "parent-a": { id: "parent-a", name: "TM", parents: ["my-root"] },
      root: { id: "my-root", name: "My Drive" },
    };
    if (restricted && id !== "folder-a")
      return Response.json({}, { status: 404 });
    return Response.json({
      mimeType: "application/vnd.google-apps.folder",
      ...files[id],
    });
  });
  t.after(() => {
    cleanup();
    google.disconnectGoogle();
  });
  await google.restoreGoogleSession();
  const ui = render(<Connections bookId="book-a" googleConnected />);
  assert.ok(await ui.findByText("Capture projects"));
  assert.ok(ui.getByText("My Drive / TM / Capture projects"));
  assert.ok(
    ui.getByRole("link", {
      name: "https://drive.google.com/drive/folders/folder-a",
    }),
  );
  restricted = true;
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Refresh folder details" })),
  );
  assert.ok(await ui.findByText("Known location (partial)"));
  assert.ok(ui.getByText("Capture projects"));
  assert.equal(google.googleFolderId(), "folder-a");
  assert(calls.every((c) => c.method === "GET"));
});
