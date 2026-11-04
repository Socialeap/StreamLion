import test from "node:test";
import assert from "node:assert/strict";
import { awaitProfileApproval } from "./f3d-profile-connect.js";
const nonce = "N".repeat(43);
function channel() {
  const listeners = new Set();
  const host = {
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  return {
    host,
    emit: (event) => {
      for (const fn of listeners) fn(event);
    },
    listeners,
  };
}
test("popup exchange validates both sender origin/window and the pending nonce", async () => {
  const c = channel(),
    sent = [],
    popup = { postMessage: (...args) => sent.push(args) };
  const controller = new AbortController();
  const pending = awaitProfileApproval(popup, nonce, controller.signal, c.host);
  c.emit({
    origin: "https://evil.example",
    source: popup,
    data: { type: "f3d-profile-ready" },
  });
  c.emit({
    origin: "https://www.frontiers3d.com",
    source: {},
    data: { type: "f3d-profile-ready" },
  });
  assert.equal(sent.length, 0);
  c.emit({
    origin: "https://www.frontiers3d.com",
    source: popup,
    data: { type: "f3d-profile-ready" },
  });
  assert.equal(sent.length, 1);
  c.emit({
    origin: "https://www.frontiers3d.com",
    source: popup,
    data: { type: "f3d-profile-approved", nonce: "wrong", assertion: "wrong" },
  });
  c.emit({
    origin: "https://www.frontiers3d.com",
    source: popup,
    data: { type: "f3d-profile-approved", nonce, assertion: "signed" },
  });
  assert.equal(await pending, "signed");
  assert.equal(c.listeners.size, 0);
});
test("canceling account/component work releases listeners and pending approval", async () => {
  const c = channel(),
    controller = new AbortController(),
    pending = awaitProfileApproval(
      { postMessage() {} },
      nonce,
      controller.signal,
      c.host,
    );
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(c.listeners.size, 0);
});
