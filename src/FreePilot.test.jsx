import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<html><body></body></html>", {
  url: "https://app.example/pilot/",
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
const { render, fireEvent, cleanup, waitFor } =
  await import("@testing-library/react");
const { default: FreePilot } = await import("./FreePilot.jsx");
const status = {
  enabled: true,
  connected: true,
  account: "provider@example.com",
  subject: "provider",
  state: "none",
  interestOpen: true,
  applicationsOpen: false,
  durationDays: 14,
};
const response = (v) => new Response(JSON.stringify(v));
test("full capacity shows interest registration, separate unchecked consents and no immediate access", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      calls.push(JSON.parse(options.body));
      return response({ registered: true });
    }
    return response(calls.length ? { ...status, state: "applied" } : status);
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  await ui.findByRole("heading", { name: "Join the interest list" });
  assert.match(
    ui.getByText(/Immediate pilot admission/).textContent,
    /no.*promise|does not promise/,
  );
  const [contact, marketing] = ui.getAllByRole("checkbox");
  assert.equal(contact.checked, false);
  assert.equal(marketing.checked, false);
  fireEvent.change(ui.getByLabelText("Your name"), {
    target: { value: "Provider" },
  });
  fireEvent.change(ui.getByLabelText(/How would you test/), {
    target: { value: "Prepare a real capture job" },
  });
  fireEvent.click(contact);
  fireEvent.click(ui.getByRole("button", { name: "Register interest" }));
  await ui.findByText(/Your interest is recorded/);
  assert.equal(calls[0].contact, true);
  assert.equal(calls[0].marketing, false);
  assert.equal(ui.queryByRole("button", { name: "Activate my pilot" }), null);
});
test("invited participant must confirm terms before activation; expiry uses UTC and retrieval remains visible", async (t) => {
  let active = false;
  const ends = Date.now() + 86400000;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      calls.push(JSON.parse(options.body));
      active = true;
      return response({ active: true });
    }
    return response({
      ...status,
      state: active ? "active" : "invited",
      active,
      inviteUntil: Date.now() + 3600000,
      invitedDurationDays: 14,
      startsAt: active ? Date.now() - 1 : null,
      endsAt: active ? ends : null,
    });
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  const button = await ui.findByRole("button", { name: "Activate my pilot" });
  assert(button.disabled);
  fireEvent.click(ui.getByRole("checkbox"));
  fireEvent.click(button);
  await ui.findByRole("link", { name: "Open workspace" });
  assert.equal(calls[0].terms, "free-pilot-v1");
  assert.match(ui.getByText(/Started:/).textContent, /UTC/);
  assert(ui.getByRole("link", { name: "Retrieve your Google-owned files" }));
});
test("disabled pilot presents no form or trial duration promise", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response({ enabled: false }));
  t.after(cleanup);
  const ui = render(<FreePilot />);
  await ui.findByText("Pilot registration is not open.");
  assert.equal(ui.queryByRole("checkbox"), null);
  assert.equal(ui.queryByRole("button", { name: "Register interest" }), null);
});

test("an open participant page removes stale active access at its original expiry without a reload", async (t) => {
  const end = Date.now() + 5000;
  let expire = null;
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => {
    if (delay > 3000 && delay <= 5000) expire = fn;
    return realTimeout(fn, delay, ...args);
  });
  t.mock.method(globalThis, "fetch", async () =>
    response({
      ...status,
      state: "active",
      active: true,
      startsAt: Date.now() - 1000,
      endsAt: end,
    }),
  );
  t.after(cleanup);
  const ui = render(<FreePilot />);
  await ui.findByRole("link", { name: "Open workspace" });
  await waitFor(() => assert.equal(typeof expire, "function"));
  await (await import("@testing-library/react")).act(async () => expire());
  await ui.findByText(/Active pilot access has ended/);
  assert.equal(ui.queryByRole("link", { name: "Open workspace" }), null);
});
