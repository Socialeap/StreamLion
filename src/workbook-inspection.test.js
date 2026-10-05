import test from "node:test";
import assert from "node:assert/strict";
import { inspectWorkbook } from "./workbook-inspection.js";
import {
  PROJECT_HEADERS,
  NOTE_HEADERS,
  makeRevision,
  rowFor,
} from "./workbook.js";
import { validateFields } from "./project-schema.js";
test("inspection reports retry rows without changing private records", () => {
  const a = makeRevision(
    validateFields({ title: "Private customer name" }),
    null,
    "a",
  );
  const values = {
    Projects: [
      PROJECT_HEADERS,
      rowFor(a, PROJECT_HEADERS),
      rowFor(a, PROJECT_HEADERS),
    ],
    Observations: [NOTE_HEADERS],
  };
  const before = JSON.stringify(values),
    report = inspectWorkbook(values);
  assert.equal(report.ready, true);
  assert.equal(report.tabs.Projects.identicalRetryRows, 1);
  assert.equal(JSON.stringify(values), before);
  assert.equal(JSON.stringify(report).includes("Private customer name"), false);
});
test("inspection isolates fork row numbers, catches cross-record duplicates and never resolves them", () => {
  const a = makeRevision(validateFields({ title: "A" }), null, "a"),
    b = makeRevision(validateFields({ title: "B" }), a),
    c = makeRevision(validateFields({ title: "C" }), a);
  const values = {
    Projects: [
      PROJECT_HEADERS,
      rowFor(a, PROJECT_HEADERS),
      rowFor(b, PROJECT_HEADERS),
      rowFor(c, PROJECT_HEADERS),
    ],
    Observations: [NOTE_HEADERS],
  };
  const report = inspectWorkbook(values);
  assert.equal(report.ready, false);
  assert.deepEqual(report.tabs.Projects.issues[0].rows, [2, 3, 4]);
  const substituted = { ...a, recordId: "another" };
  assert.equal(
    inspectWorkbook({
      ...values,
      Projects: [
        PROJECT_HEADERS,
        rowFor(a, PROJECT_HEADERS),
        rowFor(substituted, PROJECT_HEADERS),
      ],
    }).tabs.Projects.issues[0].code,
    "conflicting-revision",
  );
  assert.equal(inspectWorkbook({ Projects: [] }).ready, false);
});
