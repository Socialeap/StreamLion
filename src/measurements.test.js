import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMeasurements,
  measurementSet,
  MEASUREMENT_KIND,
  measurementText,
  connectedTotals,
  readMeasurement,
  measurementNeedsReview,
  isMeasurementRecord,
} from "./measurements.js";
import { projectContext, readWorkflow, deliverySummary } from "./workflow.js";
import { newFieldRecord } from "./field-records.js";
const makeSet = (raw) => ({
  kind: MEASUREMENT_KIND,
  version: 1,
  room: "Office 2",
  floor: "Ground floor",
  side: "Interior",
  enteredAt: "2026-09-30T12:00:00Z",
  raw,
  ...parseMeasurements(raw),
});

test("every accepted full metric spelling exposes an extra dimension in descriptions", () => {
  for (const unit of [
    "millimeter",
    "millimeters",
    "millimetre",
    "millimetres",
    "centimeter",
    "centimeters",
    "centimetre",
    "centimetres",
    "meter",
    "meters",
    "metre",
    "metres",
    "mm",
    "cm",
    "m",
  ]) {
    assert.equal(parseMeasurements(`Length 6 ${unit}`).issues.length, 0, unit);
    for (const amount of ["6", "six"]) {
      const parsed = parseMeasurements(`Length 12 ft then ${amount} ${unit}`);
      assert.equal(parsed.entries.length, 0, `${amount} ${unit}`);
      assert.match(parsed.issues[0].message, /Another dimension/, unit);
    }
  }
  assert.equal(
    parseMeasurements("Length 12 ft to wall in office").issues.length,
    0,
  );
});

test("area prefixes do not classify prose while genuine malformed payloads remain flagged", () => {
  for (const text of [
    "Check the tape reading again.",
    "A streamlion.measurements note is not an organized batch.",
    JSON.stringify({ description: MEASUREMENT_KIND }),
  ]) {
    const note = { area: "Measurements · Kitchen", text };
    assert.equal(isMeasurementRecord(note), false);
    assert.equal(readMeasurement(note), null);
    assert.equal(measurementText(note), text);
    assert.equal(measurementNeedsReview(note), false);
  }
  const damaged = {
    area: "Kitchen",
    text: '{"kind":"streamlion.measurements","version":1,',
  };
  assert.equal(isMeasurementRecord(damaged), true);
  assert.throws(() => readMeasurement(damaged), /Unreadable/);
  assert.equal(measurementNeedsReview(damaged), true);
  const overwritten = {
    text: "Accidentally replaced the JSON",
    sourceText: JSON.stringify(makeSet("Width 10 ft")),
  };
  assert.equal(isMeasurementRecord(overwritten), true);
  assert.equal(measurementNeedsReview(overwritten), true);
});

test("dictated imperial batches retain exact fractions, descriptions and originals", () => {
  const raw =
    "Length twelve feet four and three eighths inches. Width ten feet six inches. Ceiling eight feet nine inches to underside of beam.";
  const set = measurementSet(makeSet(raw));
  assert.equal(set.entries.length, 3);
  assert.equal(set.entries[0].display, "12′ 4 3/8″");
  assert.deepEqual(set.entries[0].amount, { n: 1187, d: 8 });
  assert.equal(set.entries[2].detail, "to underside of beam");
  assert.equal(set.raw, raw);
  const fraction = parseMeasurements(
    "Length 10 ft 4 3/32 in. Width 4 inches 1/32. Ceiling eight feet six and one thirty second inches.",
  );
  assert.equal(fraction.issues.length, 0);
  assert.equal(fraction.entries[0].display, "10′ 4 3/32″");
  assert.equal(fraction.entries[1].display, "4 1/32 in");
  assert.equal(fraction.entries[2].display, "8′ 6 1/32″");
});
test("metric decimals and digit-after-point speech remain exact, without floating arithmetic", () => {
  const parsed = parseMeasurements(
    "Length two point zero five meters. Width 245.50 cm. Height 2031 mm.",
  );
  assert.equal(parsed.issues.length, 0);
  assert.equal(parsed.entries[0].display, "2.05 m");
  assert.deepEqual(parsed.entries[0].amount, { n: 2050, d: 1 });
  assert.equal(parsed.entries[1].display, "245.50 cm");
  assert.equal(parsed.entries[1].amount.n, 2455);
});
test("ambiguous units, extra dimensions and bad fractions stay unresolved", () => {
  for (const raw of [
    "Length 12",
    "Length one two feet",
    "Length twenty thirty feet",
    "Width five inches 1/0",
    "Length minus five feet",
    "Length 1 ft 14 in",
    "Segment 2/1 m",
    "Length 12 ft then turns right 6 ft",
    "Length 12 ft then turns right six in",
    "Length 12 ft then continues 2 m",
    'Length 12 ft then turns 6"',
    "Continuing 5 ft",
    "Office 2. Length 10 ft",
  ])
    assert.ok(parseMeasurements(raw).issues.length, raw);
  assert.throws(() => parseMeasurements("a".repeat(3001)), /shorter/);
});
test("only explicit connected segments form measured-run totals; links and values are validated", () => {
  const raw = "Segment 12 ft 4 1/32 in. Continuing 6 ft 8 in. Width 10 ft.";
  const set = measurementSet(makeSet(raw));
  assert.equal(set.entries[1].continues, set.entries[0].id);
  assert.match(
    connectedTotals(set.entries)[0],
    /2 connected segments: 228 1\/32 in/,
  );
  assert.equal(
    connectedTotals(parseMeasurements("Length 10 ft. Width 8 ft.").entries)
      .length,
    0,
  );
  assert.equal(
    parseMeasurements("Length 10 ft. Continuing 2 m.").issues.length,
    1,
  );
  const changed = structuredClone(set);
  changed.entries[0].amount.n++;
  assert.throws(() => measurementSet(changed), /original reading/);
  const link = structuredClone(set);
  link.entries[1].continues = "missing";
  assert.throws(() => measurementSet(link), /original reading/);
});
test("measurement records reach existing Google journal, Ask and delivery as readable exact evidence", () => {
  const set = makeSet("Width 10 ft 4 3/32 in");
  const note = newFieldRecord(
    {
      jobId: "job",
      area: "Measurements · Office 2",
      text: JSON.stringify(set),
      reviewed: true,
    },
    "book-a",
  );
  assert.equal(note.pendingBookId, "book-a");
  assert.equal(note.reviewed, true);
  const project = { id: "job", title: "Synthetic job" },
    plan = readWorkflow([note], project);
  assert.match(measurementText(note), /Width: 10′ 4 3\/32″/);
  assert.match(
    projectContext(project, plan, [note], "test").fieldNotes[0].text,
    /Width: 10′/,
  );
  assert.match(deliverySummary(project, plan, [note]), /Width: 10′/);
  const corrupt = { ...note, text: JSON.stringify({ ...set, version: 99 }) };
  assert.throws(() => readMeasurement(corrupt), /Unsupported/);
  assert.equal(measurementNeedsReview(corrupt), true);
  assert.match(measurementText(corrupt), /MEASUREMENTS NEED REVIEW/);
  assert.ok(measurementText(corrupt).includes(corrupt.text));
  assert.match(
    projectContext(project, plan, [corrupt], "test").fieldNotes[0].text,
    /MEASUREMENTS NEED REVIEW/,
  );
});
