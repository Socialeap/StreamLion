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

test("available instant pilot requires provider, contact, readiness and v2 terms and prefills prior interest", async (t) => {
  const posts = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      posts.push({ url, body: JSON.parse(options.body) });
      return response({ active: true });
    }
    return response({
      ...status,
      admissionMode: "instant",
      availability: "available",
      state: posts.length ? "active" : "applied",
      active: !!posts.length,
      application: {
        name: "Prior Provider",
        business: "Capture",
        fit: "Test handover",
        contact: true,
        marketing: false,
      },
      ...(posts.length
        ? { startsAt: Date.now() - 1, endsAt: Date.now() + 86400000 }
        : {}),
    });
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  const start = await ui.findByRole("button", { name: "Start my free pilot" });
  assert(start.disabled);
  assert.equal(ui.getByLabelText("Your name").value, "Prior Provider");
  fireEvent.click(ui.getByLabelText(/I am a professional/));
  fireEvent.click(ui.getByLabelText(/I am ready to test/));
  assert(start.disabled);
  fireEvent.click(ui.getByLabelText(/free-pilot-v2/));
  fireEvent.click(start);
  await ui.findByRole("link", { name: "Open workspace" });
  assert.match(posts[0].url, /\/start$/);
  assert.deepEqual(posts[0].body, {
    name: "Prior Provider",
    business: "Capture",
    fit: "Test handover",
    contact: true,
    marketing: false,
    provider: true,
    ready: true,
    terms: "free-pilot-v2",
    durationDays: 14,
  });
});

test("last-slot race reloads status and acknowledges saved interest without access", async (t) => {
  let attempted = false;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      attempted = true;
      return new Response(
        JSON.stringify({
          code: "pilot_full",
          registered: true,
          error: "The last place was taken.",
        }),
        { status: 409 },
      );
    }
    return response({
      ...status,
      admissionMode: "instant",
      availability: attempted ? "full" : "available",
      state: attempted ? "applied" : "none",
      application: attempted
        ? { name: "Provider", fit: "Test", contact: true, marketing: false }
        : null,
    });
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  await ui.findByRole("button", { name: "Start my free pilot" });
  fireEvent.change(ui.getByLabelText("Your name"), {
    target: { value: "Provider" },
  });
  fireEvent.change(ui.getByLabelText(/How would you test/), {
    target: { value: "Test" },
  });
  for (const box of ui.getAllByRole("checkbox"))
    if (box.required) fireEvent.click(box);
  fireEvent.click(ui.getByRole("button", { name: "Start my free pilot" }));
  await ui.findByText(/Your interest is saved/);
  assert.equal(ui.queryByRole("button", { name: "Start my free pilot" }), null);
  assert.equal(ui.queryByRole("link", { name: "Open workspace" }), null);
});

test("manual and closed instant states offer interest only; previously admitted cannot restart", async (t) => {
  t.after(cleanup);
  for (const extra of [
    { admissionMode: "manual", availability: "available" },
    { admissionMode: "instant", availability: "closed" },
    { admissionMode: "instant", availability: "full" },
  ]) {
    t.mock.method(globalThis, "fetch", async () =>
      response({ ...status, ...extra }),
    );
    const ui = render(<FreePilot />);
    await ui.findByRole("button", { name: "Register interest" });
    assert.equal(
      ui.queryByRole("button", { name: "Start my free pilot" }),
      null,
    );
    cleanup();
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () =>
    response({
      ...status,
      admissionMode: "instant",
      availability: "available",
      state: "expired",
      startsAt: Date.now() - 100000,
      endsAt: Date.now() - 1,
    }),
  );
  const ui = render(<FreePilot />);
  await ui.findByText(/Active pilot access has ended/);
  assert.equal(ui.queryByRole("button", { name: "Start my free pilot" }), null);
});

