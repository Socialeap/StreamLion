import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadWorkspace,
  saveWorkspace,
  saveAudioNote,
  getAudio,
  saveSiteCopy,
  loadSiteCopy,
  removeSiteCopy,
} from "./storage.js";
import { makeRevision } from "./workbook.js";
import { validateFields } from "./project-schema.js";
test("local journal survives reload and rejects stale writes without overwriting", async () => {
  const initial = await loadWorkspace();
  const first = {
    ...initial,
    revision: 1,
    jobs: [{ id: "test-job", title: "Synthetic" }],
  };
  await saveWorkspace(first);
  assert.deepEqual(await loadWorkspace(), first);
  await assert.rejects(
    saveWorkspace({ ...initial, revision: 1, jobs: [] }),
    /another tab/,
  );
  assert.deepEqual(await loadWorkspace(), first);
  const audio = new Blob(["synthetic audio"], { type: "audio/webm" });
  const withNote = {
    ...first,
    revision: 2,
    notes: [
      { id: "note", audioId: "clip", jobId: "test-job", area: "Office 1" },
    ],
  };
  await saveAudioNote(withNote, "clip", audio);
  assert.deepEqual(await loadWorkspace(), withNote);
  assert.equal(await (await getAudio("clip")).text(), "synthetic audio");
  await assert.rejects(
    saveAudioNote({ ...first, revision: 2 }, "orphan", audio),
    /another tab/,
  );
  assert.equal(await getAudio("orphan"), undefined);
});
test("site copies survive reload, are partitioned by workbook, and omit unrelated data", async () => {
  const project = makeRevision(
    validateFields({ title: "Offline synthetic job" }),
    null,
    "job",
  );
  const copy = await saveSiteCopy("book-a", {
    Projects: [{ ...project, access_token: "must-not-retain" }],
    Observations: [],
    token: "must-not-retain",
  });
  assert.equal(
    (await loadSiteCopy("book-a")).data.Projects[0].title,
    "Offline synthetic job",
  );
  assert.equal(await loadSiteCopy("book-b"), null);
  assert.equal(JSON.stringify(copy).includes("must-not-retain"), false);
  await assert.rejects(
    saveSiteCopy("book-b", {
      Projects: [{ ...project, revisionId: "" }],
      Observations: [],
    }),
    /identity/,
  );
  assert.equal(await loadSiteCopy("book-b"), null);
  await removeSiteCopy("book-a");
  assert.equal(await loadSiteCopy("book-a"), null);
});
