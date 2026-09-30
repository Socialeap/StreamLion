import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_AREA,
  readWorkflow,
  validateWorkflow,
  requirementsFromBrief,
  beforeLeaving,
  paymentSummary,
  reusableFields,
  projectContext,
  deliverySummary,
} from "./workflow.js";

const project = {
  id: "job",
  title: "Synthetic optometry",
  companyName: "Client",
  reference: "ORIGINAL-001",
  deliverables: "- Capture all rooms\n- Measure rear door",
  scope: "10 ft 4 3/32 in",
  currency: "USD",
  agreedFee: "250.50",
  invoiceAmount: "250.50",
  paidAmount: "0",
  startLocal: "2026-10-02T09:00",
  timeZone: "America/New_York",
  contact1Phone: "123",
  driveFolderUrl: "https://drive.google.com/drive/folders/previous-visit",
};
test("checklist retains requests, requires exception reasons, and warns when the brief changes", () => {
  const plan = readWorkflow([], project);
  plan.requirements = requirementsFromBrief(project);
  assert.deepEqual(
    plan.requirements.map((item) => item.label),
    ["Capture all rooms", "Measure rear door"],
  );
  plan.requirements[0].state = "blocked";
  assert.throws(() => validateWorkflow(plan), /Explain why/);
  plan.requirements[0].reason = "Rear room locked; customer notified";
  assert.doesNotThrow(() => validateWorkflow(plan));
  assert.ok(
    beforeLeaving({ ...project, scope: "Changed brief" }, plan, []).some(
      (item) => item.label === "Review the changed brief",
    ),
  );
  assert.ok(
    beforeLeaving(project, plan, []).some((item) => item.state === "blocked"),
  );
  assert.throws(
    () =>
      requirementsFromBrief({
        deliverables: Array(41).fill("Room").join("\n"),
      }),
    /shorter checklist/,
  );
});
test("missing evidence and pending field records remain explicit before leaving", () => {
  const plan = readWorkflow([], project);
  plan.requirements = [
    {
      ...requirementsFromBrief(project)[0],
      state: "done",
      evidence: ["missing"],
    },
  ];
  const warnings = beforeLeaving(project, plan, [
    { id: "note", jobId: "job", pendingBookId: "book", reviewed: true },
  ]);
  assert.ok(warnings.some((item) => /unavailable/.test(item.detail)));
  assert.ok(warnings.some((item) => /field record/.test(item.label)));
});
test("unknown received amount is not treated as zero, and payment totals preserve cents", () => {
  assert.equal(paymentSummary(project).outstanding, "$250.50");
  assert.equal(
    paymentSummary({ ...project, paidAmount: "" }).outstanding,
    "Not enough information",
  );
  assert.equal(
    paymentSummary({ ...project, paidAmount: "300" }).overpaid,
    true,
  );
});
test("repeat visits and client defaults never copy references, appointments, or transaction amounts", () => {
  const repeat = reusableFields(project),
    client = reusableFields(project, true);
  assert.equal(repeat.contact1Phone, "123");
  for (const key of [
    "reference",
    "startLocal",
    "endLocal",
    "agreedFee",
    "invoiceAmount",
    "paidAmount",
    "driveFolderUrl",
  ]) {
    assert.equal(repeat[key], undefined);
    assert.equal(client[key], undefined);
  }
  assert.equal(client.scope, project.scope);
  assert.equal(client.contact1Phone, undefined);
});
test("chat snapshot contains actual project data and exact observations, with no metadata row in notes", () => {
  const plan = readWorkflow([], project);
  const notes = [
    {
      id: "meta",
      jobId: "job",
      area: WORKFLOW_AREA,
      text: JSON.stringify(plan),
    },
    {
      id: "n",
      jobId: "job",
      area: "Door",
      text: "10 ft 4 3/32 in",
      sourceText: "10 ft 4 3/32 in",
      pendingBookId: "book",
    },
  ];
  const snapshot = projectContext(project, plan, notes, "2026-09-30T12:00:00Z");
  assert.equal(snapshot.fields.reference, "ORIGINAL-001");
  assert.equal(snapshot.fieldNotes.length, 1);
  assert.equal(snapshot.fieldNotes[0].text, "10 ft 4 3/32 in");
  assert.equal(snapshot.fieldNotes[0].waitingForGoogle, true);
  assert.equal(snapshot.snapshotOnly, true);
  plan.siteLessons = "Rear room locked; customer agreed a return visit";
  const handover = deliverySummary(project, plan, notes);
  assert.match(handover, /10 ft 4 3\/32 in/);
  assert.match(handover, /customer agreed a return visit/);
  assert.match(handover, /waiting to reach Google/);
  assert.doesNotMatch(handover, /streamlion\.workflow/);
  assert.match(handover, /not an automatic verification/);
});
test("unsupported or duplicate checklist records fail visibly without choosing an arbitrary winner", () => {
  assert.throws(
    () =>
      readWorkflow(
        [{ jobId: "job", area: WORKFLOW_AREA, text: "invalid" }],
        project,
      ),
    /original record/,
  );
  assert.throws(
    () =>
      readWorkflow(
        [
          { jobId: "job", area: WORKFLOW_AREA },
          { jobId: "job", area: WORKFLOW_AREA },
        ],
        project,
      ),
    /More than one/,
  );
});