test("failed response after successful start recovers the durable active grant", async (t) => {
  let attempted = false;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      attempted = true;
      throw new Error("Response interrupted");
    }
    return response({
      ...status,
      admissionMode: "instant",
      availability: "available",
      state: attempted ? "active" : "applied",
      active: attempted,
      application: { name: "Provider", fit: "Test", contact: true },
      ...(attempted
        ? { startsAt: Date.now() - 1, endsAt: Date.now() + 86400000 }
        : {}),
    });
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  await ui.findByRole("button", { name: "Start my free pilot" });
  for (const box of ui.getAllByRole("checkbox"))
    if (box.required && !box.checked) fireEvent.click(box);
  fireEvent.click(ui.getByRole("button", { name: "Start my free pilot" }));
  await ui.findByRole("link", { name: "Open workspace" });
  assert.equal(ui.queryByText(/No pilot access has started/), null);
  assert.equal(ui.queryByRole("button", { name: "Start my free pilot" }), null);
});

test("stale admin settings show server error and refresh policy before retry", async (t) => {
  let revision = 3;
  const calls = [];
  const now = Date.now();
  const policy = {
    revision,
    active_cap: 5,
    admission_cap: 5,
    duration_days: 7,
    admission_mode: "manual",
    application_start: now - 86400000,
    application_end: now + 20 * 86400000,
    closes_at: now + 30 * 86400000,
    interest_open: 0,
    admissions_open: 0,
  };
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      calls.push(JSON.parse(options.body));
      revision = 4;
      return new Response(
        JSON.stringify({
          error: "Policy changed. Refresh and try again.",
          code: "stale_revision",
        }),
        { status: 409 },
      );
    }
    if (url.includes("admin/list"))
      return response({
        controlsAvailable: true,
        policy: { ...policy, revision, active_cap: revision === 4 ? 3 : 5 },
        counts: {},
        accounts: [],
        nextOffset: null,
      });
    return response({ ...status, admin: true, interestOpen: false });
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  fireEvent.click(
    await ui.findByRole("button", { name: "Review applications" }),
  );
  await ui.findByLabelText("Maximum active places");
  fireEvent.change(ui.getByLabelText("Policy note (optional)"), {
    target: { value: "Set opening policy" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save pilot settings" }));
  await ui.findByRole("alert");
  await waitFor(() =>
    assert.equal(ui.getByLabelText("Maximum active places").value, "3"),
  );
  assert.equal(calls[0].revision, 3);
  assert.match(ui.getByRole("alert").textContent, /Policy changed/);
});

test("account switch resets profile and consents and ignores an old account mutation response", async (t) => {
  let account = "A";
  let finishStart;
  let posted;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      posted = { headers: options.headers, body: JSON.parse(options.body) };
      return await new Promise((resolve) => {
        finishStart = () => resolve(response({ active: true }));
      });
    }
    return response({
      ...status,
      subject: account,
      account: account + "@example.com",
      admissionMode: "instant",
      availability: "available",
      application: {
        name: account + " Provider",
        business: account,
        fit: "Test " + account,
        contact: false,
        marketing: false,
      },
    });
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  await ui.findByRole("button", { name: "Start my free pilot" });
  for (const box of ui.getAllByRole("checkbox")) fireEvent.click(box);
  fireEvent.click(ui.getByRole("button", { name: "Start my free pilot" }));
  await waitFor(() => assert.equal(typeof finishStart, "function"));
  assert.equal(posted.headers["X-StreamLion-Account"], "A");
  account = "B";
  await (
    await import("@testing-library/react")
  ).act(async () => {
    fireEvent(window, new window.Event("focus"));
  });
  await waitFor(() =>
    assert.equal(ui.getByLabelText("Your name").value, "B Provider"),
  );
  for (const box of ui.getAllByRole("checkbox"))
    assert.equal(box.checked, false);
  assert(ui.getByRole("button", { name: "Start my free pilot" }).disabled);
  await (await import("@testing-library/react")).act(async () => finishStart());
  assert.equal(ui.queryByText(/Pilot activated/), null);
  assert.equal(ui.getByLabelText("Your name").value, "B Provider");
  fireEvent.change(ui.getByLabelText("Your name"), {
    target: { value: "B edited" },
  });
  await (
    await import("@testing-library/react")
  ).act(async () => {
    fireEvent(window, new window.Event("focus"));
  });
  assert.equal(ui.getByLabelText("Your name").value, "B edited");
});

test("account switch discards previous feedback and admin list state", async (t) => {
  let account = "A";
  let listCalls = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.includes("admin/list")) {
      listCalls++;
      return response({
        policy: { active_cap: 5, admission_cap: 5 },
        counts: { applications: 42 },
        accounts: [],
        nextOffset: null,
      });
    }
    return response({
      ...status,
      subject: account,
      account: account + "@example.com",
      state: "active",
      active: true,
      admin: true,
      startsAt: Date.now() - 1000,
      endsAt: Date.now() + 86400000,
      feedback: {
        onboarding: account === "A",
        workflow: false,
        feedback: account + " notes",
        support: "",
        willingness: "unanswered",
      },
    });
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  fireEvent.click(
    await ui.findByRole("button", { name: "Review applications" }),
  );
  await ui.findByText(/Applications: 42/);
  assert.equal(ui.getByLabelText("Feedback").value, "A notes");
  fireEvent.change(ui.getByLabelText("Feedback"), {
    target: { value: "Unsaved A notes" },
  });
  account = "B";
  await (
    await import("@testing-library/react")
  ).act(async () => {
    fireEvent(window, new window.Event("focus"));
  });
  assert.equal(ui.getByLabelText("Feedback").value, "B notes");
  assert.equal(ui.getByLabelText("I completed onboarding.").checked, false);
  assert.equal(ui.queryByText(/Applications: 42/), null);
  assert.equal(listCalls, 1);
});

