import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM(
  '<!doctype html><html><head><meta name="theme-color"></head><body></body></html>',
  { url: "https://app.example" },
);
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
const { render, fireEvent, cleanup } = await import("@testing-library/react");
const { default: ThemeSwitch } = await import("./ThemeSwitch.jsx");
const { THEME_KEY } = await import("./theme.js");
test("system theme initializes the UI; explicit choices persist and leave field drafts intact", () => {
  localStorage.clear();
  window.matchMedia = () => ({ matches: true });
  const draftKey = "streamlion-draft-v1:local:note:job";
  localStorage.setItem(draftKey, '{"area":"Room","text":"6 7/16 inches"}');
  let ui = render(<ThemeSwitch />);
  assert.equal(
    ui.getByRole("button", { name: "Dark theme" }).getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(document.documentElement.dataset.theme, "dark");
  fireEvent.click(ui.getByRole("button", { name: "Light theme" }));
  assert.equal(localStorage.getItem(THEME_KEY), "light");
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(
    document.querySelector('meta[name="theme-color"]').content,
    "#f3f6f8",
  );
  cleanup();
  ui = render(<ThemeSwitch />);
  assert.equal(
    ui
      .getByRole("button", { name: "Light theme" })
      .getAttribute("aria-pressed"),
    "true",
  );
  fireEvent.click(ui.getByRole("button", { name: "Dark theme" }));
  assert.equal(
    localStorage.getItem(draftKey),
    '{"area":"Room","text":"6 7/16 inches"}',
  );
  cleanup();
});
test("unavailable storage does not prevent a theme change and explains its lifetime", () => {
  localStorage.clear();
  window.matchMedia = () => ({ matches: false });
  const original = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () => {
    throw new Error("Storage unavailable");
  };
  try {
    const ui = render(<ThemeSwitch />);
    fireEvent.click(ui.getByRole("button", { name: "Dark theme" }));
    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.match(ui.getByRole("status").textContent, /could not remember/);
  } finally {
    dom.window.Storage.prototype.setItem = original;
    cleanup();
  }
});
test.after(() => dom.window.close());
