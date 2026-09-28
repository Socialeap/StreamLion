import "fake-indexeddb/auto";
import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
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
dom.window.scrollTo = () => {};

const { render, fireEvent, waitFor, cleanup } =
  await import("@testing-library/react");
const { default: App } = await import("./App.jsx");
const { loadWorkspace } = await import("./storage.js");

test("saving a draft keeps its editor and updates the same project on later saves", async () => {
  localStorage.clear();
  const ui = render(<App />);
  await ui.findByRole("heading", { name: "Projects" });
  fireEvent.click(ui.getAllByRole("button", { name: "Create project" })[0]);
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: " Nassau Street " },
  });
  fireEvent.click(
    ui.getByRole("button", { name: /Step 3: Where is the site/ }),
  );
  fireEvent.change(ui.getByLabelText("City"), {
    target: { value: "Brooklyn" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save draft on device" }));
  await ui.findByText(/Draft saved on this device/);
  assert.ok(ui.getByLabelText("City"));
  await waitFor(async () => {
    const saved = await loadWorkspace();
    assert.equal(saved.jobs.length, 1);
  });
  fireEvent.change(ui.getByLabelText("City"), {
    target: { value: "Queens" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Back to projects" }));
  fireEvent.click(
    ui
      .getByRole("row", { name: /Nassau Street/ })
      .querySelector('button[title^="Edit"]'),
  );
  fireEvent.click(
    ui.getByRole("button", { name: /Step 3: Where is the site/ }),
  );
  assert.equal(ui.getByLabelText("City").value, "Queens");
  fireEvent.change(ui.getByLabelText("City"), {
    target: { value: " Queens " },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save draft on device" }));
  await ui.findByText(/Draft saved on this device/);
  await waitFor(async () => {
    const saved = await loadWorkspace();
    assert.equal(saved.jobs.length, 1);
    assert.equal(saved.jobs[0].city, "Queens");
  });
  assert.ok(ui.getByLabelText("City"));
  fireEvent.change(ui.getByLabelText("City"), {
    target: { value: "Bronx" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Back to projects" }));
  fireEvent.click(
    ui
      .getByRole("row", { name: /Nassau Street/ })
      .querySelector('button[title^="Edit"]'),
  );
  fireEvent.click(
    ui.getByRole("button", { name: /Step 3: Where is the site/ }),
  );
  assert.equal(ui.getByLabelText("City").value, "Bronx");
  fireEvent.click(ui.getByRole("button", { name: "Save draft on device" }));
  await waitFor(async () => {
    const saved = await loadWorkspace();
    assert.equal(saved.jobs.length, 1);
    assert.equal(saved.jobs[0].city, "Bronx");
  });
  fireEvent.click(ui.getByRole("button", { name: "Back to projects" }));
  assert.equal(
    ui
      .getByRole("row", { name: /Nassau Street/ })
      .textContent.includes("Bronx"),
    true,
  );
  cleanup();
  dom.window.close();
});
