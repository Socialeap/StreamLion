import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleJob,
  SAMPLE_BRIEF,
  SAMPLE_WORDING,
  sampleSuggestions,
  applySampleBrief,
  sampleReading,
  sampleLockedRoom,
} from "./landing-job.js";
import { beforeLeaving, measurementEvidence } from "./workflow.js";
import { handoverModel, handoverDocument } from "./handover.js";
function prepared() {
  const job = sampleJob();
  return applySampleBrief(job, {
    ...sampleSuggestions(job.project, SAMPLE_BRIEF),
    reviewed: true,
  });
}
test("one sample carries original requests, exact readings and access follow-up into the actual report", () => {
  let job = prepared();
  assert.equal(job.plan.requirements.length, 5);
  const measurement = job.plan.requirements.find(
    (item) => item.kind === "measurement",
  );
  measurement.state = "done";
  assert.ok(
    beforeLeaving(job.project, job.plan, job.notes).some((item) =>
      item.label.startsWith("Check reading"),
    ),
  );
  const wrongRoom = sampleReading(
    job.project.id,
    "Bedroom",
    SAMPLE_WORDING,
    true,
  );
  assert.ok(
    measurementEvidence(measurement, [wrongRoom], job.project.id).issue,
  );
  const unchecked = sampleReading(job.project.id, "Kitchen", SAMPLE_WORDING);
  assert.ok(
    measurementEvidence(measurement, [unchecked], job.project.id).issue,
  );
  job.notes.push({ ...unchecked, reviewed: true });
  assert.equal(
    measurementEvidence(measurement, job.notes, job.project.id).issue,
    "",
  );
  const task = job.plan.requirements.find((item) => item.kind === "capture");
  job = sampleLockedRoom(job, task.id);
  const model = handoverModel(job.project, job.plan, job.notes);
  const html = handoverDocument(model);
  assert.match(html, /12′ 4 1\/2″/);
  assert.match(html, /Room locked at the visit/);
  assert.match(html, /Ask the site contact for access/);
  assert.match(html, /Harbor House client brief/);
  assert.match(html, /Your Capture Studio/);
  assert.doesNotMatch(html, /<h2>Payment record/);
});
test("modified brief requires explicit review and preserves prior field records", () => {
  let job = prepared();
  job.notes.push(
    sampleReading(job.project.id, "Kitchen", SAMPLE_WORDING, true),
  );
  const draft = sampleSuggestions(
    job.project,
    "Capture Lobby.\nCheck Lobby height.",
  );
  assert.throws(
    () => applySampleBrief(job, draft),
    /Review the suggested tasks/,
  );
  const next = applySampleBrief(job, { ...draft, reviewed: true });
  assert.equal(next.notes, job.notes);
  assert.equal(next.plan.requirements.length, 2);
  assert.ok(next.plan.requirements.every((item) => item.area === "Lobby"));
});
test("unorganized or ambiguous readings cannot enter the reviewed sample", () => {
  assert.throws(
    () => sampleReading("p", "", SAMPLE_WORDING, true),
    /Name the room/,
  );
  assert.throws(
    () => sampleReading("p", "Kitchen", "Length twelve.", true),
    /unclear wording/,
  );
});
