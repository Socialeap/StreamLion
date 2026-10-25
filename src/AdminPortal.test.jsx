import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<html><body></body></html>", {
  url: "https://app.example/admin/",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const { render, fireEvent, cleanup } = await import("@testing-library/react");
let Admin;
try {
  Admin = (await import("./AdminPortal.jsx")).default;
} catch {}
const now = Date.now();
const user = {
  subject: "member",
  name: "Jamie Field",
  email: "jamie@example.com",
  business: "Field Studio",
  status: "paid",
  firstKnownAt: now,
  signupAt: null,
  lastActiveAt: now,
  active7: 3,
  active30: 6,
  netPurchasedCredits: 800,
  grantedCredits: 0,
  grantedThisMonth: 0,
  creditsUsed: 240,
  reservedCredits: 0,
  canGrant: true,
  wallet: {
    purchased: 560,
    goodwill: 0,
    starter: 0,
    available: 560,
    hold: false,
  },
};
const session = {
  authorized: true,
  locked: false,
  canAuthorize: true,
  subject: "owner",
  account: "shakoure@transcendencemedia.com",
  mode: "live",
};
const overview = {
  mode: "live",
  registered: 1,
  paid: 1,
  active7: 1,
  active30: 1,
  creditsUsed: 240,
  asOf: now,
  trend: [
    { day: "2026-10-24", active: 1, ai: 0, coordination: 240, speech: 0 },
  ],
  allowance: {
    perGrant: 800,
    perAccountMonth: 800,
    monthly: 4000,
    remaining: 4000,
    grantsEnabled: true,
  },
  coverage: "Known accounts",
  timezone: "America/New_York",
};
const res = (v, status = 200) => new Response(JSON.stringify(v), { status });
function setup(t, options = {}) {
  assert.ok(Admin, "Admin portal component must exist");
  const calls = [];
  let changed = false;
  t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
    if (opts.method === "POST") {
      const b = JSON.parse(opts.body);
      calls.push({ url, b });
      if (url.endsWith("/authorize")) return res({ authorization: "auth" });
      changed = true;
      return res({
        id: "grant:operation",
        amountCredits: 240,
        balanceAfter: 240,
        createdAt: now,
        target: "member",
      });
    }
    if (url.endsWith("/session"))
      return res(options.session || session, options.denied ? 403 : 200);
    if (url.includes("/overview")) return res(overview);
    if (url.includes("/users/member"))
      return res({
        user: { ...user, grantedCredits: changed ? 240 : 0 },
        grants: [],
        purchases: [],
        audit: [],
        allowance: overview.allowance,
        unreconciledLegacyAI: { count: 0 },
      });
    return res({
      users: [user],
      total: 1,
      nextCursor: null,
      mode: "live",
      asOf: now,
    });
  });
  t.after(cleanup);
  return calls;
}
test("owner can inspect account and must review exact credits/recipient/reason before one grant submission", async (t) => {
  const calls = setup(t);
  const ui = render(<Admin />);
  await ui.findAllByText("Jamie Field");
  fireEvent.click(ui.getAllByRole("button", { name: /View Jamie Field/ })[0]);
  await ui.findByRole("heading", { name: "Jamie Field" });
  fireEvent.click(ui.getByRole("button", { name: "Add free credits" }));
  fireEvent.change(ui.getByLabelText("Reason"), {
    target: { value: "Service recovery" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Review change" }));
  await ui.findByText(/Grant 240 credits to jamie@example.com/);
  assert.equal(calls.length, 0);
  fireEvent.click(ui.getByRole("button", { name: "Confirm grant" }));
  await ui.findByText(/Credit change recorded/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].b.credits, 240);
  assert.equal(calls[1].b.target, "member");
  assert.equal(calls[0].b.operationId, calls[1].b.operationId);
});
test("non-owner cannot see user data or mutation forms", async (t) => {
  setup(t, { denied: true, session: { error: "Owner access required." } });
  const ui = render(<Admin />);
  await ui.findByRole("link", { name: "Sign in with Google" });
  assert.equal(ui.queryByText("Jamie Field"), null);
  assert.equal(ui.queryByRole("button", { name: "Add free credits" }), null);
});
test("account access lost during refresh clears private data and leaves a usable sign-in action", async (t) => {
  assert.ok(Admin);
  let denied = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/session")) return res(session);
    if (url.includes("/overview")) return res(overview);
    if (denied) return res({ error: "Owner access required." }, 403);
    return res({ users: [user], total: 1, nextCursor: null });
  });
  t.after(cleanup);
  const ui = render(<Admin />);
  await ui.findAllByText("Jamie Field");
  denied = true;
  fireEvent.click(ui.getByRole("button", { name: "Refresh" }));
  await ui.findByRole("link", { name: "Sign in with Google" });
  assert.equal(ui.queryByText("Jamie Field"), null);
});
test("lost grant response survives a tab visibility change and retries the same operation ID", async (t) => {
  assert.ok(Admin);
  window.sessionStorage.clear();
  const mutations = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      const b = JSON.parse(options.body);
      if (url.endsWith("/authorize")) return res({ authorization: "auth" });
      mutations.push(b);
      if (mutations.length === 1) throw Error("Lost response");
      return res({
        id: "grant:recovered",
        amountCredits: 240,
        balanceAfter: 240,
        target: "member",
      });
    }
    if (url.includes("/operations/")) return res({ state: "pending" });
    if (url.endsWith("/session")) return res(session);
    if (url.includes("/overview")) return res(overview);
    if (url.includes("/users/member"))
      return res({
        user,
        grants: [],
        purchases: [],
        audit: [],
        allowance: overview.allowance,
      });
    return res({ users: [user], total: 1, nextCursor: null });
  });
  t.after(() => {
    cleanup();
    window.sessionStorage.clear();
  });
  const ui = render(<Admin />);
  await ui.findAllByText("Jamie Field");
  fireEvent.click(ui.getAllByRole("button", { name: /View Jamie Field/ })[0]);
  await ui.findByRole("heading", { name: "Jamie Field" });
  fireEvent.click(ui.getByRole("button", { name: "Add free credits" }));
  fireEvent.change(ui.getByLabelText("Reason"), {
    target: { value: "Recovery" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Review change" }));
  fireEvent.click(ui.getByRole("button", { name: "Confirm grant" }));
  await ui.findByRole("button", { name: "Check or retry this change" });
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  fireEvent(document, new dom.window.Event("visibilitychange"));
  await ui.findByRole("button", { name: "Check or retry this change" });
  fireEvent.click(
    ui.getByRole("button", { name: "Check or retry this change" }),
  );
  await ui.findByText("Credit change recorded");
  assert.equal(mutations.length, 2);
  assert.equal(mutations[0].operationId, mutations[1].operationId);
});
test("private data clears when a visible admin window reaches its absolute deadline", async (t) => {
  assert.ok(Admin);
  window.sessionStorage.clear();
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now });
  t.mock.method(globalThis, "fetch", async (url) =>
    url.endsWith("/session")
      ? res({ ...session, idleExpiresInMs: 900000, absoluteExpiresInMs: 500 })
      : url.includes("/overview")
        ? res(overview)
        : res({ users: [user], total: 1, nextCursor: null }),
  );
  t.after(cleanup);
  const ui = render(<Admin />);
  await ui.findAllByText("Jamie Field");
  const { act } = await import("@testing-library/react");
  await act(async () => t.mock.timers.tick(1100));
  await ui.findByRole("link", { name: "Sign in with Google" });
  assert.equal(ui.queryByText("Jamie Field"), null);
});
test("private account data clears after fifteen minutes without a successful admin request", async (t) => {
  assert.ok(Admin);
  window.sessionStorage.clear();
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now });
  t.mock.method(globalThis, "fetch", async (url) =>
    url.endsWith("/session")
      ? res({
          ...session,
          idleExpiresInMs: 900000,
          absoluteExpiresInMs: 3600000,
        })
      : url.includes("/overview")
        ? res(overview)
        : res({ users: [user], total: 1, nextCursor: null }),
  );
  t.after(cleanup);
  const ui = render(<Admin />);
  await ui.findAllByText("Jamie Field");
  const { act } = await import("@testing-library/react");
  await act(async () => t.mock.timers.tick(900001));
  await ui.findByRole("link", { name: "Sign in with Google" });
  assert.equal(ui.queryByText("Jamie Field"), null);
});
