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
const { render, fireEvent, act, cleanup, waitFor } =
  await import("@testing-library/react");
const { default: Purchase } = await import("./Purchase.jsx");
const { default: LicenseGate } = await import("./LicenseGate.jsx");
const config = {
  enabled: true,
  required: true,
  mode: "test",
  amount: 2996,
  standardAmount: 3995,
  launchRemaining: 200,
  launchCapacity: 200,
  refundDays: 7,
};
const response = (v, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function assertBillingNavigation(ui) {
  const header = ui.getByRole("banner");
  assert.ok(header.querySelector(".workspace-lion"));
  assert.ok(ui.getByRole("button", { name: /^Account:/ }));
  assert.ok(
    ui
      .getByRole("navigation", { name: "Main" })
      .querySelector('a[href="/?page=Projects"]'),
  );
}
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
  assert.ok(ui.getByText("Checking purchase options…"));
  assertBillingNavigation(ui);
  await act(async () => {});
  assert.match(ui.getByRole("alert").textContent, /Temporarily unavailable/);
  assertBillingNavigation(ui);
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
  assertBillingNavigation(ui);
  cleanup();
});
for (const sessionId of [null, "cs_test_verified"])
  test(`a verified purchase restores during a pricing outage ${sessionId ? "on checkout return" : "without a return session"}`, async (t) => {
    window.history.replaceState(
      null,
      "",
      "/api/purchase" + (sessionId ? `?session_id=${sessionId}` : ""),
    );
    const requests = [];
    let restored = 0;
    t.mock.method(globalThis, "fetch", async (url) => {
      requests.push(url);
      return url.endsWith("config")
        ? response({ error: "Pricing outage" }, 503)
        : response({
            enabled: true,
            required: true,
            connected: true,
            purchased: true,
            mode: "test",
            account: "provider@example.com",
            subject: "buyer",
          });
    });
    const ui = render(<Purchase onPurchased={() => restored++} />);
    await act(async () => {});
    assert.equal(
      ui.getByRole("link", { name: "Open workspace" }).getAttribute("href"),
      "/",
    );
    assert.ok(ui.getByText("provider@example.com"));
    assertBillingNavigation(ui);
    assert.equal(ui.queryByRole("alert"), null);
    assert.equal(window.location.search, "");
    assert.equal(restored, 1);
    assert.equal(
      requests.some((url) => url.endsWith("confirm")),
      false,
    );
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
test("paused sales keep Google restoration available without checkout buttons", async (t) => {
  window.history.replaceState(null, "", "/api/purchase");
  t.mock.method(globalThis, "fetch", async (url) =>
    response(
      url.endsWith("config")
        ? { ...config, enabled: false, checkoutMode: "owner_qa" }
        : { enabled: true, required: true, connected: false, purchased: false },
    ),
  );
  t.after(cleanup);
  const ui = render(<Purchase />);
  await act(async () => {});
  assert.ok(
    ui.getByRole("link", { name: /Sign in to restore or check access/ }),
  );
  assert.equal(
    ui.queryByRole("button", { name: "Continue to secure checkout" }),
    null,
  );
});
test("approved live owner QA shows checkout with an explicit real-payment notice", async (t) => {
  window.history.replaceState(null, "", "/api/purchase");
  t.mock.method(globalThis, "fetch", async (url) =>
    response(
      url.endsWith("config")
        ? { ...config, mode: "live", checkoutMode: "owner_qa" }
        : {
            enabled: true,
            required: true,
            connected: true,
            purchased: false,
            subject: "owner",
            account: "owner@example.com",
          },
    ),
  );
  t.after(cleanup);
  const ui = render(<Purchase />);
  await act(async () => {});
  assert.ok(ui.getByRole("button", { name: "Continue to secure checkout" }));
  assert.match(ui.getByRole("note").textContent, /real money/);
});
test("workspace navigation preserves the verified account and secure-checkout control", async (t) => {
  window.history.replaceState(null, "", "/api/purchase");
  const checkouts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("checkout")) {
      checkouts.push(options);
      return response({ processing: true });
    }
    return response(
      url.endsWith("config")
        ? config
        : {
            enabled: true,
            required: true,
            connected: true,
            purchased: false,
            subject: "buyer",
            account: "buyer@example.com",
          },
    );
  });
  t.after(cleanup);
  const ui = render(<Purchase />);
  await act(async () => {});
  assertBillingNavigation(ui);
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Continue to secure checkout" }),
    ),
  );
  assert.equal(checkouts.length, 1);
  assert.equal(checkouts[0].headers["X-StreamLion-Account"], "buyer");
  assert.ok(ui.getByText(/Your payment is being confirmed/));
  assertBillingNavigation(ui);
});
test("Core return confirmation works while new checkout is paused or its quote is unavailable", async (t) => {
  for (const unavailable of [false, true]) {
    window.history.replaceState(
      null,
      "",
      "/api/purchase?session_id=cs_test_pending",
    );
    let confirmed = 0,
      checkoutCalls = 0;
    t.mock.method(globalThis, "fetch", async (url) => {
      if (url.endsWith("checkout")) checkoutCalls++;
      if (url.endsWith("confirm")) {
        confirmed++;
        return response({ purchased: true, status: "paid" });
      }
      if (url.endsWith("config"))
        return unavailable
          ? response({ error: "Quote unavailable" }, 503)
          : response({ ...config, enabled: false, checkoutMode: "paused" });
      return response({
        enabled: true,
        required: true,
        connected: true,
        purchased: false,
        subject: "buyer",
        account: "buyer@example.com",
      });
    });
    let restored = 0;
    const ui = render(<Purchase onPurchased={() => restored++} />);
    await act(async () => {});
    assert.equal(confirmed, 1);
    assert.equal(restored, 1);
    assert.ok(ui.getByRole("link", { name: "Open workspace" }));
    assert.equal(ui.queryByRole("alert"), null);
    assert.equal(checkoutCalls, 0);
    assert.equal(window.location.search, "");
    cleanup();
  }
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

test("business checkout requires a fresh declaration and sends it without hiding backup or restoration", async (t) => {
  window.history.replaceState(null, "", "/api/purchase");
  const posts = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (options.method === "POST") {
      posts.push(JSON.parse(options.body));
      return response({ processing: true, businessReview: "pending" });
    }
    return response(
      url.endsWith("config")
        ? { ...config, businessUseRequired: true }
        : {
            enabled: true,
            required: true,
            connected: true,
            purchased: false,
            account: "qa@example.com",
            subject: "qa",
          },
    );
  });
  const ui = render(<Purchase />);
  await act(async () => {});
  const button = ui.getByRole("button", {
    name: "Continue to secure checkout",
  });
  assert.equal(button.disabled, true);
  assert.ok(ui.getByRole("button", { name: "Download my device backup" }));
  await act(async () => fireEvent.click(ui.getByRole("checkbox")));
  assert.equal(button.disabled, false);
  await act(async () => fireEvent.click(button));
  assert.deepEqual(posts, [{ businessUse: true }]);
  assert.ok(
    ui.getByText(/Payment received\. Your business tax details need checking/),
  );
  cleanup();
});

