import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<html><body></body></html>", {
  url: "https://app.example/api/purchase",
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
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: Purchase } = await import("./Purchase.jsx");
const { default: LicenseGate } = await import("./LicenseGate.jsx");
const config = {
  enabled: true,
  required: true,
  mode: "test",
  amount: 2996,
  standardAmount: 3995,
  launchRemaining: 100,
  refundDays: 14,
};
const response = (v, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("a temporary configuration failure offers a working retry and clear sign-in/restore guidance", async (t) => {
  let fail = true;
  t.mock.method(globalThis, "fetch", async (url) =>
    fail
      ? response({ error: "Temporarily unavailable" }, 503)
      : response(
          url.endsWith("config")
            ? config
            : {
                enabled: true,
                required: true,
                connected: false,
                purchased: false,
              },
        ),
  );
  const ui = render(<Purchase />);
  await act(async () => {});
  assert.match(ui.getByRole("alert").textContent, /Temporarily unavailable/);
  fail = false;
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Check again" })),
  );
  assert.equal(
    ui.getByRole("link", { name: "Continue with Google" }).getAttribute("href"),
    "/api/google/start?returnTo=purchase",
  );
  assert.ok(ui.getByText(/Already purchased/));
  assert.ok(ui.getByText(/No real payment/));
  cleanup();
});
test("a purchase restores its account even during a pricing outage, without another checkout", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    url.endsWith("config")
      ? response({ error: "Pricing outage" }, 503)
      : response({
          enabled: true,
          required: true,
          connected: true,
          purchased: true,
          mode: "test",
          account: "provider@example.com",
          subject: "buyer",
        }),
  );
  const ui = render(<Purchase />);
  await act(async () => {});
  assert.equal(
    ui.getByRole("link", { name: "Open workspace" }).getAttribute("href"),
    "/",
  );
  assert.ok(ui.getByText("provider@example.com"));
  assert.equal(
    ui.queryByRole("button", { name: "Continue to secure checkout" }),
    null,
  );
  cleanup();
});
test("payment verification failure does not mount the workspace; retry restores it", async (t) => {
  let fail = true;
  t.mock.method(globalThis, "fetch", async () =>
    fail
      ? response({ error: "Try later" }, 503)
      : response({ enabled: true, required: true, purchased: true }),
  );
  const ui = render(
    <LicenseGate>
      <div>Private workspace</div>
    </LicenseGate>,
  );
  await act(async () => {});
  assert.equal(ui.queryByText("Private workspace"), null);
  fail = false;
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Try again" })),
  );
  assert.ok(ui.getByText("Private workspace"));
  cleanup();
});
test("malformed verification never grants access and optional storage failure never blocks a paid buyer", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response({}));
  const ui = render(
    <LicenseGate>
      <div>Workspace</div>
    </LicenseGate>,
  );
  await act(async () => {});
  assert.equal(ui.queryByText("Workspace"), null);
  assert.ok(ui.getByRole("alert"));
  cleanup();
  t.mock.method(globalThis, "fetch", async () =>
    response({ enabled: true, required: true, purchased: true }),
  );
  t.mock.method(dom.window.Storage.prototype, "setItem", () => {
    throw new Error("Storage unavailable");
  });
  const paid = render(
    <LicenseGate>
      <div>Workspace</div>
    </LicenseGate>,
  );
  await act(async () => {});
  assert.ok(paid.getByText("Workspace"));
  cleanup();
});
