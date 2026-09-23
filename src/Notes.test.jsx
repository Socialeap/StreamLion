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
test("draft follows its original project across switches and remounts", async () => {
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
  dom.window.close();
});
