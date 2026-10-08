import test from "node:test";
import assert from "node:assert/strict";
import {
  reviseIntakeTemplate,
  selectedIntakeTemplate,
  validateIntakeConfig,
  INTAKE_PRESETS,
} from "./intake-templates.js";
import {
  newClientJob,
  reduceClientJob,
  readiness,
  clientView,
} from "./client-workflow.js";
const template = (config = INTAKE_PRESETS[0]) =>
  reviseIntakeTemplate(
    null,
    {
      id: "intake-capture",
      provider: "a",
      expectedVersion: 0,
      config,
    },
    1000,
  );
const jobFor = (record) =>
  newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Office",
    now: 2000,
    intakeTemplate: record,
  });
const change = (job, action, fields, role = "client") =>
  reduceClientJob(
    job,
    {
      id: "op-" + job.revision,
      action,
      expectedRevision: job.revision,
      ...(fields ? { fields } : {}),
    },
    { role },
    3000 + job.revision,
  );
test("saved versions are immutable request defaults, including a retry after the service changes", () => {
  const first = template(),
    olderJob = jobFor(first);
  const second = reviseIntakeTemplate(
    first,
    {
      id: first.id,
      provider: "a",
      expectedVersion: 1,
      config: {
        ...first.config,
        defaults: { deliverables: "New outputs" },
        name: "Updated service",
      },
    },
    4000,
  );
  const snapshot = {
    events: new Map([
      ["one", { jobId: first.id, revision: 0, job: first }],
      ["two", { jobId: second.id, revision: 1, job: second }],
    ]),
  };
  const retried = jobFor(
    selectedIntakeTemplate(snapshot, { id: first.id, version: 1 }, "a"),
  );
  assert.deepEqual(retried, olderJob);
  assert.equal(jobFor(second).fields.deliverables, "New outputs");
  assert.equal(olderJob.intake.name, "3D capture");
  assert.equal(olderJob.intake.version, 1);
  assert.equal(olderJob.fields.offeredFee, "");
  assert.throws(
    () => selectedIntakeTemplate(snapshot, { id: first.id, version: 1 }, "b"),
    /unavailable/,
  );
  assert.throws(() => jobFor({ ...first, provider: "b" }), /another provider/);
  assert.throws(
    () =>
      reviseIntakeTemplate(
        second,
        {
          id: first.id,
          provider: "a",
          expectedVersion: 1,
          config: first.config,
        },
        5000,
      ),
    /changed/,
  );
});
test("templates reject private identities, receipts, unsupported questions, conditions and cycles", () => {
  for (const field of [
    "requesterEmail",
    "address",
    "sourceNotes",
    "paidAmount",
    "agreedFee",
  ])
    assert.throws(
      () =>
        validateIntakeConfig({
          ...INTAKE_PRESETS[0],
          defaults: { [field]: "Private" },
        }),
      /Unsupported/,
    );
  for (const field of [
    "paidAmount",
    "sourceNotes",
    "requesterEmail",
    "__proto__",
  ])
    assert.throws(
      () =>
        validateIntakeConfig({
          name: "Service",
          questions: [{ field, label: "Q", required: false }],
        }),
      /client-editable/,
    );
  assert.throws(
    () =>
      validateIntakeConfig({
        name: "Service",
        questions: [
          {
            field: "scope",
            label: "Scope",
            required: true,
            when: { field: "country", op: "equals", value: "US" },
          },
        ],
      }),
    /core required/,
  );
  assert.throws(
    () =>
      validateIntakeConfig({
        name: "Service",
        questions: [
          {
            field: "notes",
            label: "A",
            required: false,
            when: { field: "exclusions", op: "not_empty" },
          },
          {
            field: "exclusions",
            label: "B",
            required: false,
            when: { field: "notes", op: "not_empty" },
          },
        ],
      }),
    /cycle/,
  );
  assert.throws(
    () =>
      validateIntakeConfig({
        name: "Service",
        defaults: { offeredFee: "100" },
        questions: [],
      }),
    /currency/,
  );
  assert.throws(
    () =>
      validateIntakeConfig({
        name: "Service",
        questions: [
          { field: "notes", label: "Q", required: false, options: ["A", "A"] },
        ],
      }),
    /distinct/,
  );
});
test("conditional mandatory questions block agreement and preserve answers when hidden", () => {
  const record = template({
    name: "Capture",
    defaults: { deliverables: "Tour" },
    questions: [
      { field: "propertySizeSqFt", label: "Capture area", required: true },
      {
        field: "notes",
        label: "Large-site preparation",
        required: true,
        when: { field: "propertySizeSqFt", op: "greater_than", value: "10000" },
      },
    ],
  });
  let job = change(jobFor(record), "edit", {
    address: "100 Example",
    scope: "Lobby",
    accessInstructions: "Meet owner",
    propertySizeSqFt: "12000",
  });
  job = change(job, "submit");
  assert.deepEqual(readiness(job), [
    { kind: "missing", field: "notes", label: "Large-site preparation" },
  ]);
  assert.throws(
    () => change(job, "approve", null, "provider"),
    /required information/,
  );
  job = change(job, "edit", {
    notes: "Exact area 12 7/16; arrange access",
    propertySizeSqFt: "9000",
  });
  assert.equal(readiness(job).length, 0);
  assert.equal(job.fields.notes, "Exact area 12 7/16; arrange access");
  job = change(job, "approve", null, "provider");
  job = change(job, "approve");
  job = change(job, "activate", null, "system");
  assert.throws(
    () => change(job, "edit", { propertySizeSqFt: "12000" }),
    /Propose/,
  );
  const view = clientView(job);
  assert.equal(view.intake.version, 1);
  assert.equal(view.intake.defaults, undefined);
  assert.equal(view.provider, undefined);
});
test("proposals cannot remove required answers or bypass choices after agreement", () => {
  const record = template({
    name: "Capture",
    questions: [
      {
        field: "notes",
        label: "Usage",
        required: true,
        options: ["Marketing", "Documentation"],
      },
    ],
  });
  let job = jobFor(record);
  assert.throws(
    () => change(job, "edit", { notes: "Unsupported" }),
    /listed answers/,
  );
  job = change(job, "edit", {
    address: "100 Example",
    scope: "Lobby",
    accessInstructions: "Meet owner",
    deliverables: "Tour",
    notes: "Documentation",
  });
  job = change(job, "submit");
  job = change(job, "approve", null, "provider");
  job = change(job, "approve");
  job = change(job, "activate", null, "system");
  assert.throws(() => change(job, "edit", { notes: "Marketing" }), /Propose/);
  assert.throws(
    () => change(job, "propose", { notes: "Unsupported" }),
    /listed answers/,
  );
  job = change(job, "propose", { notes: "" });
  assert.throws(
    () =>
      reduceClientJob(
        job,
        {
          action: "accept_proposal",
          expectedRevision: job.revision,
          proposalId: job.proposal.id,
        },
        { role: "provider" },
        5000,
      ),
    /required information/,
  );
  assert.equal(job.accepted.notes, "Documentation");
});
