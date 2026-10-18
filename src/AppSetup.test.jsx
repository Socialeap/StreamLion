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
const { render, fireEvent, cleanup, waitFor, within } =
  await import("@testing-library/react");
const { default: App } = await import("./App.jsx");
const { openLocalDatabase } = await import("./storage.js");
const { disconnectGoogle } = await import("./google.js");
const { TABS } = await import("./workbook.js");
const { SETUP_KEY, answerStep, newSetup, readSetup, walk } =
  await import("./setup-assistant.js");
const originalFetch = globalThis.fetch;
let session, remoteSetup;
test.beforeEach(async () => {
  cleanup();
  disconnectGoogle();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  const db = await openLocalDatabase();
  await db.clear("workspace");
  await db.clear("audio");
  session = { enabled: true, connected: false };
  remoteSetup = null;
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/provider-setup") {
      if (options.method === "POST") {
        const state = JSON.parse(options.body).state;
        assert.equal(options.headers["X-StreamLion-Account"], session.subject);
        assert.equal(state.accountSubject, session.subject);
        remoteSetup = state;
      }
      return new Response(
        JSON.stringify({
          available: true,
          subject: session.subject,
          account: session.account,
          state: remoteSetup,
        }),
      );
    }
    assert(
      !options.method || options.method === "GET",
      "Opening setup must not write or start authentication automatically",
    );
    if (url === "/api/purchase/status")
      return new Response(
        JSON.stringify({ enabled: true, required: false, purchased: false }),
      );
    if (url === "/api/google/session")
      return new Response(JSON.stringify(session));
    if (url === "/api/google-config")
      return new Response(
        JSON.stringify({
          clientId: "test.apps.googleusercontent.com",
          apiKey: "public-test",
          appId: "123",
          persistentEnabled: true,
        }),
      );
    if (url.startsWith("/api/google/sheets?")) {
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
    }
    throw Error("Unexpected external request: " + url);
  };
});
test.after(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  dom.window.close();
});
function seed(answers, ctx = { online: true, googleAvailable: true }) {
  let state = newSetup();
  for (const [id, value] of answers) state = answerStep(state, id, value, ctx);
  localStorage.setItem(SETUP_KEY, JSON.stringify(state));
  return state;
}
const intro = [
  ["name", "Alex"],
  ["business", "Harbor Spatial"],
  [
    "contact",
    { email: "alex@harbor.example", phone: "", area: "", website: "" },
  ],
  ["focus", ["handover"]],
  ["hardware", ["matterport-pro3"]],
  ["deliverables", ["space", "schematic"]],
];
async function ready(button) {
  await waitFor(() => assert.equal(button.disabled, false));
  return button;
}

test("a first visit starts the assistant from the opener, and Finish later returns with Continue setup", async () => {
  const ui = render(<App />);
  fireEvent.click(
    await ready(await ui.findByRole("button", { name: "Get started" })),
  );
  await ui.findByRole("heading", { name: "Setup assistant" });
  assert.equal(ui.queryByRole("navigation", { name: "Main" }), null);
  const name = await ui.findByLabelText("What should I call you?");
  fireEvent.change(name, { target: { value: "Alex" } });
  fireEvent.submit(name.closest("form"));
  await ui.findByText(/Nice to meet you, Alex!/);
  fireEvent.click(ui.getByRole("button", { name: "Finish later" }));
  const resume = await ui.findByRole("button", { name: "Continue setup" });
  assert(ui.getByRole("link", { name: "Sign in with Google" }));
  fireEvent.click(await ready(resume));
  await ui.findByText(/Nice to meet you, Alex!/);
  assert(ui.getByLabelText("Business or trade name"));
});

