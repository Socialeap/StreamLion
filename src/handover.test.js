import test from "node:test";
import assert from "node:assert/strict";
import { handoverModel, handoverDocument } from "./handover.js";
import {
  readWorkflow,
  beforeLeaving,
  measurementEvidence,
} from "./workflow.js";
import { parseMeasurements, MEASUREMENT_KIND } from "./measurements.js";
const project = {
  id: "job",
  title: "Harbor House",
  providerName: "Synthetic Capture",
  scope: "Interior",
  deliverables: "Tour and readings",
  invoiceAmount: "987.65",
  currency: "USD",
};
const task = {
  id: "task",
  label: "Kitchen length",
  kind: "measurement",
  area: "Kitchen",
  reading: "Length",
  state: "done",
  reason: "",
  evidence: [],
  source: {
    field: "brief",
    name: "brief.pdf",
    quote: "Measure kitchen length.",
    page: 2,
  },
};
const reading = (fields = {}) => {
  const raw = "Length 10 ft 4 3/32 in";
  return {
    id: "reading",
    jobId: "job",
    area: "Measurements · Kitchen",
    reviewed: true,
    createdAt: "2026-10-03T09:00:00Z",
    text: JSON.stringify({
      kind: MEASUREMENT_KIND,
      version: 1,
      room: "Kitchen",
      floor: "Ground floor",
      side: "Interior",
      enteredAt: "2026-10-03T09:00:00Z",
      raw,
      ...parseMeasurements(raw),
    }),
    ...fields,
  };
};
test("delivery tasks remain pending in the handover without blocking the site departure check", () => {
  const plan = {
    ...readWorkflow([], project),
    requirements: [
      {
        id: "delivery",
        label: "Deliver tour",
        kind: "delivery",
        area: "",
        state: "todo",
        reason: "",
        evidence: [],
      },
    ],
  };
  assert.equal(beforeLeaving(project, plan, []).length, 0);
  assert.match(
    handoverModel(project, plan, []).warnings[0].detail,
    /Delivery task/,
  );
});
test("measurement requirements need same-project, same-space reviewed readings; ambiguous floors need explicit evidence", () => {
  const plan = { ...readWorkflow([], project), requirements: [task] };
  for (const note of [
    reading({ jobId: "other" }),
    reading({ reviewed: false }),
    reading({ pendingBookId: "book" }),
    { ...reading(), text: "Plain prose" },
  ])
    assert.ok(
      beforeLeaving(project, plan, [note]).some((warning) =>
        /reading/.test(warning.label),
      ),
    );
  assert.equal(measurementEvidence(task, [reading()], project.id).issue, "");
  const otherFloor = reading({ id: "upstairs" });
  otherFloor.text = JSON.stringify({
    ...JSON.parse(otherFloor.text),
    floor: "Second floor",
  });
  assert.match(
    measurementEvidence(task, [reading(), otherFloor], "job").issue,
    /Several spaces/,
  );
  otherFloor.text = JSON.stringify({
    ...JSON.parse(otherFloor.text),
    raw: "Width 8 ft",
    ...parseMeasurements("Width 8 ft"),
  });
  assert.match(
    measurementEvidence(task, [reading(), otherFloor], "job").issue,
    /Several spaces/,
    "A different dimension on another floor still makes the space ambiguous",
  );
  assert.equal(
    measurementEvidence(
      { ...task, evidence: ["reading"] },
      [reading(), otherFloor],
      "job",
    ).issue,
    "",
  );
  assert.ok(
    beforeLeaving(project, plan, []).some((warning) =>
      /reading/.test(warning.label),
    ),
  );
});
test("client report keeps original fractions, source passages, exceptions and privacy defaults", () => {
  const plan = {
    ...readWorkflow([], project),
    requirements: [task],
    siteLessons: "Rear office locked; return visit agreed",
  };
  const notes = [
    reading(),
    {
      id: "private",
      jobId: "other",
      reviewed: true,
      text: "other project secret",
    },
    {
      id: "pending",
      jobId: "job",
      reviewed: false,
      text: "unreviewed-only-secret",
      area: "Rear room",
    },
  ];
  const model = handoverModel(project, plan, notes, {
    origin: "Device record",
    generatedAt: "2026-10-03T10:00:00Z",
  });
  const html = handoverDocument(model);
  assert.match(html, /10′ 4 3\/32″/);
  assert.match(html, /Measure kitchen length\./);
  assert.match(html, /page 2/);
  assert.match(html, /Rear office locked/);
  assert.doesNotMatch(
    html,
    /987\.65|other project secret|unreviewed-only-secret/,
  );
  assert.match(html, /1 unchecked field record/);
  assert.match(
    handoverDocument(
      handoverModel(project, plan, notes, { includePayment: true }),
    ),
    /987\.65/,
  );
});
test("untrusted field text and links cannot inject executable content into downloaded or inline reports", () => {
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const p = {
    ...project,
    title: payload,
    document1Name: payload,
    document1Url: "javascript:alert(3)",
  };
  const model = handoverModel(
    p,
    {
      ...readWorkflow([], project),
      requirements: [
        { ...task, label: payload, source: { ...task.source, quote: payload } },
      ],
    },
    [
      {
        id: "n",
        jobId: "job",
        area: payload,
        reviewed: true,
        text: payload,
        audioUrl: 'https://example.com/\" onclick=\"alert(4)',
      },
    ],
  );
  const html = handoverDocument(model, { n: payload });
  assert.doesNotMatch(html, /<script>|<img src=x|href="javascript:| onclick=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /default-src 'none'/);
});
