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
window.scrollTo = () => {};
const { render, fireEvent, waitFor, cleanup } =
  await import("@testing-library/react");
const { default: App } = await import("./App.jsx");
const { saveSiteCopy, loadWorkspace } = await import("./storage.js");
const { makeRevision } = await import("./workbook.js");
const { validateFields } = await import("./project-schema.js");

test("offline Google site copy opens project home and keeps new field notes pinned to that workbook across reload", async () => {
  localStorage.setItem("streamlion-selected-workbook-v1", "book-a");
  await saveSiteCopy("book-a", {
    Projects: [
      makeRevision(
        validateFields({
          title: "Synthetic site copy",
          address: "123 Example",
          city: "Brooklyn",
          accessInstructions: "Meet the manager",
          deliverables: "Measure rear door",
        }),
        null,
        "job",
      ),
    ],
    Observations: [],
  });
  let ui = render(<App />);
  fireEvent.click(
    await ui.findByRole("button", { name: "Synthetic site copy" }),
  );
  assert.ok(ui.getByText("Meet the manager"));
  assert.match(
    ui.getByRole("link", { name: "Directions" }).href,
    /destination=123/,
  );
  fireEvent.click(ui.getByRole("button", { name: "2. On site" }));
  fireEvent.click(ui.getByRole("button", { name: "Add a field record" }));
  fireEvent.change(ui.getByLabelText("Area"), {
    target: { value: "Rear door" },
  });
  fireEvent.change(ui.getByLabelText("Note"), {
    target: { value: "10 ft 4 3/32 in" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save note" }));
  await waitFor(async () => {
    const notes = (await loadWorkspace()).notes;
    assert.equal(notes.length, 1);
    assert.equal(notes[0].pendingBookId, "book-a");
    assert.equal(notes[0].text, "10 ft 4 3/32 in");
  });
  assert.equal(
    ui.getByRole("button", { name: "Send waiting records to Google" }).disabled,
    true,
  );
  cleanup();
  ui = render(<App />);
  fireEvent.click(
    await ui.findByRole("button", { name: "Synthetic site copy" }),
  );
  fireEvent.click(ui.getByRole("button", { name: "2. On site" }));
  fireEvent.click(ui.getByRole("button", { name: "Add a field record" }));
  assert.ok(await ui.findByText("10 ft 4 3/32 in"));
  fireEvent.click(ui.getByRole("button", { name: "Projects", exact: true }));
  window.confirm = () => true;
  fireEvent.click(ui.getByRole("button", { name: "Delete", exact: true }));
  assert.match((await ui.findByRole("alert")).textContent, /Reconnect Google/);
  assert.ok(ui.getByRole("button", { name: "Synthetic site copy" }));
  cleanup();
  localStorage.setItem("streamlion-selected-workbook-v1", "different-book");
  ui = render(<App />);
  await ui.findByRole("heading", { name: "Projects" });
  assert.equal(ui.queryByText("Synthetic site copy"), null);
  assert.equal(
    ui.queryByRole("region", { name: "Waiting field records" }),
    null,
  );
  assert.equal((await loadWorkspace()).notes[0].pendingBookId, "book-a");
  cleanup();
});
test.after(() => dom.window.close());
