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
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: Notes } = await import("./Notes.jsx");
const { writeDraft } = await import("./drafts.js");
test("draft follows its original project across switches and remounts", async () => {
  localStorage.clear();
  let saved;
  const props = {
    workspace: {
      jobs: [
        { id: "A", title: "A" },
        { id: "B", title: "B" },
      ],
      notes: [],
    },
    selected: "A",
    onSelect: () => {},
    onAdd: async (n) => {
      saved = n;
    },
    onAudio: () => {},
    onRevise: () => {},
    onReview: () => {},
    onCaptureBusy: () => {},
    captureBusy: false,
  };
  let ui = render(<Notes {...props} />);
  fireEvent.change(ui.getByLabelText("Area"), {
    target: { value: "Room in A" },
  });
  fireEvent.change(ui.getByLabelText("Note"), { target: { value: "Draft A" } });
  ui.rerender(<Notes {...props} selected="B" />);
  assert.equal(ui.getByLabelText("Note").value, "");
  assert.equal(ui.getByLabelText("Area").value, "");
  cleanup();
  ui = render(<Notes {...props} />);
  assert.equal(ui.getByLabelText("Note").value, "Draft A");
  await act(async () => fireEvent.click(ui.getByText("Save note")));
  assert.equal(saved.jobId, "A");
  assert.equal(saved.text, "Draft A");
  cleanup();
  ui = render(<Notes {...props} />);
  assert.equal(ui.getByLabelText("Note").value, "");
  cleanup();
});
test("evidence hints cannot replace another project's or workbook's saved area", async () => {
  localStorage.clear();
  writeDraft("book:note:B", {
    area: "B roof",
    text: "B measurement 31 3/8 in",
  });
  writeDraft("other-book:note:A", {
    area: "Other site",
    text: "Other workbook draft",
  });
  let saved;
  const props = {
    workspace: {
      jobs: [
        { id: "A", title: "A" },
        { id: "B", title: "B" },
      ],
      notes: [],
    },
    selected: "A",
    draftScope: "book",
    initialArea: { projectId: "A", scope: "book", area: "A rear door" },
    onSelect: () => {},
    onAdd: async (note) => {
      saved = note;
    },
    onAudio: () => {},
    onRevise: () => {},
    onReview: () => {},
    onCaptureBusy: () => {},
    captureBusy: false,
  };
  const ui = render(<Notes {...props} />);
  assert.equal(ui.getByLabelText("Area").value, "A rear door");
  fireEvent.change(ui.getByLabelText("Area"), { target: { value: "A lobby" } });
  fireEvent.change(ui.getByLabelText("Note"), {
    target: { value: "Unfinished A" },
  });
  ui.rerender(<Notes {...props} selected="B" />);
  assert.equal(ui.getByLabelText("Area").value, "B roof");
  assert.equal(ui.getByLabelText("Note").value, "B measurement 31 3/8 in");
  await act(async () => fireEvent.click(ui.getByText("Save note")));
  assert.equal(saved.jobId, "B");
  assert.equal(saved.area, "B roof");
  ui.rerender(<Notes {...props} initialArea={null} />);
  assert.equal(ui.getByLabelText("Area").value, "A lobby");
  assert.equal(ui.getByLabelText("Note").value, "Unfinished A");
  ui.rerender(<Notes {...props} draftScope="other-book" />);
  assert.equal(ui.getByLabelText("Area").value, "Other site");
  assert.equal(ui.getByLabelText("Note").value, "Other workbook draft");
  cleanup();
});
test.after(() => dom.window.close());
