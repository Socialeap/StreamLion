import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><body></body>", {
  url: "https://app.example/",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
window.matchMedia = () => ({ matches: true, addEventListener() {} });
const { render, cleanup } = await import("@testing-library/react");
const { default: InstallApp } = await import("./InstallApp.jsx");
test("an already installed standalone app does not offer installation", () => {
  const ui = render(<InstallApp />);
  assert.equal(ui.queryByText("Install app"), null);
  cleanup();
});
test.after(() => dom.window.close());
