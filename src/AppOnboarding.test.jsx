import "fake-indexeddb/auto";
import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
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
const { render, fireEvent, cleanup, waitFor, act } =
  await import("@testing-library/react");
const { default: App } = await import("./App.jsx");
const { openLocalDatabase, loadWorkspace } = await import("./storage.js");
const { disconnectGoogle } = await import("./google.js");
const { TABS } = await import("./workbook.js");
const originalFetch = globalThis.fetch;
let session,
  unavailable = false;
test.beforeEach(async () => {
  cleanup();
  disconnectGoogle();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  const db = await openLocalDatabase();
  await db.clear("workspace");
  await db.clear("audio");
  session = { enabled: true, connected: false };
  unavailable = false;
  globalThis.fetch = async (url, options = {}) => {
    assert(
      !options.method || options.method === "GET",
      "Onboarding must not write or start authentication automatically",
    );
    if (url === "/api/google/session")
      return new Response(JSON.stringify(session), {
        status: unavailable ? 400 : 200,
      });
    if (url === "/api/google-config")
      return new Response(
        JSON.stringify({
          clientId: "test.apps.googleusercontent.com",
          apiKey: "public-test",
          appId: "123",
          persistentEnabled: true,
        }),
      );
    throw Error("Unexpected external request: " + url);
  };
});
test.after(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  dom.window.close();
});

