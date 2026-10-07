import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example/api/client-portal?job=one",
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
const { default: Settings } = await import("./NotificationSettings.jsx");
const publicKey = Buffer.alloc(65, 1).toString("base64url");
function browser(
  t,
  { permission = "default", subscribed = false, updated = true } = {},
) {
  let permissionRequests = 0,
    unsubscribed = 0,
    subscribeCalls = 0;
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/synthetic",
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/synthetic",
      keys: {},
    }),
    unsubscribe: async () => {
      unsubscribed++;
      return true;
    },
  };
  const worker = {
    active: {
      postMessage: (_, ports) =>
        ports[0].postMessage({ notifications: updated ? 1 : 0 }),
    },
    pushManager: {
      getSubscription: async () => (subscribed ? subscription : null),
      subscribe: async (options) => {
        subscribeCalls++;
        assert.equal(options.userVisibleOnly, true);
        return subscription;
      },
    },
  };
  const notification = {
    permission,
    requestPermission: async () => {
      permissionRequests++;
      return permission === "default" ? "granted" : permission;
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: async () => worker },
  });
  window.PushManager = function () {};
  window.Notification = notification;
  globalThis.Notification = notification;
  t.after(() => {
    cleanup();
    delete navigator.serviceWorker;
    delete window.PushManager;
    delete window.Notification;
    delete globalThis.Notification;
  });
  return {
    subscription,
    get permissionRequests() {
      return permissionRequests;
    },
    get unsubscribed() {
      return unsubscribed;
    },
    get subscribeCalls() {
      return subscribeCalls;
    },
  };
}
test("permission is requested only after a tap; failed server setup removes a fresh subscription", async (t) => {
  const state = browser(t),
    calls = [];
  const api = async (path, body) => {
    calls.push({ path, body });
    if (!body) return { enabled: true, publicKey, devices: [] };
    throw new Error("Synthetic registration failed");
  };
  const ui = render(<Settings role="client" subject="one" api={api} />);
  const enable = await ui.findByRole("button", {
    name: "Enable device alerts",
  });
  assert.equal(state.permissionRequests, 0);
  fireEvent.click(enable);
  await ui.findByText("Synthetic registration failed");
  assert.equal(state.permissionRequests, 1);
  assert.equal(state.subscribeCalls, 1);
  assert.equal(state.unsubscribed, 1);
  assert.equal(calls[1].body.action, "subscribe");
});
test("declined permission leaves portal and email usable without storing a subscription", async (t) => {
  const state = browser(t);
  globalThis.Notification.requestPermission = async () => "denied";
  let writes = 0;
  const api = async (_, body) => {
    if (body) writes++;
    return { enabled: true, publicKey, devices: [] };
  };
  const ui = render(<Settings role="client" subject="one" api={api} />);
  fireEvent.click(
    await ui.findByRole("button", { name: "Enable device alerts" }),
  );
  await ui.findByText(/Your project and email access still work/);
  assert.equal(writes, 0);
  assert.equal(state.subscribeCalls, 0);
});
test("a stale worker cannot register alerts even with permission", async (t) => {
  const state = browser(t, { permission: "granted", updated: false });
  const ui = render(
    <Settings
      role="provider"
      subject="owner"
      api={async () => ({ enabled: true, publicKey, devices: [] })}
    />,
  );
  fireEvent.click(
    await ui.findByRole("button", { name: "Enable device alerts" }),
  );
  await ui.findByText("Update StreamLion before enabling device alerts.");
  assert.equal(state.subscribeCalls, 0);
});
test("turning alerts off unlinks the server before removing the browser subscription", async (t) => {
  const state = browser(t, { permission: "granted", subscribed: true });
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(state.subscription.endpoint),
    ),
  );
  const id = Buffer.from(bytes).toString("base64url");
  let unlinked = false;
  const api = async (_, body) => {
    if (body) {
      assert.equal(body.action, "unsubscribe");
      assert.equal(state.unsubscribed, 0);
      unlinked = true;
    }
    return { enabled: true, publicKey, devices: [{ id }] };
  };
  const ui = render(<Settings role="client" subject="one" api={api} />);
  fireEvent.click(
    await ui.findByRole("button", { name: "Turn off device alerts" }),
  );
  await ui.findByText("Notifications are off on this device.");
  assert.equal(unlinked, true);
  assert.equal(state.unsubscribed, 1);
});
test("iPhone browser offers installation guidance before unsupported API detection", async (t) => {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: "iPhone Safari",
  });
  t.after(() => {
    delete navigator.userAgent;
    cleanup();
  });
  const ui = render(
    <Settings
      role="client"
      api={async () => {
        throw new Error("Must not request setup");
      }}
    />,
  );
  assert.ok(ui.getByText(/Add to Home Screen/));
  assert.equal(ui.queryByText(/unavailable in this browser/), null);
});
