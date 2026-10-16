import "fake-indexeddb/auto";
import { enterWorkspace } from "./test-workspace.js";
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
    if (url === "/api/purchase/status")
      return new Response(
        JSON.stringify({ enabled: true, required: false, purchased: false }),
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

test("cold start presents the branded opener, the setup assistant and explicit Google account choices before workspace navigation", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "StreamLion", exact: true });
  await ui.findByRole("link", { name: "Sign in with Google" });
  assert(ui.getByRole("button", { name: "Get started" }));
  assert(ui.getByRole("button", { name: "Continue on this device" }));
  assert.equal(ui.queryByRole("link", { name: "Sign up" }), null);
  assert.equal(ui.queryByRole("navigation", { name: "Main" }), null);
  assert.equal(ui.queryByRole("button", { name: "Create project" }), null);
  assert.equal((await loadWorkspace()).jobs.length, 0);
});

test("the opener remains available before a required purchase and cannot bypass the workspace license gate", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url.startsWith("/api/purchase/"))
      return new Response(
        JSON.stringify({
          enabled: true,
          required: true,
          purchased: false,
          connected: false,
          mode: "test",
          checkoutPaused: true,
          amount: 2996,
        }),
      );
    return original(url, options);
  };
  const ui = render(<App />);
  await ui.findByRole("link", { name: "Sign in with Google" });
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Continue on this device" }).disabled,
      false,
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: "Continue on this device" }));
  await ui.findByRole("heading", { name: "Own your field workspace" });
  assert.equal(
    ui.queryByRole("heading", { name: "Projects", exact: true }),
    null,
  );
});

function restoredWorkbook() {
  session = {
    enabled: true,
    connected: true,
    subject: "synthetic-a",
    account: "qa-a@example.com",
    bookId: "saved-book",
    folderId: "",
  };
  const base = globalThis.fetch,
    reads = [];
  globalThis.fetch = async (url, options = {}) => {
    if (!url.startsWith("/api/google/sheets?")) return base(url, options);
    assert(
      !options.method || options.method === "GET",
      "Opening must never write to Google",
    );
    reads.push(url);
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
  return reads;
}

test("a verified returning account opens Projects in one click without OAuth or a second workbook read", async () => {
  const reads = restoredWorkbook();
  const draftKey = "streamlion-draft-v1:saved-book:note:";
  const draft = '{"area":"Office","text":"Exact 6 7/16 inches"}';
  localStorage.setItem(draftKey, draft);
  const records = {
    version: 1,
    revision: 1,
    jobs: [{ id: "kept", title: "Kept device project" }],
    notes: [],
  };
  await (await openLocalDatabase()).put("workspace", records, "current");
  const ui = render(<App />);
  await ui.findByText("qa-a@example.com");
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Open Projects" }).disabled,
      false,
    ),
  );
  const count = reads.length;
  assert.equal(ui.queryByRole("navigation", { name: "Main" }), null);
  assert.equal(ui.queryByRole("link", { name: "Sign in with Google" }), null);
  await enterWorkspace(ui);
  await ui.findByRole("heading", { name: "Projects", exact: true });
  assert(ui.getByRole("button", { name: "Kept device project", exact: true }));
  assert.equal(reads.length, count);
  assert.equal(localStorage.getItem(draftKey), draft);
  assert.deepEqual(await loadWorkspace(), records);
});

test("the compact profile opens Account without exposing the email on Projects or losing a draft", async () => {
  restoredWorkbook();
  const key = "streamlion-draft-v1:saved-book:note:",
    draft = '{"text":"Keep exact 5 3/8 inches"}';
  localStorage.setItem(key, draft);
  const ui = render(<App />);
  await enterWorkspace(ui);
  await ui.findByRole("heading", { name: "Projects", exact: true });
  assert.equal(ui.queryByText("qa-a@example.com"), null);
  fireEvent.click(
    ui.getByRole("button", { name: /Account: qa-a@example.com/ }),
  );
  await ui.findByRole("heading", { name: "Account", exact: true });
  assert(ui.getByText("qa-a@example.com"));
  assert(ui.getByRole("link", { name: /Google account security/ }));
  assert.equal(localStorage.getItem(key), draft);
});

test("a cross-page Account link opens account settings and Home returns directly to Projects", async () => {
  window.history.replaceState(null, "", "/?page=Account");
  const key = "streamlion-draft-v1:local:note:",
    draft = '{"text":"Keep exact 6 7/16 inches"}';
  localStorage.setItem(key, draft);
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Account", exact: true });
  assert(ui.getByRole("button", { name: /Account: Not signed in/ }));
  const home = await ui.findByRole("button", { name: "Home", exact: true });
  fireEvent.click(home);
  await ui.findByRole("heading", { name: "Projects", exact: true });
  assert(ui.getByRole("navigation", { name: "Main" }));
  assert.equal(
    ui.queryByRole("heading", { name: "StreamLion", exact: true }),
    null,
  );
  assert.equal(localStorage.getItem(key), draft);
});

