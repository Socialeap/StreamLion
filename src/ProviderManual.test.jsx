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
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const { render, fireEvent, cleanup, within } =
  await import("@testing-library/react");
const { default: ManualButton } = await import("./ProviderManual.jsx");

test("manual section navigation exposes all stages and Home returns to Projects without changing drafts", (t) => {
  t.after(cleanup);
  let home = 0;
  localStorage.setItem("manual-draft", "Keep exact 6 7/16 inches");
  const ui = render(<ManualButton onHome={() => home++} />);
  fireEvent.click(ui.getByRole("button", { name: "Open provider manual" }));
  const guide = within(ui.getByRole("dialog"));
  const nav = within(guide.getByRole("navigation", { name: "Page sections" }));
  fireEvent.click(nav.getByRole("button", { name: "Home" }));
  assert.equal(home, 1);
  assert.equal(ui.queryByRole("dialog"), null);
  assert.equal(
    localStorage.getItem("manual-draft"),
    "Keep exact 6 7/16 inches",
  );
});

test("the manual section directory reveals the final stage and focuses it without changing the underlying input", async (t) => {
  t.after(cleanup);
  const ui = render(
    <>
      <textarea aria-label="Unfinished QA" defaultValue="Exact 5 3/8 inches" />
      <ManualButton />
    </>,
  );
  fireEvent.click(ui.getByRole("button", { name: "Open provider manual" }));
  const guide = within(ui.getByRole("dialog"));
  fireEvent.click(guide.getByRole("button", { name: /Sections: all 7/ }));
  const directory = within(ui.getByRole("dialog", { name: "Page sections" }));
  assert.equal(directory.getAllByRole("button", { name: /^Go to / }).length, 7);
  fireEvent.click(directory.getByRole("button", { name: "Go to Deliver" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.querySelectorAll(".manual-stage")[6].open, true);
  assert.equal(ui.getByLabelText("Unfinished QA").value, "Exact 5 3/8 inches");
});

test("walkthrough opens chronological stages, exposes nested guidance and supports expand/collapse", (t) => {
  t.after(cleanup);
  const ui = render(<ManualButton />);
  fireEvent.click(ui.getByRole("button", { name: "Open provider manual" }));
  const guide = within(ui.getByRole("dialog"));
  assert.equal(guide.getAllByRole("heading", { level: 2 }).length, 7);
  assert.equal(document.querySelectorAll(".manual-stage[open]").length, 0);
  fireEvent.click(guide.getByRole("button", { name: /Start walkthrough/ }));
  assert.equal(document.querySelector(".manual-stage").open, true);
  assert.ok(
    document.activeElement ===
      document.querySelector(".manual-stage > summary"),
  );
  // Native summaries disclose the individual instruction, not a navigation or save.
  fireEvent.click(guide.getByText("Connect Google and choose a workbook"));
  assert.equal(document.querySelector(".manual-step").open, true);
  assert.ok(guide.getByText("Connections → Google Sheets & Drive"));
  fireEvent.click(
    guide.getByRole("button", { name: "Next: Receive the request" }),
  );
  assert.equal(document.querySelectorAll(".manual-stage")[1].open, true);
  fireEvent.click(guide.getByRole("button", { name: "Expand all" }));
  assert.equal(document.querySelectorAll("details:not([open])").length, 0);
  assert.equal(guide.getAllByText("Example · illustrative only").length, 6);
  assert.ok(guide.getByText(/36 7\/16 in/));
  fireEvent.click(guide.getByRole("button", { name: "Collapse all" }));
  assert.equal(document.querySelectorAll("details[open]").length, 0);
});

test("Escape restores focus and scrolling without changing a draft or making requests", (t) => {
  t.after(cleanup);
  localStorage.setItem("field-draft", "Lobby doorway: 36 7/16 in");
  document.body.style.overflow = "auto";
  let requests = 0;
  t.mock.method(globalThis, "fetch", () => {
    requests++;
    throw new Error("Manual must be local");
  });
  const ui = render(<ManualButton />);
  const trigger = ui.getByRole("button", { name: "Open provider manual" });
  trigger.focus();
  fireEvent.click(trigger);
  assert.equal(document.body.style.overflow, "hidden");
  fireEvent.click(ui.getByRole("button", { name: "Expand all" }));
  fireEvent(
    ui.getByRole("dialog"),
    new dom.window.Event("cancel", { cancelable: true }),
  );
  assert.equal(ui.queryByRole("dialog"), null);
  assert.ok(document.activeElement === trigger);
  assert.equal(document.body.style.overflow, "auto");
  assert.equal(
    localStorage.getItem("field-draft"),
    "Lobby doorway: 36 7/16 in",
  );
  assert.equal(requests, 0);
});

test.after(() => dom.window.close());
