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
  fireEvent.click(
    ui.getAllByRole("button", { name: "Measurements", exact: true })[0],
  );
  fireEvent.change(ui.getByLabelText("Room or exterior area"), {
    target: { value: "Office 2" },
  });
  fireEvent.change(ui.getByLabelText("Dictate or type measurements"), {
    target: { value: "Length 10 ft 4 1/32 in. Width 3.05 m." },
  });
  fireEvent.click(ui.getByRole("button", { name: "Organize measurements" }));
  fireEvent.click(
    ui.getByRole("button", { name: "Save unreviewed measurements" }),
  );
  await waitFor(async () => {
    const notes = (await loadWorkspace()).notes;
    assert.equal(notes.length, 2);
    assert.equal(notes[1].pendingBookId, "book-a");
    const measurement = JSON.parse(notes[1].text);
    assert.equal(measurement.room, "Office 2");
    assert.equal(measurement.entries[0].display, "10′ 4 1/32″");
    assert.equal(measurement.entries[1].display, "3.05 m");
  });
  cleanup();
  ui = render(<App />);
  fireEvent.click(
    await ui.findByRole("button", { name: "Synthetic site copy" }),
  );
  fireEvent.click(ui.getByRole("button", { name: "2. On site" }));
  fireEvent.click(
    ui.getAllByRole("button", { name: "Measurements", exact: true })[0],
  );
  assert.ok(ui.getByRole("heading", { name: "Office 2" }));
  assert.ok(ui.getByText(/Width: 3.05 m/));
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