test("signing out preserves the exact pending operation, workbook selection and device records", async () => {
  restoredWorkbook();
  const key = "streamlion-draft-v1:saved-book:pending-write";
  const draft = '{"revisionId":"same-operation","text":"Exact 5 3/8 inches"}';
  localStorage.setItem(key, draft);
  const records = {
    version: 1,
    revision: 1,
    jobs: [{ id: "kept", title: "Kept device project" }],
    notes: [],
  };
  await (await openLocalDatabase()).put("workspace", records, "current");
  const base = globalThis.fetch,
    writes = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/google/signout") {
      writes.push(url);
      assert.equal(options.method, "POST");
      assert.equal(options.headers["X-StreamLion-Account"], "synthetic-a");
      session = { enabled: true, connected: false };
      return new Response('{"connected":false}');
    }
    return base(url, options);
  };
  const ui = render(<App />);
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Sign out", exact: true }).disabled,
      false,
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: "Sign out", exact: true }));
  await ui.findByRole("link", { name: "Reconnect with Google" });
  assert.equal(ui.queryByText("qa-a@example.com"), null);
  assert.deepEqual(writes, ["/api/google/signout"]);
  assert.equal(localStorage.getItem(key), draft);
  assert.equal(
    localStorage.getItem("streamlion-selected-workbook-v1"),
    "saved-book",
  );
  assert.deepEqual(await loadWorkspace(), records);
});

test("failed sign-out keeps the account and drafts visible and offers a safe retry", async () => {
  restoredWorkbook();
  const key = "streamlion-draft-v1:saved-book:note:",
    draft = '{"text":"Do not lose this"}';
  localStorage.setItem(key, draft);
  const base = globalThis.fetch;
  let fail = true;
  globalThis.fetch = async (url, options) =>
    url === "/api/google/signout"
      ? new Response('{"connected":false}', { status: fail ? 503 : 200 })
      : base(url, options);
  const ui = render(<App />);
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Sign out", exact: true }).disabled,
      false,
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: "Sign out", exact: true }));
  await ui.findByRole("alert");
  assert(ui.getByText("qa-a@example.com"));
  assert.equal(localStorage.getItem(key), draft);
  fail = false;
  fireEvent.click(ui.getByRole("button", { name: "Sign out", exact: true }));
  await ui.findByRole("link", { name: "Reconnect with Google" });
  assert.equal(localStorage.getItem(key), draft);
});

test("a blackholed sign-out times out without replaying and re-enables a safe manual retry", async (t) => {
  restoredWorkbook();
  const key = "streamlion-draft-v1:saved-book:pending-write",
    draft = '{"revisionId":"keep-this-operation","text":"Exact 5 3/8 inches"}';
  localStorage.setItem(key, draft);
  const records = {
    version: 1,
    revision: 1,
    jobs: [{ id: "kept", title: "Kept device project" }],
    notes: [],
  };
  await (await openLocalDatabase()).put("workspace", records, "current");
  const base = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = (url, options = {}) => {
    if (url !== "/api/google/signout") return base(url, options);
    writes++;
    assert.equal(options.method, "POST");
    if (writes > 1) return Promise.resolve(new Response('{"connected":false}'));
    // Simulate a transport that never responds but honors request cancellation.
    return new Promise((resolve, reject) =>
      options.signal?.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true },
      ),
    );
  };
  const ui = render(<App />);
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Sign out", exact: true }).disabled,
      false,
    ),
  );
  const timeout = new AbortController();
  t.mock.method(AbortSignal, "timeout", (ms) => {
    assert(ms > 0 && ms <= 20000, "sign-out must have a bounded deadline");
    return timeout.signal;
  });
  fireEvent.click(ui.getByRole("button", { name: "Sign out", exact: true }));
  assert(ui.getByRole("button", { name: "Signing out…" }).disabled);
  await act(async () =>
    timeout.abort(new DOMException("Request timed out", "TimeoutError")),
  );
  await ui.findByRole("alert");
  const retry = ui.getByRole("button", { name: "Sign out", exact: true });
  assert.equal(retry.disabled, false);
  assert(ui.getByText("qa-a@example.com"));
  assert.equal(writes, 1, "a timed-out POST must not replay automatically");
  assert.equal(localStorage.getItem(key), draft);
  assert.equal(
    localStorage.getItem("streamlion-selected-workbook-v1"),
    "saved-book",
  );
  assert.deepEqual(await loadWorkspace(), records);
  t.mock.restoreAll();
  fireEvent.click(retry);
  await ui.findByRole("link", { name: "Reconnect with Google" });
  assert.equal(writes, 2, "only the explicit manual retry sends another POST");
  assert.equal(localStorage.getItem(key), draft);
  assert.deepEqual(await loadWorkspace(), records);
});