test("a lost return URL retains the original business-review session for Check again", async (t) => {
  window.history.replaceState(null, "", "/api/purchase");
  let checkouts = 0,
    confirms = 0,
    restored = 0;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url.endsWith("checkout")) {
      checkouts++;
      return response({
        processing: true,
        businessReview: "pending",
        sessionId: "cs_test_business",
      });
    }
    if (url.endsWith("confirm")) {
      confirms++;
      assert.equal(JSON.parse(options.body).sessionId, "cs_test_business");
      return response({ purchased: true, status: "paid" });
    }
    return response(
      url.endsWith("config")
        ? { ...config, businessUseRequired: true }
        : {
            enabled: true,
            required: true,
            connected: true,
            purchased: false,
            account: "qa@example.com",
            subject: "qa",
          },
    );
  });
  const ui = render(<Purchase onPurchased={() => restored++} />);
  await act(async () => {});
  await act(async () => fireEvent.click(ui.getByRole("checkbox")));
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Continue to secure checkout" }),
    ),
  );
  assert.equal(
    new URLSearchParams(window.location.search).get("session_id"),
    "cs_test_business",
  );
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Check again" })),
  );
  assert.equal(checkouts, 1);
  assert.equal(confirms, 1);
  assert.equal(restored, 1);
  assert.equal(window.location.search, "");
  cleanup();
});

