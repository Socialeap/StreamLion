import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<html><body></body></html>", {
  url: "https://app.example",
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
const { render, cleanup } = await import("@testing-library/react");
const { default: ProjectValue } = await import("./ProjectValue.jsx");
test("client copy explains free access and accurate saved-update behavior without actions", (t) => {
  t.after(cleanup);
  const ui = render(<ProjectValue client compact />);
  assert.ok(ui.getByText(/Your invited project portal is free/));
  assert.ok(ui.getByText(/Unsubmitted drafts are not shared/));
  assert.ok(
    ui.getByRole("heading", { name: "Clear expectations. Easier follow-up." }),
  );
  assert.equal(ui.queryByRole("button"), null);
});
test("provider value includes an accessible three-step graphic and fresh work approval", (t) => {
  t.after(cleanup);
  const ui = render(<ProjectValue />);
  const steps = ui.getByRole("list", { name: "Shared project workflow" });
  assert.equal(steps.children.length, 3);
  assert.match(
    ui.getByText(/Changes to the agreed work/).textContent,
    /fresh approval/,
  );
});
test.after(() => dom.window.close());