test("a new visitor chooses Google setup or explicit device-only use before creating work", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Set up StreamLion" });
  assert(ui.getByRole("button", { name: /Account: Not signed in/ }));
  assert.equal(ui.queryByRole("button", { name: "Create project" }), null);
  fireEvent.click(ui.getByRole("button", { name: "Continue on this device" }));
  await ui.findByRole("heading", { name: "Projects" });
  assert(ui.getByText(/Device only/));
  cleanup();
  const reopened = render(<App />);
  await reopened.findByRole("heading", { name: "Projects" });
  assert.equal(
    reopened.queryByRole("heading", { name: "Set up StreamLion" }),
    null,
  );
});
test("Google setup explains sign-in and workbook selection without starting OAuth on page load", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Set up StreamLion" });
  fireEvent.click(ui.getByRole("button", { name: "Set up with Google" }));
  await ui.findByRole("heading", { name: "Connections" });
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Connect Google" }).disabled,
      false,
    ),
  );
  assert(ui.getByText(/Sign in with the Google account/));
  assert.equal((await loadWorkspace()).jobs.length, 0);
});
test("an unassigned draft bypasses first-run setup and remains exact after account navigation", async () => {
  const key = "streamlion-draft-v1:local:note:";
  const value = JSON.stringify({ area: "QA", text: "Exact 6 7/16 inches" });
  localStorage.setItem(key, value);
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Projects" });
  assert.equal(ui.queryByRole("heading", { name: "Set up StreamLion" }), null);
  fireEvent.click(ui.getByRole("button", { name: /Account: Not signed in/ }));
  await ui.findByRole("heading", { name: "Connections" });
  assert.equal(localStorage.getItem(key), value);
});
test("returning device records and unfinished project fields survive opening Account", async () => {
  const db = await openLocalDatabase();
  await db.put(
    "workspace",
    {
      version: 1,
      revision: 1,
      jobs: [{ id: "qa", title: "Saved QA" }],
      notes: [],
    },
    "current",
  );
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Projects" });
  fireEvent.click(ui.getByRole("button", { name: "Create project" }));
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Unsaved exact 5 3/8 inches" },
  });
  fireEvent.click(ui.getByRole("button", { name: /Account: Not signed in/ }));
  await ui.findByRole("heading", { name: "Connections" });
  fireEvent.click(ui.getByRole("button", { name: "Projects", exact: true }));
  fireEvent.click(
    ui.getByRole("button", { name: "Unsaved exact 5 3/8 inches", exact: true }),
  );
  assert.equal(
    ui.getByLabelText("Project name").value,
    "Unsaved exact 5 3/8 inches",
  );
  assert.equal((await loadWorkspace()).jobs[0].title, "Saved QA");
});
test("a connected account is visible globally while workbook setup is unfinished", async () => {
  session = {
    enabled: true,
    connected: true,
    subject: "synthetic-a",
    account: "qa-a@example.com",
    bookId: "",
    folderId: "",
  };
  const ui = render(<App />);
  await ui.findByRole("button", { name: /Account: qa-a@example.com/ });
  assert(ui.getByRole("heading", { name: "Connections" }));
  assert(ui.getByText(/Choose a workbook/));
  cleanup();
  disconnectGoogle();
  session = { ...session, subject: "synthetic-b", account: "qa-b@example.com" };
  const other = render(<App />);
  await other.findByRole("button", { name: /Account: qa-b@example.com/ });
  assert.equal(
    other.queryByRole("button", { name: /Account: qa-a@example.com/ }),
    null,
  );
});
test("failed session restoration is visibly unverified and leaves the remembered workbook and draft intact", async () => {
  unavailable = true;
  localStorage.setItem("streamlion-selected-workbook-v1", "saved-book");
  const key = "streamlion-draft-v1:saved-book:pending-write";
  localStorage.setItem(key, '{"original":"operation"}');
  const ui = render(<App />);
  await ui.findByRole("button", { name: /Account: Connection unavailable/ });
  assert.equal(ui.queryByRole("heading", { name: "Set up StreamLion" }), null);
  assert.equal(
    localStorage.getItem("streamlion-selected-workbook-v1"),
    "saved-book",
  );
  assert.equal(localStorage.getItem(key), '{"original":"operation"}');
});
test("cancelled consent stays in Connections with retry guidance and no forced sign-in", async () => {
  window.history.replaceState(null, "", "/?google=cancelled");
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Connections" });
  assert(ui.getByRole("alert"));
  assert.equal(ui.queryByRole("heading", { name: "Set up StreamLion" }), null);
});
test("a remembered workbook with no session offers reconnect rather than first-run setup", async () => {
  localStorage.setItem("streamlion-selected-workbook-v1", "saved-book");
  const ui = render(<App />);
  await ui.findByRole("button", { name: /Account: Reconnect Google/ });
  assert.equal(ui.queryByRole("heading", { name: "Set up StreamLion" }), null);
  assert.equal(
    localStorage.getItem("streamlion-selected-workbook-v1"),
    "saved-book",
  );
});
test("an expired Google-backed refresh updates the global identity without removing a draft", async () => {
  session = {
    enabled: true,
    connected: true,
    subject: "synthetic-a",
    account: "qa-a@example.com",
    bookId: "saved-book",
    folderId: "",
  };
  const draftKey = "streamlion-draft-v1:saved-book:note:";
  const draft = '{"area":"QA","text":"Exact 5 3/8 inches"}';
  localStorage.setItem(draftKey, draft);
  const fetcher = globalThis.fetch;
  let expired = false;
  globalThis.fetch = async (url, options) => {
    if (!url.startsWith("/api/google/sheets?")) return fetcher(url, options);
    if (expired) return new Response("{}", { status: 401 });
    const path = new URL(url, "https://app.example").searchParams.get("path");
    return new Response(
      JSON.stringify(
        path.includes("batchGet")
          ? {
              valueRanges: Object.values(TABS).map((headers) => ({
                values: [headers],
              })),
            }
          : {
              sheets: Object.keys(TABS).map((title) => ({
                properties: { title, gridProperties: { rowCount: 20 } },
              })),
            },
      ),
    );
  };
  const ui = render(<App />);
  await ui.findByRole("button", {
    name: /Account: qa-a@example.com. Google workbook connected/,
  });
  fireEvent.click(
    ui.getByRole("button", { name: /Account: qa-a@example.com/ }),
  );
  await ui.findByRole("button", { name: "Continue to projects" });
  expired = true;
  fireEvent.click(ui.getByRole("button", { name: "Refresh from Google" }));
  await ui.findByRole("button", { name: /Account: Reconnect Google/ });
  assert.equal(localStorage.getItem(draftKey), draft);
  assert.equal(
    localStorage.getItem("streamlion-selected-workbook-v1"),
    "saved-book",
  );
});
test("a pending session check cannot flash new-user setup or a signed-out identity", async () => {
  const fetcher = globalThis.fetch;
  let resolve;
  globalThis.fetch = (url, options) =>
    url === "/api/google/session"
      ? new Promise((done) => {
          resolve = done;
        })
      : fetcher(url, options);
  const ui = render(<App />);
  await ui.findByText("Checking your saved connection…");
  assert.equal(ui.queryByRole("heading", { name: "Set up StreamLion" }), null);
  assert.equal(
    ui.queryByRole("button", { name: /Account: Not signed in/ }),
    null,
  );
  await act(() =>
    resolve(new Response(JSON.stringify({ enabled: true, connected: false }))),
  );
  await ui.findByRole("heading", { name: "Set up StreamLion" });
});
test("install guidance is available without an install event and never claims installation", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Set up StreamLion" });
  fireEvent.click(ui.getByText("Install app", { exact: true }));
  assert(ui.getByText(/Chrome on Android/));
  assert(ui.getByText(/Use a regular browser window/));
  assert.equal(ui.queryByRole("button", { name: "Install StreamLion" }), null);
});
test("eligible install prompts require a click, handle dismissal and hide after installation", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Set up StreamLion" });
  let prompted = 0;
  const event = new window.Event("beforeinstallprompt", { cancelable: true });
  event.prompt = async () => {
    prompted++;
  };
  event.userChoice = Promise.resolve({ outcome: "dismissed" });
  await act(() => window.dispatchEvent(event));
  assert.equal(prompted, 0);
  fireEvent.click(ui.getByText("Install app", { exact: true }));
  fireEvent.click(ui.getByRole("button", { name: "Install StreamLion" }));
  await waitFor(() => assert(ui.getByText(/Installation dismissed/)));
  assert.equal(prompted, 1);
  assert.equal(ui.queryByRole("button", { name: "Install StreamLion" }), null);
  const accepted = new window.Event("beforeinstallprompt", {
    cancelable: true,
  });
  accepted.prompt = async () => {
    prompted++;
  };
  accepted.userChoice = Promise.resolve({ outcome: "accepted" });
  await act(() => window.dispatchEvent(accepted));
  fireEvent.click(ui.getByRole("button", { name: "Install StreamLion" }));
  await ui.findByText(/Installation requested/);
  assert.equal(prompted, 2);
  assert(ui.getByText("Install app", { exact: true }));
  const failed = new window.Event("beforeinstallprompt", { cancelable: true });
  failed.prompt = async () => {
    throw Error("browser unavailable");
  };
  failed.userChoice = Promise.resolve({ outcome: "dismissed" });
  await act(() => window.dispatchEvent(failed));
  fireEvent.click(ui.getByRole("button", { name: "Install StreamLion" }));
  await ui.findByText(/Installation could not start/);
  await act(() => window.dispatchEvent(new window.Event("appinstalled")));
  assert.equal(ui.queryByText("Install app", { exact: true }), null);
});
