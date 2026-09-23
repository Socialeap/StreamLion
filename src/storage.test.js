import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadWorkspace,
  saveWorkspace,
  saveAudioNote,
  getAudio,
} from "./storage.js";
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
