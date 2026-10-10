import test from "node:test";
import assert from "node:assert/strict";
import {
  newClientJob,
  reduceClientJob,
  readiness,
  clientView,
  DAY,
} from "./client-workflow.js";
const actor = (role) => ({ role });
const initial = () =>
  newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "c@example.com",
    title: "Office capture",
    now: 1000,
  });
const change = (job, action, role = "provider", extra = {}) =>
  reduceClientJob(
    job,
    {
      id: "op-" + job.revision,
      action,
      expectedRevision: job.revision,
      ...extra,
    },
    actor(role),
    2000 + job.revision,
  );
function confirmed() {
  let job = change(initial(), "edit", "client", {
    fields: {
      address: "1 Main St",
      scope: "All three rooms",
      deliverables: "3D tour",
      accessInstructions: "Call on arrival",
    },
  });
  job = change(job, "submit", "client");
  job = change(job, "approve");
  job = change(job, "approve", "client");
  return change(job, "activate", "system");
}
test("required information and both approvals precede system confirmation", () => {
  assert.equal(readiness(initial()).length, 4);
  assert.throws(() => change(initial(), "approve"), /Submit/);
  const job = confirmed();
  assert.equal(job.state, "confirmed");
  assert.equal(job.accepted.scope, "All three rooms");
  assert.throws(() => change(job, "activate", "client"), /verified/);
});
test("agreed scope cannot be silently overwritten; proposal needs both sides", () => {
  const job = confirmed();
  assert.throws(
    () => change(job, "edit", "client", { fields: { scope: "Only one room" } }),
    /Propose/,
  );
  let proposal = change(job, "propose", "client", {
    fields: { scope: "Only one room" },
  });
  assert.equal(proposal.accepted.scope, job.accepted.scope);
  assert.throws(
    () =>
      change(proposal, "accept_proposal", "provider", { proposalId: "old" }),
    /current/,
  );
  proposal = change(proposal, "accept_proposal", "provider", {
    proposalId: proposal.proposal.id,
  });
  assert.equal(proposal.accepted.scope, "Only one room");
  assert.equal(proposal.proposal, null);
});
test("an accepted offered fee changes only through a mutually approved proposal", () => {
  let job = change(initial(), "edit", "provider", {
    fields: { offeredFee: "100.00", currency: "USD" },
  });
  job = change(job, "edit", "client", {
    fields: {
      address: "1 Main St",
      scope: "All three rooms",
      deliverables: "3D tour",
      accessInstructions: "Call on arrival",
    },
  });
  job = change(job, "submit", "client");
  job = change(job, "approve");
  job = change(job, "approve", "client");
  job = change(job, "activate", "system");
  const original = job.accepted.offeredFee;
  assert.throws(
    () => change(job, "edit", "provider", { fields: { offeredFee: "999.00" } }),
    /Propose/,
  );
  assert.throws(
    () => change(job, "edit", "client", { fields: { offeredFee: "999.00" } }),
    { status: 403 },
  );
  let proposed = change(job, "propose", "provider", {
    fields: { offeredFee: "999.00" },
  });
  assert.equal(proposed.accepted.offeredFee, original);
  assert.equal(proposed.fields.offeredFee, original);
  proposed = change(proposed, "accept_proposal", "provider", {
    proposalId: proposed.proposal.id,
  });
  assert.equal(proposed.accepted.offeredFee, original);
  proposed = change(proposed, "accept_proposal", "client", {
    proposalId: proposed.proposal.id,
  });
  assert.equal(proposed.accepted.offeredFee, "999.00");
  assert.equal(proposed.fields.offeredFee, "999.00");
  assert.equal(proposed.id, job.id);
  assert.equal(proposed.state, "confirmed");
});
test("client operational changes block close until acknowledged", () => {
  let job = change(confirmed(), "edit", "client", {
    fields: { accessInstructions: "Use side entrance" },
  });
  assert.equal(readiness(job)[0].kind, "acknowledgment");
  job = change(job, "progress", "provider", { state: "delivered" });
  assert.throws(
    () => change(job, "close", "provider", { reason: "Accepted by phone" }),
    /follow-up/,
  );
  job = change(job, "acknowledge", "provider", { updateId: job.updates[0].id });
  job = change(job, "close", "provider", { reason: "Accepted by phone" });
  assert.equal(job.archiveAt - job.closedAt, 90 * DAY);
  assert.equal(job.finalizedAt, job.closedAt);
  assert.throws(
    () => change(job, "edit", "client", { fields: { notes: "Late" } }),
    /read-only/,
  );
  assert.throws(() => change(job, "archive", "system"), /deadline/);
});
test("completion and delivery are distinct, and newly agreed scope reopens work", () => {
  let job = confirmed();
  assert.throws(
    () => change(job, "progress", "client", { state: "work_completed" }),
    /provider/i,
  );
  job = change(job, "progress", "provider", { state: "work_completed" });
  const completedAt = job.workCompletedAt;
  assert.equal(job.deliveredAt, undefined);
  job = change(job, "progress", "provider", { state: "delivered" });
  assert.equal(job.workCompletedAt, completedAt);
  assert.ok(job.deliveredAt > completedAt);
  job = change(job, "propose", "client", {
    fields: { scope: "Capture one additional room" },
  });
  job = change(job, "accept_proposal", "provider", {
    proposalId: job.proposal.id,
  });
  assert.equal(job.state, "in_progress");
  assert.equal(job.workCompletedAt, undefined);
  assert.equal(job.deliveredAt, undefined);
  job = change(job, "progress", "provider", { state: "work_completed" });
  job = change(job, "progress", "provider", { state: "in_progress" });
  assert.equal(job.workCompletedAt, undefined);
});
test("reopened corrections record a fresh completion and delivery timestamp", () => {
  let job = change(confirmed(), "progress", "provider", {
    state: "work_completed",
  });
  const firstCompletion = job.workCompletedAt;
  job = change(job, "progress", "provider", { state: "delivered" });
  const firstDelivery = job.deliveredAt;
  job = change(job, "accept_delivery", "client");
  job = change(job, "close", "provider");
  assert.equal(job.finalizedAt, job.closedAt);
  job = change(job, "reopen", "provider", { reason: "Correction requested" });
  assert.equal(job.state, "in_progress");
  assert.equal(job.workCompletedAt, undefined);
  assert.equal(job.deliveredAt, undefined);
  assert.equal(job.finalizedAt, undefined);
  assert.equal(job.deliveryAccepted, false);
  job = change(job, "progress", "provider", { state: "work_completed" });
  assert.ok(job.workCompletedAt > firstCompletion);
  const correctedCompletion = job.workCompletedAt;
  job = change(job, "progress", "provider", { state: "delivered" });
  assert.equal(job.workCompletedAt, correctedCompletion);
  assert.ok(job.deliveredAt > firstDelivery);
});
test("stale edits, provider-only fields and private data are rejected or removed", () => {
  const job = confirmed();
  assert.throws(
    () =>
      reduceClientJob(
        job,
        { action: "edit", expectedRevision: 0, fields: { notes: "X" } },
        actor("client"),
        5000,
      ),
    /changed/,
  );
  assert.throws(
    () => change(job, "edit", "client", { fields: { paidAmount: "900" } }),
    /cannot/,
  );
  job.fields.sourceNotes = "Private";
  job.fields.unresolved = "Private";
  job.fields.approxHours = "8";
  job.attachments = [
    { id: "one", visibility: "provider", driveId: "secret" },
    { id: "two", visibility: "client", driveId: "secret2", name: "Plan" },
  ];
  const view = clientView(job);
  assert.equal(view.provider, undefined);
  assert.equal(view.fields.sourceNotes, undefined);
  assert.equal(view.attachments.length, 1);
  assert.equal(view.attachments[0].driveId, undefined);
});
test("a provider proposal needs the client and later access changes invalidate old approvals", () => {
  let job = change(confirmed(), "propose", "provider", {
    fields: { scope: "Lobby only" },
  });
  job = change(job, "accept_proposal", "provider", {
    proposalId: job.proposal.id,
  });
  assert.ok(job.proposal);
  assert.equal(job.accepted.scope, "All three rooms");
  const old = job.proposal.id;
  job = change(job, "edit", "client", {
    fields: { accessInstructions: "Side door" },
  });
  assert.notEqual(job.proposal.id, old);
  assert.equal(job.proposal.fields.accessInstructions, "Side door");
  assert.throws(
    () => change(job, "accept_proposal", "client", { proposalId: old }),
    /current/,
  );
  assert.equal(job.proposal.providerApproved, false);
  assert.equal(job.proposal.clientApproved, false);
});
