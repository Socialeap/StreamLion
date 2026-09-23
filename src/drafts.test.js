import test from "node:test";
import assert from "node:assert/strict";
import { readDraft, writeDraft, clearSavedDraft } from "./drafts.js";
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
test("recovered saves clear only their unchanged draft, preserving newer work", () => {
  const operation = {
    tab: "Projects",
    expected: null,
    revision: { recordId: "A", title: "Saved" },
  };
  writeDraft("book:project:new", { fields: { title: "Newer draft" } });
  clearSavedDraft("book", operation);
  assert.equal(readDraft("book:project:new").fields.title, "Newer draft");
  writeDraft("book:project:new", { fields: { title: "Saved" } });
  clearSavedDraft("book", operation);
  assert.equal(readDraft("book:project:new"), null);
  const note = {
    tab: "Observations",
    expected: null,
    revision: { projectId: "A", area: "Wall", text: "Saved note" },
  };
  writeDraft("book:note:A", { area: "Wall", text: "New note" });
  clearSavedDraft("book", note);
  assert.equal(readDraft("book:note:A").text, "New note");
  writeDraft("book:note:A", { area: " Wall ", text: "Saved note" });
  clearSavedDraft("book", { ...note, expected: { revisionId: "old" } });
  assert.ok(
    readDraft("book:note:A"),
    "correcting an earlier note must not discard the new-note draft",
  );
  clearSavedDraft("book", note);
  assert.equal(readDraft("book:note:A"), null);
});
