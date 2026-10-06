import React from "react";
import "fake-indexeddb/auto";
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
const { createBackup, inspectBackup, restoreBackup } =
  await import("./backup.js");
const { openLocalDatabase } = await import("./storage.js");
test("a note entered before selecting a project survives device backup and restore", async () => {
  localStorage.clear();
  const db = await openLocalDatabase();
  await db.clear("workspace");
  await db.clear("audio");
  const props = {
    workspace: { jobs: [{ id: "A", title: "A" }], notes: [] },
    selected: "",
    draftScope: "book-a",
    onSelect: () => {},
    onAdd: async () => {},
    onAudio: () => {},
    onRevise: () => {},
    onReview: () => {},
    onCaptureBusy: () => {},
    captureBusy: false,
  };
  let ui = render(<Notes {...props} />);
  try {
    fireEvent.change(ui.getByLabelText("Area"), {
      target: { value: "Android QA" },
    });
    fireEvent.change(ui.getByLabelText("Note"), {
      target: { value: "Unassigned draft — clearance 6 7/16 inches." },
    });
    assert.equal(ui.getByRole("button", { name: "Save note" }).disabled, true);
    const key = "streamlion-draft-v1:book-a:note:";
    const original = localStorage.getItem(key);
    const backup = await createBackup();
    assert.equal((await inspectBackup(backup)).summary.drafts, 1);
    cleanup();
    localStorage.clear();
    await restoreBackup(backup);
    assert.equal(localStorage.getItem(key), original);
    ui = render(<Notes {...props} />);
    assert.equal(ui.getByLabelText("Area").value, "Android QA");
    assert.equal(
      ui.getByLabelText("Note").value,
      "Unassigned draft — clearance 6 7/16 inches.",
    );
    ui.rerender(<Notes {...props} selected="A" />);
    assert.equal(ui.getByLabelText("Note").value, "");
    assert.equal(localStorage.getItem(key), original);
  } finally {
    cleanup();
  }
});
test("a prose note in a Measurements area keeps correction and review controls", async () => {
  localStorage.clear();
  let revised, reviewed;
  const ui = render(
    <Notes
      workspace={{
        jobs: [{ id: "A", title: "Kitchen job" }],
        notes: [
          {
            id: "prose",
            jobId: "A",
            area: "Measurements · Kitchen",
            text: "Check the rear wall after the cabinet moves.",
            reviewed: false,
            createdAt: new Date().toISOString(),
          },
        ],
      }}
      selected="A"
      onSelect={() => {}}
      onAdd={async () => {}}
      onAudio={() => {}}
      onRevise={async (id, text) => {
        revised = { id, text };
      }}
      onReview={async (id) => {
        reviewed = id;
      }}
      onCaptureBusy={() => {}}
      captureBusy={false}
    />,
  );
  assert.ok(ui.getByText("Check the rear wall after the cabinet moves."));
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Mark reviewed", exact: true }),
    ),
  );
  assert.equal(reviewed, "prose");
  fireEvent.click(ui.getByRole("button", { name: "Correct", exact: true }));
  fireEvent.change(ui.getByLabelText("Corrected note"), {
    target: { value: "Cabinet moved; remeasure the wall." },
  });
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Save correction", exact: true }),
    ),
  );
  assert.deepEqual(revised, {
    id: "prose",
    text: "Cabinet moved; remeasure the wall.",
  });
  cleanup();
});
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
