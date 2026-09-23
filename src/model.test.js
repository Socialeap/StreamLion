import test from "node:test";
import assert from "node:assert/strict";
import {
  feeCents,
  reviseNote,
  assertWorkspace,
  exportWorkspace,
} from "./model.js";
test("fees preserve cents and distinguish unknown from zero", () => {
  assert.equal(feeCents(""), null);
  assert.equal(feeCents("0"), 0);
  assert.equal(feeCents("250.05"), 25005);
  for (const bad of ["-2", "1.234", "1e3", "$250"])
    assert.throws(() => feeCents(bad));
});
test("correction keeps exact original wording and resets review", () => {
  const original = {
    text: "10 ft 4 3/32 in",
    createdAt: "2026-01-01",
    reviewed: true,
  };
  const next = reviseNote(original, "10 ft 4 1/32 in", "2026-01-02");
  assert.equal(original.text, "10 ft 4 3/32 in");
  assert.equal(next.revisions[0].text, original.text);
  assert.equal(next.reviewed, false);
  assert.throws(() => reviseNote(next, "  ", "now"));
});
test("unsupported stored format fails closed", () => {
  assert.throws(() => assertWorkspace({ version: 2, jobs: [], notes: [] }));
});
test("export preserves raw measurement text and revisions", () => {
  const note = reviseNote(
    { text: "3/32 inch", createdAt: "then" },
    "1/32 inch",
    "now",
  );
  assert.deepEqual(
    JSON.parse(exportWorkspace({ version: 1, jobs: [], notes: [note] })).notes,
    [note],
  );
});