test("returning from Google's sign-in page reopens an unfinished setup at the workbook step", async () => {
  seed([...intro, ["storage", "google"]]);
  session = {
    enabled: true,
    connected: true,
    subject: "synthetic-a",
    account: "qa-a@example.com",
    bookId: "",
    folderId: "",
  };
  window.history.replaceState(null, "", "/?google=connected");
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Setup assistant" });
  fireEvent.click(
    await ui.findByRole("button", {
      name: "Use this device’s setup for this account",
    }),
  );
  await ui.findByText("Signed in as qa-a@example.com");
  assert(await ui.findByRole("button", { name: /^Create a new workbook/ }));
  assert.equal(readSetup().status, "active");
});

test("a restored account's saved workbook completes the Google step without creating another", async () => {
  seed([...intro, ["storage", "google"]]);
  session = {
    enabled: true,
    connected: true,
    subject: "synthetic-a",
    account: "qa-a@example.com",
    bookId: "saved-book",
    folderId: "",
  };
  window.history.replaceState(null, "", "/?google=connected");
  const ui = render(<App />);
  fireEvent.click(
    await ui.findByRole("button", {
      name: "Use this device’s setup for this account",
    }),
  );
  await ui.findByText("Use my saved workbook");
  await ui.findByText(/How would you like to use it/);
});

test("a cancelled Google consent during setup is explained in the assistant", async () => {
  seed([...intro, ["storage", "google"]]);
  window.history.replaceState(null, "", "/?google=cancelled");
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Setup assistant" });
  const card = await ui.findByRole("alert");
  assert.match(card.textContent, /Google/);
  assert(ui.getByRole("button", { name: "Use this device instead" }));
});

test("finished setup prefills new projects, offers usual deliverables and can be rerun from Account", async () => {
  const state = seed([
    ...intro,
    ["storage", "device"],
    ["aiUses", []],
    ["theme", "light"],
    ["review", true],
  ]);
  assert.equal(walk(state).current, null);
  const ui = render(<App />);
  // A finished setup no longer leads with Get started.
  const device = await ui.findByRole("button", {
    name: "Continue on this device",
  });
  assert.equal(ui.queryByRole("button", { name: "Get started" }), null);
  fireEvent.click(await ready(device));
  fireEvent.click(
    (await ui.findAllByRole("button", { name: "Create project" }))[0],
  );
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.click(ui.getByRole("button", { name: "Step 4: Who is involved?" }));
  assert.equal(ui.getByLabelText("Capture provider").value, "Harbor Spatial");
  assert.equal(
    ui.getByLabelText("Provider email").value,
    "alex@harbor.example",
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Step 6: What needs to be captured?" }),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Add my usual deliverables" }),
  );
  assert.equal(
    ui.getByLabelText("Required deliverables / checklist").value,
    "Matterport Space link\nSchematic floor plan",
  );
  fireEvent.click(ui.getByRole("button", { name: /Account: Not signed in/ }));
  await ui.findByRole("heading", { name: "Account", exact: true });
  const setup = ui.getByRole("heading", {
    name: "Setup assistant",
  }).parentElement;
  assert(within(setup).getByText(/Harbor Spatial · alex@harbor.example/));
  fireEvent.click(
    within(setup).getByRole("button", { name: "Review or edit my setup" }),
  );
  await ui.findByText(/Here’s your setup, Alex/);
  assert(ui.getByText(/Your answers are saved/));
  fireEvent.click(ui.getByRole("button", { name: "Finish later" }));
  await ui.findByRole("heading", { name: "Account", exact: true });
});

test("finishing on this device remembers the device choice and opens a new project", async () => {
  seed([...intro, ["storage", "device"], ["aiUses", []], ["theme", "light"]]);
  const ui = render(<App />);
  fireEvent.click(
    await ready(await ui.findByRole("button", { name: "Continue setup" })),
  );
  fireEvent.click(await ui.findByRole("button", { name: "Save & finish" }));
  fireEvent.click(
    await ui.findByRole("button", { name: "Create my first project" }),
  );
  await ui.findByRole("button", { name: "Enter details myself" });
  assert.equal(localStorage.getItem("streamlion-device-setup-v1"), "device");
  assert.equal(readSetup().status, "complete");
});
