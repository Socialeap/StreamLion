import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { render, cleanup, waitFor, act } =
  await import("@testing-library/react");
const { default: WelcomeScreen } = await import("./WelcomeScreen.jsx");
let animations;
test.beforeEach(() => {
  animations = [];
  dom.window.Element.prototype.animate = function (frames, options) {
    const animation = {
      target: this,
      frames,
      options,
      cancelled: false,
      cancel() {
        this.cancelled = true;
      },
    };
    animations.push(animation);
    return animation;
  };
  Object.defineProperty(dom.window.HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => 192,
  });
  dom.window.HTMLImageElement.prototype.decode = () => Promise.resolve();
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});
test.afterEach(cleanup);
test.after(() => dom.window.close());
const opener = () =>
  render(
    <WelcomeScreen
      ready
      connected
      account="qa@example.com"
      onProjects={() => {}}
      onSignOut={() => {}}
    />,
  );

test("slow mobile fonts do not suppress the six-node opener", async () => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: new Promise(() => {}) },
  });
  const ui = opener();
  await waitFor(() =>
    assert.equal(ui.getByRole("main").dataset.motion, "playing"),
  );
  assert.equal(
    animations.filter((animation) =>
      animation.target.classList.contains("welcome-node"),
    ).length,
    6,
  );
});

test("mobile browser-bar height changes do not cancel motion, but orientation width changes settle safely", async () => {
  const ui = opener();
  await waitFor(() =>
    assert.equal(ui.getByRole("main").dataset.motion, "playing"),
  );
  await act(async () => window.dispatchEvent(new dom.window.Event("resize")));
  assert.equal(ui.getByRole("main").dataset.motion, "playing");
  assert(animations.every((animation) => !animation.cancelled));
  const old = window.innerWidth;
  window.innerWidth = old + 100;
  await act(async () => window.dispatchEvent(new dom.window.Event("resize")));
  assert.equal(ui.getByRole("main").dataset.motion, "static");
  assert(animations.every((animation) => animation.cancelled));
  window.innerWidth = old;
});

test("explicit reduced motion uses a static opener with immediately usable account controls", async () => {
  window.matchMedia = () => ({ matches: true });
  const ui = opener();
  await waitFor(() =>
    assert.equal(ui.getByRole("main").dataset.motion, "static"),
  );
  assert.equal(animations.length, 0);
  assert.equal(
    ui.getByRole("button", { name: "Open Projects" }).disabled,
    false,
  );
});

test("slow image loading never reveals the tagline before the pull or restarts a terminal fallback", async (t) => {
  let release;
  const decoding = new Promise((resolve) => {
    release = resolve;
  });
  dom.window.HTMLImageElement.prototype.decode = () => decoding;
  const timers = [];
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if (ms === 1500 || ms === 5000) {
      timers.push({ fn, ms });
      return 99999;
    }
    return schedule(fn, ms, ...args);
  });
  const ui = opener();
  await act(async () =>
    timers.filter((timer) => timer.ms === 1500).forEach((timer) => timer.fn()),
  );
  assert.equal(ui.getByRole("main").dataset.motion, "pending");
  await act(async () => timers.find((timer) => timer.ms === 5000).fn());
  assert.equal(ui.getByRole("main").dataset.motion, "static");
  await act(async () => release());
  assert.equal(ui.getByRole("main").dataset.motion, "static");
  assert.equal(animations.length, 0);
});
