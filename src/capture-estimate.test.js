import test from "node:test";
import assert from "node:assert/strict";
import { captureEstimate, TM_ESTIMATE } from "./capture-estimate.js";
import { requestProgress } from "./request-progress.js";
import { newClientJob, reduceClientJob } from "./client-workflow.js";
test("provider-selected estimate uses verified reference boundaries and never returns an unknown-area zero quote", () => {
  for (const [area, rate] of [
    [1, 15],
    [5000, 15],
    [5001, 12],
    [19999, 12],
    [20000, 10],
    [999999999, 10],
  ]) {
    const e = captureEstimate(TM_ESTIMATE, String(area), true);
    assert.equal(e.captureCents, area * rate);
    assert.equal(e.totalCents, area * rate + 90000);
  }
  for (const area of ["", 0, "5000.5", "-1", "1e6", "1000000000"])
    assert.equal(captureEstimate(TM_ESTIMATE, area), null);
  assert.equal(captureEstimate("", "1000"), null);
});
test("milestones retain honest parallel payment and work progress and cannot finalize a cancelled request", () => {
  let job = newClientJob({
    id: "job-progress",
    provider: "a",
    clientEmail: "",
    title: "",
    prospect: true,
    now: 1,
  });
  assert.equal(requestProgress(job, { openedAt: null })[0].done, false);
  assert.equal(
    requestProgress(job, { openedAt: 2 })[0].detail,
    "Form opened · visitor unverified",
  );
  job.fields = {
    ...job.fields,
    paidAmount: "50",
    agreedFee: "100",
    paidDate: "2026-10-08",
  };
  assert.equal(requestProgress(job)[4].done, false);
  job.fields.paidAmount = "100";
  assert.equal(requestProgress(job)[4].done, true);
  job.state = "cancelled";
  assert.equal(requestProgress(job).at(-1).done, false);
});
test("verified request can defer title but cannot agree until a formal name exists", () => {
  const job = newClientJob({
    id: "job-claim",
    provider: "a",
    clientEmail: "",
    title: "",
    prospect: true,
    now: 1,
  });
  const command = {
    action: "claim_request",
    expectedRevision: 0,
    email: "client@example.com",
    openedAt: 2,
    fields: {
      requesterName: "Client",
      address: "Synthetic site",
      scope: "Capture",
      deliverables: "Tour",
      accessInstructions: "Arrange access",
    },
  };
  assert.throws(
    () => reduceClientJob(job, command, { role: "client" }, 3),
    /verified identity/,
  );
  const claimed = reduceClientJob(job, command, { role: "system" }, 3);
  assert.equal(claimed.fields.title, "");
  assert.equal(claimed.fields.requesterEmail, "client@example.com");
  assert.equal(claimed.state, "submitted");
  assert.throws(
    () =>
      reduceClientJob(
        claimed,
        { action: "approve", expectedRevision: 1 },
        { role: "client" },
        4,
      ),
    /Resolve required/,
  );
});
test("verified claims allow prepared pre-agreement states but never retain approvals or bypass identity guards", () => {
  const initial = newClientJob({
    id: "prepared-claim",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Provider starting name",
    prospect: true,
    now: 1,
  });
  const command = {
    action: "claim_request",
    expectedRevision: 0,
    email: "client@example.com",
    openedAt: 2,
    fields: {
      scope: "Prospect's revised scope",
      requesterName: "Verified prospect",
    },
  };
  for (const state of [
    "draft",
    "submitted",
    "clarification",
    "awaiting_agreement",
  ]) {
    const job = {
      ...initial,
      state,
      providerApproved: true,
      clientApproved: true,
    };
    const claimed = reduceClientJob(job, command, { role: "system" }, 3);
    assert.equal(claimed.state, "submitted");
    assert.equal(claimed.fields.scope, command.fields.scope);
    assert.equal(claimed.fields.title, initial.fields.title);
    assert.equal(claimed.providerApproved, false);
    assert.equal(claimed.clientApproved, false);
    assert.equal(claimed.accepted, null);
    for (const role of ["provider", "client"])
      assert.throws(
        () => reduceClientJob(job, command, { role }, 3),
        /verified identity/,
      );
    assert.throws(
      () =>
        reduceClientJob(
          job,
          { ...command, email: "other@example.com" },
          { role: "system" },
          3,
        ),
      /verified identity/,
    );
  }
  for (const state of [
    "activation_pending",
    "confirmed",
    "in_progress",
    "work_completed",
    "delivered",
    "closed",
    "cancelled",
    "archived",
  ])
    assert.throws(() =>
      reduceClientJob({ ...initial, state }, command, { role: "system" }, 3),
    );
  assert.throws(
    () =>
      reduceClientJob(
        { ...initial, accepted: { ...initial.fields } },
        command,
        { role: "system" },
        3,
      ),
    /verified identity/,
  );
});
