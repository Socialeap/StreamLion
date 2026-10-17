import test from "node:test";
import assert from "node:assert/strict";
import { jobMilestones } from "./job-progress.js";

const states = (job) => jobMilestones(job).steps.map((step) => step.state);
test("progress shows only what the job has recorded", () => {
  assert.deepEqual(states({ state: "submitted", fields: {} }), [
    "done",
    "current",
    "next",
    "next",
    "next",
  ]);
  assert.equal(
    jobMilestones({ state: "awaiting_agreement", fields: {} }).steps[1].detail,
    "Waiting for approval",
  );
  const booked = jobMilestones({
    state: "confirmed",
    fields: {
      appointmentStatus: "confirmed",
      startLocal: "2026-11-04T09:30",
      timeZone: "America/Los_Angeles",
    },
  }).steps;
  assert.deepEqual(
    booked.map((step) => step.state),
    ["done", "done", "done", "current", "next"],
  );
  assert.equal(booked[2].detail, "Wed, Nov 4 at 09:30 (America/Los_Angeles)");
  // A proposed time is not a scheduled visit.
  assert.deepEqual(
    states({
      state: "confirmed",
      fields: { appointmentStatus: "proposed", startLocal: "2026-11-04T09:30" },
    }),
    ["done", "done", "current", "next", "next"],
  );
  assert.deepEqual(states({ state: "delivered", fields: {} }), [
    "done",
    "done",
    "done",
    "done",
    "done",
  ]);
  assert.deepEqual(jobMilestones({ state: "declined", fields: {} }), {
    stopped: "The provider declined this request.",
    steps: [],
  });
  assert.deepEqual(jobMilestones({ state: "archived", fields: {} }).steps, []);
});
