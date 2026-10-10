import test from "node:test";
import assert from "node:assert/strict";
import { requestProgress } from "./request-progress.js";

test("archiving a completed request preserves all recorded milestones", () => {
  const job = {
    state: "closed",
    accepted: { version: 1 },
    openedAt: 1,
    submittedAt: 2,
    workCompletedAt: 3,
    deliveredAt: 4,
    closedAt: 5,
    fields: { agreedFee: "1", paidAmount: "1", paidDate: "2026-10-10" },
  };
  const activity = [{ label: "Job closed", at: 5 }];
  const before = requestProgress(job, null, activity);
  assert.equal(before.filter((s) => s.done).length, 7);
  assert.deepEqual(
    requestProgress({ ...job, state: "archived" }, null, activity),
    before,
  );
});

test("archived declined and cancelled requests do not invent completion milestones", () => {
  for (const accepted of [null, { version: 1 }]) {
    const stages = requestProgress({
      state: "archived",
      accepted,
      openedAt: 1,
      submittedAt: 2,
      closedAt: 3,
      fields: {},
    });
    for (const key of ["work", "delivery", "final"])
      assert.equal(stages.find((s) => s.key === key).done, false);
  }
});

test("reopening clears displayed completion until work is recorded again", () => {
  const stages = requestProgress({
    state: "in_progress",
    accepted: { version: 1 },
    openedAt: 1,
    submittedAt: 2,
    closedAt: null,
    fields: {},
  });
  assert.equal(
    stages.find((s) => s.key === "work").detail,
    "Work is in progress",
  );
  for (const key of ["work", "delivery", "final"])
    assert.equal(stages.find((s) => s.key === key).done, false);
});

test("cancelling after delivery retains work but does not imply finalization", () => {
  const stages = requestProgress(
    {
      state: "archived",
      accepted: { version: 1 },
      workCompletedAt: 3,
      deliveredAt: 4,
      closedAt: 7,
      fields: {},
    },
    null,
    [
      { label: "Job cancelled", at: 7 },
      { label: "Job closed", at: 5 },
    ],
  );
  assert.equal(stages.find((s) => s.key === "work").done, true);
  assert.equal(stages.find((s) => s.key === "delivery").done, true);
  assert.equal(stages.find((s) => s.key === "final").done, false);
});
