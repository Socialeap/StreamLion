import "fake-indexeddb/auto";
import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_HEADERS,
  NOTE_HEADERS,
  makeRevision,
  rowFor,
} from "./workbook.js";
import { validateFields } from "./project-schema.js";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example/",
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
window.scrollTo = () => {};
const { render, fireEvent, waitFor, cleanup } =
  await import("@testing-library/react");
const { default: App } = await import("./App.jsx");
const { disconnectGoogle, restoreGoogleSession } = await import("./google.js");
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
function workbookFetch(paths) {
  const project = makeRevision(
    validateFields({ title: "Automatically restored job", city: "Brooklyn" }),
    null,
    "saved-project",
  );
  return async (url, options = {}) => {
    paths.push(url);
    if (url === "/api/google/session")
      return json({
        enabled: true,
        connected: true,
        subject: "account-a",
        account: "provider@example.com",
        bookId: "server-book",
      });
    if (url === "/api/google-config")
      return json({
        clientId: "test.apps.googleusercontent.com",
        apiKey: "picker",
        appId: "123",
        persistentEnabled: true,
      });
    assert.equal(options.headers["X-StreamLion-Account"], "account-a");
    const path = new URL(url, "https://app.example").searchParams.get("path");
    if (path.includes("values:batchGet"))
      return json({
        valueRanges: [
          { values: [PROJECT_HEADERS, rowFor(project, PROJECT_HEADERS)] },
          { values: [NOTE_HEADERS] },
        ],
      });
    return json({
      sheets: ["Projects", "Observations"].map((title) => ({
        properties: { title, gridProperties: { rowCount: 1000 } },
      })),
    });
  };
}
test("opening the app restores the backend's workbook, overriding an old device-wide destination", async () => {
  const original = globalThis.fetch;
  const paths = [];
  localStorage.setItem(
    "streamlion-selected-workbook-v1",
    "previous-account-book",
  );
  globalThis.fetch = workbookFetch(paths);
  try {
    const ui = render(<App />);
    await ui.findByRole("button", { name: "Automatically restored job" });
    assert.equal(
      localStorage.getItem("streamlion-selected-workbook-v1"),
      "server-book",
    );
    assert.ok(
      paths.some((path) => decodeURIComponent(path).includes("/server-book?")),
    );
    assert.ok(!paths.some((path) => path.includes("previous-account-book")));
    cleanup();
  } finally {
    globalThis.fetch = original;
    disconnectGoogle();
    localStorage.clear();
  }
});
test("a transient startup error can be retried without asking the user to authorize again", async () => {
  const original = globalThis.fetch;
  const paths = [];
  let failed = true;
  const fetchWorkbook = workbookFetch(paths);
  globalThis.fetch = async (url, options) =>
    url === "/api/google/session" && failed
      ? new Response("temporary", { status: 503 })
      : fetchWorkbook(url, options);
  try {
    const ui = render(<App />);
    fireEvent.click(
      await ui.findByRole("button", { name: "Connections", exact: true }),
    );
    await ui.findByRole(
      "button",
      { name: "Retry saved connection" },
      { timeout: 5000 },
    );
    failed = false;
    fireEvent.click(ui.getByRole("button", { name: "Retry saved connection" }));
    await waitFor(() =>
      assert.equal(
        localStorage.getItem("streamlion-selected-workbook-v1"),
        "server-book",
      ),
    );
    fireEvent.click(ui.getByRole("button", { name: "Projects", exact: true }));
    await ui.findByRole("button", { name: "Automatically restored job" });
    cleanup();
  } finally {
    globalThis.fetch = original;
    disconnectGoogle();
    localStorage.clear();
  }
});
test("a remembered Google project reopens after its workbook has been verified", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = workbookFetch([]);
  localStorage.setItem("streamlion-last-project:server-book", "saved-project");
  try {
    const ui = render(<App />);
    await ui.findByRole("heading", { name: "Automatically restored job" });
    cleanup();
  } finally {
    globalThis.fetch = original;
    disconnectGoogle();
    localStorage.clear();
  }
});
test("malformed session responses do not establish an authorized connection", async () => {
  const original = globalThis.fetch;
  try {
    for (const data of [
      null,
      { enabled: true, connected: true },
      { enabled: false, connected: true, subject: "account", bookId: "book" },
    ]) {
      globalThis.fetch = async () => json(data);
      await assert.rejects(restoreGoogleSession(), /invalid connection/);
    }
    globalThis.fetch = async () => new Response("<html>Temporary error</html>");
    await assert.rejects(restoreGoogleSession(), /could not be checked/);
  } finally {
    globalThis.fetch = original;
    disconnectGoogle();
  }
});
test.after(() => dom.window.close());
