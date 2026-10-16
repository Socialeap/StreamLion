import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example/api/credits",
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
const { render, fireEvent, act, cleanup, within } =
  await import("@testing-library/react");
const { default: Credits } = await import("./Credits.jsx");
function assertBillingNavigation(ui) {
  const header = ui.getByRole("banner");
  assert.ok(header.querySelector(".workspace-lion"));
  assert.ok(ui.getByRole("button", { name: /^Account:/ }));
  assert.ok(
    ui
      .getByRole("navigation", { name: "Page sections" })
      .querySelector('a[href="/?page=Projects"]'),
  );
}
const packs = [
  { id: "small", amount: 1000, creditsMicros: 10000000 },
  { id: "medium", amount: 2500, creditsMicros: 25000000 },
  { id: "large", amount: 5000, creditsMicros: 50000000 },
];
async function goToSection(ui, label) {
  if (!ui.queryByRole("button", { name: "Go to " + label, exact: true }))
    await act(async () =>
      fireEvent.click(ui.getByRole("button", { name: /^Sections:/ })),
    );
  await act(async () => {
    fireEvent.click(
      ui.getByRole("button", { name: "Go to " + label, exact: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
test("project value and verified USD cost lead the wallet even while sales are closed", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    return Response.json(
      url.endsWith("config")
        ? { enabled: false, mode: "test", projectMicros: 3000000, packs }
        : { enabled: false, connected: false },
    );
  });
  t.after(cleanup);
  const ui = render(<Credits />);
  await act(async () => {});
  const value = ui.getByRole("heading", {
    level: 1,
    name: "One shared brief. Less time chasing details.",
  });
  const wallet = ui.getByRole("region", { name: "Credit wallet" });
  assert.ok(within(wallet).getByText(/Buying credits does not turn them on/));
  assert(
    value.compareDocumentPosition(wallet) &
      window.Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.ok(ui.getByText("USD 3.00"));
  assert.ok(ui.getByText(/240 credits per confirmed project/));
  assert.ok(ui.getByRole("list", { name: "Shared project workflow" }));
  assert.ok(ui.getByText(/Clients use their invited project portal free/));
  assert.ok(ui.getByText(/Credit purchases are not open yet/));
  assert.equal(
    ui.queryByRole("button", { name: "800 credits for $10.00" }),
    null,
  );
  assert(calls.every((call) => call.method === "GET"));
});
test("approved live credit QA shows pack choices with an explicit real-payment notice", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    Response.json(
      url.endsWith("config")
        ? {
            enabled: true,
            mode: "live",
            checkoutMode: "owner_qa",
            projectMicros: 3000000,
            packs,
          }
        : {
            enabled: true,
            connected: true,
            purchased: true,
            subject: "owner",
            account: "owner@example.com",
            balanceMicros: 0,
          },
    ),
  );
  t.after(cleanup);
  const ui = render(<Credits />);
  await act(async () => {});
  assertBillingNavigation(ui);
  const pack = ui.getByRole("button", { name: "800 credits for $10.00" });
  const wallet = ui.getByRole("region", { name: "Credit wallet" });
  assert.match(ui.getByRole("note").textContent, /real money/);
  await goToSection(ui, "Credit uses");
  assert.equal(document.activeElement.id, "credit-uses");
  assert.equal(ui.getByRole("region", { name: "Credit wallet" }), wallet);
  assert.equal(
    ui.getByRole("button", { name: "800 credits for $10.00" }),
    pack,
  );
  await goToSection(ui, "Wallet");
  assert.equal(document.activeElement.id, "credits-wallet");
});
test("credit loading and failed verification keep workspace navigation available", async (t) => {
  const pending = [];
  t.mock.method(
    globalThis,
    "fetch",
    () => new Promise((resolve) => pending.push(resolve)),
  );
  t.after(cleanup);
  const ui = render(<Credits />);
  assert.ok(ui.getByText("Checking credit options…"));
  assertBillingNavigation(ui);
  await act(async () => {
    for (const resolve of pending)
      resolve(Response.json({ error: "Credits unavailable" }, { status: 503 }));
  });
  assert.match(ui.getByRole("alert").textContent, /Credits unavailable/);
  assertBillingNavigation(ui);
  assert.equal(ui.queryByText("$10.00"), null);
});
test("top-up options are gated by verified availability, Google identity and app entitlement", async (t) => {
  let config = { enabled: false },
    account = { enabled: false };
  t.mock.method(globalThis, "fetch", async (url) =>
    Response.json(url.endsWith("config") ? config : account),
  );
  t.after(cleanup);
  let ui;
  await act(async () => {
    ui = render(<Credits />);
  });
  assert.ok(ui.getByText(/Credit purchases are not open yet/));
  assert.equal(ui.queryByText("$10.00"), null);
  config = { enabled: true, mode: "test", projectMicros: 3000000, packs };
  account = { enabled: true, connected: false };
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Refresh balance and payment status" }),
    ),
  );
  assert.ok(ui.getByRole("link", { name: "Continue with Google" }));
  account = {
    enabled: true,
    connected: true,
    account: "a@example.test",
    subject: "a",
    purchased: false,
    balanceMicros: 0,
  };
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Refresh balance and payment status" }),
    ),
  );
  assert.ok(
    ui.getByRole("link", { name: "Purchase or restore StreamLion first" }),
  );
  account.purchased = true;
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Refresh balance and payment status" }),
    ),
  );
  assert.ok(ui.getByRole("button", { name: "800 credits for $10.00" }));
  assert.ok(ui.getByText(/cannot pay for live jobs or AI answers/));
});
test("duplicate clicks do not create another checkout, and server revalidates the account", async (t) => {
  const calls = [];
  let resolveCheckout;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url.endsWith("checkout")) {
      calls.push(options);
      return new Promise((resolve) => {
        resolveCheckout = () => resolve(Response.json({ processing: true }));
      });
    }
    return Response.json(
      url.endsWith("config")
        ? { enabled: true, mode: "test", projectMicros: 3000000, packs }
        : {
            enabled: true,
            connected: true,
            account: "a@example.test",
            subject: "a",
            purchased: true,
            balanceMicros: 10000000,
          },
    );
  });
  t.after(cleanup);
  let ui;
  await act(async () => {
    ui = render(<Credits />);
  });
  await act(async () => {
    const b = ui.getByRole("button", { name: "800 credits for $10.00" });
    fireEvent.click(b);
    fireEvent.click(b);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers["X-StreamLion-Account"], "a");
  assert.deepEqual(JSON.parse(calls[0].body), { packId: "small" });
  await act(async () => resolveCheckout());
  assert.ok(ui.getByText(/Payment is being confirmed/));
});
test("return confirmation restores credits when new sales are paused, with no second payment", async (t) => {
  window.history.replaceState(
    null,
    "",
    "/api/credits?session_id=cs_test_synthetic",
  );
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return Response.json(
      url.endsWith("config")
        ? { enabled: false, mode: "test" }
        : url.endsWith("confirm")
          ? { status: "paid", credited: true }
          : {
              enabled: true,
              mode: "test",
              connected: true,
              account: "a@example.test",
              subject: "a",
              purchased: true,
              balanceMicros: 10000000,
            },
    );
  });
  t.after(() => {
    cleanup();
    window.history.replaceState(null, "", "/api/credits");
  });
  let ui;
  await act(async () => {
    ui = render(<Credits />);
  });
  assert.ok(ui.getByText("Your credits are ready."));
  assert.ok(ui.getByText("800 credits available"));
  assert.equal(window.location.search, "");
  assert.equal(
    calls.some((p) => p.endsWith("checkout")),
    false,
  );
});
test("failed configuration removes stale purchase buttons and keeps the balance visible", async (t) => {
  let fail = false;
  t.mock.method(globalThis, "fetch", async (url) =>
    url.endsWith("config")
      ? fail
        ? Response.json({ error: "Unavailable" }, { status: 503 })
        : Response.json({
            enabled: true,
            mode: "test",
            projectMicros: 3000000,
            packs,
          })
      : Response.json({
          enabled: true,
          connected: true,
          account: "a@example.test",
          subject: "a",
          purchased: true,
          balanceMicros: 10000000,
        }),
  );
  t.after(cleanup);
  let ui;
  await act(async () => {
    ui = render(<Credits />);
  });
  assert.ok(ui.getByText("$10.00"));
  assert.ok(ui.getByText("USD 3.00"));
  fail = true;
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Refresh balance and payment status" }),
    ),
  );
  assert.equal(ui.queryByText("$10.00"), null);
  assert.equal(ui.queryByText("USD 3.00"), null);
  assert.ok(ui.getByText("800 credits available"));
  assert.ok(ui.getByRole("alert"));
});

test("active 160-credit policy drives both displayed prices; missing policy has no default", async (t) => {
  let projectMicros = 2000000;
  t.mock.method(globalThis, "fetch", async (url) =>
    Response.json(
      url.endsWith("config")
        ? { enabled: false, mode: "test", packs, projectMicros }
        : { enabled: false, connected: false },
    ),
  );
  t.after(cleanup);
  const ui = render(<Credits />);
  await act(async () => {});
  assert.ok(ui.getByText("160 credits per confirmed project"));
  assert.ok(ui.getByText("USD 2.00"));
  assert.equal(ui.queryByText("USD 3.00"), null);
  projectMicros = null;
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Refresh balance and payment status" }),
    ),
  );
  assert.ok(ui.getByText("Project credit charge unavailable"));
  assert.ok(ui.getByText("Dollar estimate unavailable"));
  assert.equal(ui.queryByText("USD 2.00"), null);
});
