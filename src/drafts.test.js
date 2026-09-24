import test from "node:test";
import assert from "node:assert/strict";
import {
  readDraft,
  writeDraft,
  clearSavedDraft,
  listProjectDrafts,
  projectDraftKey,
} from "./drafts.js";
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
  key: (index) => [...values.keys()][index] ?? null,
  get length() {
    return values.size;
  },
};
test("named drafts are listed by workbook and preserve legacy new drafts", () => {
  values.clear();
  writeDraft(projectDraftKey("local", "new"), {
    fields: { title: "Earlier draft", city: "Brooklyn" },
  });
  writeDraft(projectDraftKey("local", "draft-one"), {
    fields: { title: "Next job", city: "Queens" },
  });
  writeDraft(projectDraftKey("local", "draft-untitled"), {
    fields: { title: "" },
  });
  writeDraft(projectDraftKey("other-book", "draft-other"), {
    fields: { title: "Other book" },
  });
  assert.deepEqual(
    listProjectDrafts("local").map(({ draftId, fields }) => [
      draftId,
      fields.title,
    ]),
    [
      ["new", "Earlier draft"],
      ["draft-one", "Next job"],
    ],
  );
  assert.equal(listProjectDrafts("other-book").length, 1);
  writeDraft(projectDraftKey("local", "draft-one"), {
    fields: { title: "Next job", city: "Queens" },
    deletedAt: "2026-09-24T00:00:00Z",
  });
  assert.equal(listProjectDrafts("local").length, 1);
  assert.equal(
    listProjectDrafts("local", { deleted: true })[0].draftId,
    "draft-one",
  );
});
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
  writeDraft(projectDraftKey("book", "draft-abc"), {
    fields: { title: "Saved" },
  });
  clearSavedDraft("book", {
    ...operation,
    draftKey: projectDraftKey("book", "draft-abc"),
  });
  assert.equal(readDraft(projectDraftKey("book", "draft-abc")), null);
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