test("a new visitor chooses Google setup or explicit device-only use before creating work", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "StreamLion", exact: true });
  assert.equal(ui.queryByRole("button", { name: "Create project" }), null);
  await enterWorkspace(ui);
  await ui.findByRole("heading", { name: "Projects" });
  assert(ui.getByText(/Device only/));
  cleanup();
  const reopened = render(<App />);
  await enterWorkspace(reopened);
  await reopened.findByRole("heading", { name: "Projects" });
  assert.equal(
    reopened.queryByRole("heading", { name: "Set up StreamLion" }),
    null,
  );
});
test("Google setup explains sign-in and workbook selection without starting OAuth on page load", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "StreamLion", exact: true });
  const signIn = await ui.findByRole("link", { name: "Sign in with Google" });
  assert.equal(signIn.getAttribute("href"), "/api/google/start");
  assert(ui.getByRole("button", { name: "Get started" }));
  await enterWorkspace(ui);
  fireEvent.click(ui.getByRole("button", { name: /Account: Not signed in/ }));
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
  await enterWorkspace(ui);
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
  await enterWorkspace(ui);
  await ui.findByRole("heading", { name: "Projects" });
  fireEvent.click(ui.getByRole("button", { name: "Create project" }));
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Unsaved exact 5 3/8 inches" },
  });
  fireEvent.click(ui.getByRole("button", { name: /Account: Not signed in/ }));
  await ui.findByRole("heading", { name: "Connections" });
  fireEvent.click(ui.getByRole("button", { name: "Home", exact: true }));
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
  await enterWorkspace(ui);
  await ui.findByRole("button", { name: /Account: qa-a@example.com/ });
  assert(ui.getByRole("heading", { name: "Connections" }));
  assert(
    ui.getByRole("button", {
      name: /Account: qa-a@example.com.*Choose a workbook/,
    }),
  );
  cleanup();
  disconnectGoogle();
  session = { ...session, subject: "synthetic-b", account: "qa-b@example.com" };
  const other = render(<App />);
  await enterWorkspace(other);
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
  await enterWorkspace(ui);
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
  await enterWorkspace(ui);
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
  await enterWorkspace(ui);
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
  await ui.findByRole("link", { name: "Sign in with Google" });
});
test("successful workbook refresh clears a previous connection-check failure", async () => {
  session = {
    enabled: true,
    connected: true,
    subject: "synthetic-a",
    account: "qa-a@example.com",
    bookId: "saved-book",
    folderId: "",
  };
  const fetcher = globalThis.fetch;
  let unavailableWorkbook = true;
  globalThis.fetch = async (url, options) => {
    if (!url.startsWith("/api/google/sheets?")) return fetcher(url, options);
    if (unavailableWorkbook) return new Response("{}", { status: 400 });
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
  await enterWorkspace(ui);
  fireEvent.click(
    await ui.findByRole("button", { name: /Account: Connection unavailable/ }),
  );
  await ui.findByRole("heading", { name: "Connections" });
  unavailableWorkbook = false;
  fireEvent.click(ui.getByRole("button", { name: "Refresh from Google" }));
  await ui.findByRole("button", {
    name: /Account: qa-a@example.com. Google workbook connected/,
  });
  assert.equal(
    ui.queryByRole("button", { name: /Retry saved connection/ }),
    null,
  );
});
test("install guidance is available without an install event and never claims installation", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "StreamLion", exact: true });
  await enterWorkspace(ui);
  fireEvent.click(ui.getByRole("button", { name: /Account: Not signed in/ }));
  await ui.findByRole("heading", { name: "Account", exact: true });
  fireEvent.click(ui.getByText("Install app", { exact: true }));
  assert(ui.getByText(/Chrome on Android/));
  assert(ui.getByText(/Use a regular browser window/));
  assert.equal(ui.queryByRole("button", { name: "Install StreamLion" }), null);
});
test("eligible install prompts require a click, handle dismissal and hide after installation", async () => {
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "StreamLion", exact: true });
  await enterWorkspace(ui);
  fireEvent.click(ui.getByRole("button", { name: /Account: Not signed in/ }));
  await ui.findByRole("heading", { name: "Account", exact: true });
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