test("active free pilot opens Core without a paid receipt; expiry closes it and keeps retrieval guidance", async (t) => {
  let active = true;
  const end = Date.now() + 60000;
  t.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("/api/free-pilot/")
      ? response({
          enabled: true,
          active,
          startsAt: Date.now() - 1000,
          endsAt: active ? end : Date.now() - 1,
          state: active ? "active" : "expired",
        })
      : response(
          String(url).endsWith("/status")
            ? {
                enabled: true,
                required: true,
                purchased: false,
                connected: false,
                mode: "test",
              }
            : { ...config, enabled: false, checkoutMode: "paused" },
        ),
  );
  t.after(cleanup);
  const ui = render(
    <LicenseGate>
      <div>Free Core workspace</div>
    </LicenseGate>,
  );
  await ui.findByText("Free Core workspace");
  await ui.findByText(/Free pilot expires/);
  active = false;
  await act(async () => window.dispatchEvent(new window.Event("focus")));
  await ui.findByText(/Your pilot access has ended/);
  assert.equal(ui.queryByText("Free Core workspace"), null);
  assert(ui.getByRole("link", { name: "Pilot status and work retrieval" }));
});

test("offline cold start restores the cached pilot expiry timer and stops local Core at the deadline", async (t) => {
  const now = 1800000000000;
  t.mock.method(Date, "now", () => now);
  const endsAt = now + 5000;
  localStorage.setItem(
    "streamlion-purchase-receipt-v1",
    JSON.stringify({ pilot: true, expires: endsAt }),
  );
  const online = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", {
    value: false,
    configurable: true,
  });
  t.after(() => {
    if (online) Object.defineProperty(navigator, "onLine", online);
    else delete navigator.onLine;
    cleanup();
    localStorage.clear();
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("Offline");
  });
  const realTimeout = globalThis.setTimeout;
  let expire = null;
  let expiryDelay = null;
  t.mock.method(globalThis, "setTimeout", (fn, delay, ...args) => {
    if (delay > 3000 && delay <= 5000) {
      expire = fn;
      expiryDelay = delay;
    }
    return realTimeout(fn, delay, ...args);
  });
  const ui = render(
    <LicenseGate>
      <div>Offline pilot workspace</div>
    </LicenseGate>,
  );
  await ui.findByText("Offline pilot workspace");
  // A DOM commit can precede the passive effect that registers this timer.
  await waitFor(() =>
    assert.equal(
      typeof expire,
      "function",
      "An offline pilot must schedule its original expiry",
    ),
  );
  assert.equal(
    now + expiryDelay,
    endsAt,
    "The timer must keep the cached original deadline",
  );
  await act(async () => expire());
  assert.equal(ui.queryByText("Offline pilot workspace"), null);
  await ui.findByText(/Your pilot access has ended/);
});

test("the 14-day purchase guarantee discloses first delivery before a buyer continues", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) =>
    response(
      url.endsWith("config")
        ? { ...config, refundDays: 14 }
        : { enabled: true, required: true, connected: false, purchased: false },
    ),
  );
  const ui = render(<Purchase />);
  try {
    await waitFor(() => assert.ok(ui.getByText(/14-day money-back guarantee/)));
    assert.ok(
      ui.getByText(/before your first project delivery through StreamLion/),
    );
    assert.ok(ui.getByRole("link", { name: "Purchase terms" }));
    assert.ok(ui.getByRole("link", { name: "Continue with Google" }));
  } finally {
    cleanup();
  }
});
