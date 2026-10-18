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
// Row n of the stage table (1-based; row 0 is the header).
const stage = (ui, n) =>
  ui.getByRole("table").querySelectorAll("tbody tr")[n - 1];
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
test("the guide explains each stage before cost, payment and the wallet, even while sales are closed", async (t) => {
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
  const title = ui.getByRole("heading", { level: 1, name: "How credits work" });
  const table = ui.getByRole("table");
  assert.deepEqual(
    [...table.querySelectorAll("thead th")].map((th) => th.textContent),
    ["Stage", "Non-Credit Option", "Credit-based Option"],
  );
  assert.equal(table.querySelectorAll("tbody tr").length, 7);
  // Free stages show a dash and no price; the request itself is its own row.
  for (const n of [1, 2, 3, 6])
    assert.ok(within(stage(ui, n)).getByText("No credit-based option"));
  assert.match(stage(ui, 2).textContent, /Client sends a work-order request/);
  assert.match(
    stage(ui, 5).querySelector(".credits-pill").textContent,
    /^240 credits \| , USD.3\.00 per project$/,
  );
  assert.match(stage(ui, 5).textContent, /shared Coordination Brief/);
  // Closed optional features never advertise a price.
  for (const n of [4, 7])
    assert.equal(
      stage(ui, n).querySelector(".credits-pill").textContent,
      "Not available yet",
    );
  const order = [
    title,
    table,
    ui.getByRole("list", { name: "Coordination page, step by step" }),
    ui.getByRole("heading", { name: "When credits are charged" }),
    ui.getByRole("heading", { name: "Cost" }),
    ui.getByRole("heading", { name: "Payment" }),
    ui.getByRole("region", { name: "Credit wallet" }),
  ];
  for (let i = 1; i < order.length; i++)
    assert(
      order[i - 1].compareDocumentPosition(order[i]) &
        window.Node.DOCUMENT_POSITION_FOLLOWING,
    );
  assert.ok(ui.getByRole("list", { name: "Credit packs" }));
  assert.ok(ui.getByText(/Buying credits does not turn on an option/));
  assert.ok(ui.getByText(/Credit purchases are not open yet/));
  assert.equal(
    ui.queryByRole("button", { name: "800 credits for $10.00" }),
    null,
  );
  assert(calls.every((call) => call.method === "GET"));
});
test("brief and AI pills show their live prices once those options open", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    Response.json(
      url.endsWith("config")
        ? {
            enabled: false,
            mode: "live",
            projectMicros: 3000000,
            briefMicros: 100000,
            aiMicros: 12480,
            packs,
          }
        : { enabled: false, connected: false },
    ),
  );
  t.after(cleanup);
  const ui = render(<Credits />);
  await act(async () => {});
  const pill = (n) => stage(ui, n).querySelector(".credits-pill").textContent;
  assert.match(pill(4), /^8 credits \| , USD.0\.10 per brief$/);
  assert.match(pill(7), /^≈1 credit \| , ≈USD.0\.01 per answer$/);
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
  await goToSection(ui, "Charges");
  assert.equal(document.activeElement.id, "credits-charges");
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
  assert.ok(ui.getByRole("button", { name: "800 credits for $10.00" }));
  assert.match(stage(ui, 5).textContent, /USD.3\.00 per project/);
  fail = true;
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Refresh balance and payment status" }),
    ),
  );
  assert.equal(ui.queryByText("$10.00"), null);
  assert.doesNotMatch(stage(ui, 5).textContent, /USD/);
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
  assert.match(
    stage(ui, 5).querySelector(".credits-pill").textContent,
    /^160 credits \| , USD.2\.00 per project$/,
  );
  assert.match(
    ui.getByRole("list", { name: "Credit packs" }).textContent,
    /\$10\.00800 creditsCovers 5 Coordination pages/,
  );
  projectMicros = null;
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Refresh balance and payment status" }),
    ),
  );
  assert.equal(
    stage(ui, 5).querySelector(".credits-pill").textContent,
    "Not available yet",
  );
  // Packs stay listed without a coordination price; only coverage is omitted.
  const list = ui.getByRole("list", { name: "Credit packs" });
  assert.match(list.textContent, /\$10\.00800 credits/);
  assert.doesNotMatch(list.textContent, /Coordination page/);
});
function savedCardFetch(t, { card = null, replies = {} } = {}) {
  const calls = [];
  let current = card;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const path = url.split("/").at(-1);
    if (options.method === "POST") {
      calls.push({ path, body: JSON.parse(options.body) });
      const reply = replies[path]?.shift?.() || { processing: true };
      if (path === "card") current = null;
      return Response.json(reply);
    }
    return Response.json(
      path === "config"
        ? {
            enabled: true,
            savedCards: true,
            mode: "test",
            projectMicros: 3000000,
            packs,
          }
        : {
            enabled: true,
            connected: true,
            account: "a@example.test",
            subject: "a",
            purchased: true,
            balanceMicros: 10000000,
            card: current,
          },
    );
  });
  return calls;
}
const visa = { brand: "visa", last4: "4242", expMonth: 3, expYear: 2030 };
test("a card can be saved at checkout for one-tap top-ups, by explicit choice only", async (t) => {
  const calls = savedCardFetch(t);
  t.after(cleanup);
  let ui;
  await act(async () => {
    ui = render(<Credits />);
  });
  const save = ui.getByRole("checkbox", {
    name: /Save my card for one-tap top-ups/,
  });
  assert.equal(save.checked, false);
  assert.ok(ui.getByText(/never automatically/));
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "800 credits for $10.00" })),
  );
  assert.deepEqual(calls[0], { path: "checkout", body: { packId: "small" } });
  await act(async () => fireEvent.click(save));
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "2000 credits for $25.00" }),
    ),
  );
  assert.deepEqual(calls[1], {
    path: "checkout",
    body: { packId: "medium", saveCard: true },
  });
});
test("with a saved card, choosing a pack asks to confirm before one tap pays", async (t) => {
  const calls = savedCardFetch(t, {
    card: visa,
    replies: { topup: [{ credited: true }, { authenticationRequired: true }] },
  });
  t.after(cleanup);
  let ui;
  await act(async () => {
    ui = render(<Credits />);
  });
  assert.ok(ui.getByText("Visa •••• 4242"));
  assert.ok(ui.getByText(/expires 03\/30/));
  assert.equal(ui.queryByRole("checkbox"), null);
  const pack = ui.getByRole("button", { name: "2000 credits for $25.00" });
  await act(async () => fireEvent.click(pack));
  assert.equal(calls.length, 0);
  assert.equal(pack.getAttribute("aria-pressed"), "true");
  const confirm = ui.getByRole("group", { name: "Confirm top-up" });
  assert.match(
    confirm.textContent,
    /2000 credits for \$25\.00 with Visa •••• 4242/,
  );
  await act(async () =>
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" })),
  );
  assert.equal(ui.queryByRole("group", { name: "Confirm top-up" }), null);
  await act(async () => fireEvent.click(pack));
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Pay $25.00" })),
  );
  assert.deepEqual(calls[0], { path: "topup", body: { packId: "medium" } });
  assert.ok(await ui.findByText("Credits added to your wallet."));
  // A bank that wants to confirm sends the same pack to Stripe Checkout.
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "800 credits for $10.00" })),
  );
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Pay $10.00" })),
  );
  assert.ok(ui.getByText(/Your bank wants to confirm this payment/));
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Continue in Checkout" })),
  );
  assert.deepEqual(calls.at(-1), {
    path: "checkout",
    body: { packId: "small" },
  });
});
test("a saved card can be removed after confirmation", async (t) => {
  const calls = savedCardFetch(t, {
    card: visa,
    replies: { card: [{ removed: true }] },
  });
  t.after(cleanup);
  let ui;
  await act(async () => {
    ui = render(<Credits />);
  });
  window.confirm = () => false;
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Remove card" })),
  );
  assert.equal(calls.length, 0);
  window.confirm = () => true;
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Remove card" })),
  );
  assert.deepEqual(calls[0], { path: "card", body: { action: "remove" } });
  assert.ok(await ui.findByText("Saved card removed."));
  assert.equal(ui.queryByText("Visa •••• 4242"), null);
  assert.ok(
    ui.getByRole("checkbox", { name: /Save my card for one-tap top-ups/ }),
  );
});
