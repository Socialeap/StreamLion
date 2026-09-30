import test from "node:test";
import assert from "node:assert/strict";
import { newFieldRecord, sendFieldRecord } from "./field-records.js";

test("field file retries retain the same identities after an unknown Sheets outcome", async () => {
  const blob = new Blob(["synthetic"], { type: "audio/webm" });
  let note = newFieldRecord({ jobId: "job", area: "Rear door" }, "book", blob);
  const id = note.id;
  let reserved = 0,
    uploaded = 0,
    saves = 0,
    acked = 0;
  const adapters = {
    getBlob: async () => blob,
    reserveId: async () => {
      reserved++;
      return "drive-file";
    },
    persist: async (value) => {
      note = value;
    },
    retainFile: async (value) => {
      assert.equal(note.driveFileId, value.fileId);
      uploaded++;
      return "https://drive.google.com/file/d/drive-file/view";
    },
    save: async (fields, recordId) => {
      assert.equal(recordId, id);
      assert.equal(fields.audioUrl, note.audioUrl);
      saves++;
      if (saves === 1) throw new Error("Lost acknowledgment");
    },
    acknowledge: async () => {
      acked++;
    },
  };
  await assert.rejects(sendFieldRecord(note, adapters), /Lost acknowledgment/);
  assert.equal(acked, 0);
  await sendFieldRecord(note, adapters);
  assert.equal(reserved, 1);
  assert.equal(uploaded, 1);
  assert.equal(acked, 1);
});
test("identity persisted before an uncertain upload is reused after reload", async () => {
  const blob = new Blob(["photo"], { type: "image/jpeg" });
  let note = newFieldRecord(
    { jobId: "job", area: "Wall", fileName: "wall.jpg" },
    "book",
    blob,
  );
  let reservations = 0,
    acknowledged = false;
  const adapters = {
    getBlob: async () => blob,
    reserveId: async () => {
      reservations++;
      return "same-file";
    },
    persist: async (value) => {
      note = structuredClone(value);
    },
    retainFile: async () => {
      throw new Error("Upload acknowledgment lost");
    },
    save: async () => assert.fail("Must not write without file verification"),
    acknowledge: async () => {
      acknowledged = true;
    },
  };
  await assert.rejects(sendFieldRecord(note, adapters), /acknowledgment lost/);
  assert.equal(note.driveFileId, "same-file");
  await sendFieldRecord(note, {
    ...adapters,
    retainFile: async ({ fileId }) => {
      assert.equal(fileId, "same-file");
      return `https://drive.google.com/file/d/${fileId}/view`;
    },
    save: async () => {},
  });
  assert.equal(reservations, 1);
  assert.equal(acknowledged, true);
});
test("oversize or missing field files fail before an external write; device notes have no Google destination", async () => {
  assert.throws(
    () =>
      newFieldRecord(
        { jobId: "job", area: "Wall" },
        "book",
        new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/jpeg" }),
      ),
    /5 MB/,
  );
  const note = newFieldRecord({
    jobId: "job",
    area: "Wall",
    text: "10 ft 4 3/32 in",
  });
  assert.equal(note.pendingBookId, undefined);
  await assert.rejects(sendFieldRecord(note, {}), /no Google destination/);
});