test("changed duration requires renewed readiness and terms and start submits displayed duration", async (t) => {
  let days = 14;
  let posted;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      posted = JSON.parse(options.body);
      return response({ registered: true });
    }
    return response({
      ...status,
      admissionMode: "instant",
      availability: "available",
      durationDays: days,
      application: {
        name: "Provider",
        fit: "Test a job",
        contact: true,
        marketing: false,
      },
    });
  });
  t.after(cleanup);
  const ui = render(<FreePilot />);
  await ui.findByRole("button", { name: "Start my free pilot" });
  fireEvent.click(ui.getByLabelText(/I am a professional/));
  fireEvent.click(ui.getByLabelText(/I am ready to test/));
  fireEvent.click(ui.getByLabelText(/free-pilot-v2/));
  assert.equal(
    ui.getByRole("button", { name: "Start my free pilot" }).disabled,
    false,
  );
  fireEvent.change(ui.getByLabelText("Your name"), {
    target: { value: "Edited Provider" },
  });
  days = 7;
  await (
    await import("@testing-library/react")
  ).act(async () => {
    fireEvent(window, new window.Event("focus"));
  });
  assert.match(ui.getByText(/Your 7-day pilot/).textContent, /7-day/);
  assert.equal(ui.getByLabelText(/I am ready to test/).checked, false);
  assert.equal(ui.getByLabelText(/free-pilot-v2/).checked, false);
  assert.equal(ui.getByLabelText(/I am a professional/).checked, true);
  assert.equal(ui.getByLabelText(/Contact me about/).checked, true);
  assert.equal(ui.getByLabelText("Your name").value, "Edited Provider");
  assert.equal(
    ui.getByRole("button", { name: "Start my free pilot" }).disabled,
    true,
  );
  fireEvent.click(ui.getByLabelText(/I am ready to test/));
  fireEvent.click(ui.getByLabelText(/free-pilot-v2/));
  fireEvent.click(ui.getByRole("button", { name: "Start my free pilot" }));
  await waitFor(() => assert.equal(posted?.durationDays, 7));
});
