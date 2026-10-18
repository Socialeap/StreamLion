import test from "node:test";
import assert from "node:assert/strict";
import { extractBrief } from "../../server/brief-import.js";
import { filterBrief } from "../../src/brief-privacy.js";
import { intakeFor } from "../../src/project-schema.js";

const response = (value) =>
  Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
  });
const issue = (kind, message) => ({
  kind,
  field: "deliverables",
  message,
  evidence: "Photos of stage",
});

test("a conflicting text deadline cannot silently keep the generated choice after an empty recheck", async () => {
  let calls = 0;
  const input = filterBrief(
    "Photos of stage. Deliver Thursday or Friday; not agreed.",
  );
  const result = await extractBrief(
    { OPENAI_API_KEY: "mock" },
    input,
    async () =>
      response(
        ++calls % 2
          ? intakeFor({ title: "Stage", deliveryDeadline: "Thursday" })
          : {
              issues:
                calls === 2
                  ? [
                      {
                        kind: "source_conflict",
                        field: "deliveryDeadline",
                        message: "Confirm Thursday or Friday",
                        evidence: "Thursday or Friday",
                      },
                    ]
                  : [],
            },
      ),
  );
  assert.equal(calls, 4);
  assert.equal(result.fields.deliveryDeadline, "");
  assert.match(result.fields.unresolved, /Confirm Thursday or Friday/);
});

test("a conflicting delivery destination is cleared while its extracted wording remains explicitly unconfirmed", async () => {
  let calls = 0;
  const result = await extractBrief(
    { OPENAI_API_KEY: "mock" },
    filterBrief("Delivery destination: studio A or B, not agreed."),
    async () =>
      response(
        ++calls % 2
          ? intakeFor({ title: "Capture", deliveryDestination: "studio A" })
          : {
              issues:
                calls === 2
                  ? [
                      {
                        kind: "source_conflict",
                        field: "deliveryDestination",
                        message: "Confirm destination",
                        evidence: "studio A or B",
                      },
                    ]
                  : [],
            },
      ),
  );
  assert.equal(result.fields.deliveryDestination, "");
  assert.match(result.fields.sourceNotes, /Unconfirmed extracted.*studio A/);
});

test("a tokenized candidate cannot expand beyond the recoverable response limit", async () => {
  const privateValue = "Q".repeat(400);
  const input = filterBrief(privateValue, {}, [privateValue]);
  const longValue = "SLP_1_ ".repeat(25);
  const candidate = intakeFor({
    title: "Capture",
    scope: longValue,
    deliverables: longValue,
    notes: longValue,
    sourceNotes: longValue,
    unresolved: longValue,
  });
  let calls = 0;
  await assert.rejects(
    extractBrief({ OPENAI_API_KEY: "mock" }, input, async () =>
      response(++calls === 1 ? candidate : { issues: [] }),
    ),
    /result_size/,
  );
  assert.equal(calls, 2);
});

test("generated output cannot reintroduce known private values into review or correction requests", async () => {
  for (const stage of [1, 2]) {
    let calls = 0;
    const input = filterBrief("Client: Avery Jones\nPhotos of stage");
    await assert.rejects(
      extractBrief({ OPENAI_API_KEY: "mock" }, input, async () =>
        response(
          ++calls === 1
            ? intakeFor({
                title: stage === 1 ? "Avery Jones capture" : "Capture",
              })
            : {
                issues: [
                  {
                    kind: "brief_error",
                    field: "scope",
                    message: "Ask Avery Jones",
                    evidence: "Photos of stage",
                  },
                ],
              },
        ),
      ),
    );
    assert.equal(calls, stage);
  }
});
test("generation and independent source review restore private references only after the provider boundary", async () => {
  const input = filterBrief(
    "Client: Jane Smith\nEmail jane@example.test\nPhotos of stage",
  );
  const name = input.privacy.entries.find(
    (e) => e.value === "Jane Smith",
  ).token;
  const email = input.privacy.entries.find(
    (e) => e.value === "jane@example.test",
  ).token;
  let calls = 0;
  const result = await extractBrief(
    { OPENAI_API_KEY: "mock" },
    input,
    async (url, init) => {
      const body = JSON.parse(init.body);
      assert.doesNotMatch(
        init.body,
        /Jane Smith|jane@example|"privacy":|"entries":/,
      );
      assert.equal(body.store, false);
      calls++;
      if (calls === 1)
        return response({
          ...intakeFor({
            title: "Stage capture",
            requesterName: name,
            deliverables: "Photos of stage",
          }),
          fields: {
            ...intakeFor({
              title: "Stage capture",
              requesterName: name,
              deliverables: "Photos of stage",
            }).fields,
            requesterEmail: email,
          },
        });
      const evidence = JSON.parse(body.input[0].content);
      assert.equal(evidence.brief, input.text);
      assert.equal(evidence.candidate.fields.requesterEmail, email);
      return response({ issues: [] });
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.fields.requesterName, "Jane Smith");
  assert.equal(result.fields.requesterEmail, "jane@example.test");
});

test("a finding triggers exactly one full correction and a final check against the original source", async () => {
  const input = filterBrief("Photos of stage\nMeasure entrance width.");
  const candidates = [
    intakeFor({ title: "Capture", deliverables: "Photos of stage" }),
    intakeFor({
      title: "Capture",
      deliverables: "Photos of stage; measure entrance width",
    }),
  ];
  const outputs = [
    candidates[0],
    { issues: [issue("brief_error", "Entrance measurement was omitted")] },
    candidates[1],
    { issues: [] },
  ];
  const requests = [];
  const result = await extractBrief(
    { OPENAI_API_KEY: "mock" },
    input,
    async (url, init) => {
      requests.push(JSON.parse(init.body));
      return response(outputs[requests.length - 1]);
    },
  );
  assert.equal(requests.length, 4);
  assert.match(
    JSON.parse(requests[2].input[0].content).findings.issues[0].message,
    /omitted/,
  );
  assert.equal(JSON.parse(requests[3].input[0].content).brief, input.text);
  assert.match(result.fields.deliverables, /entrance width/);
});

test("source conflicts remain confirmation items; uncorrected generation defects cannot create endless paid loops", async () => {
  for (const kind of ["source_conflict", "source_gap", "brief_error"]) {
    let calls = 0;
    const input = filterBrief(
      "Photos of stage\nDelivery Thursday or Friday, not agreed.",
    );
    const run = extractBrief({ OPENAI_API_KEY: "mock" }, input, async () =>
      response(
        ++calls % 2
          ? intakeFor({ title: "Capture" })
          : { issues: [issue(kind, "Confirm Thursday or Friday")] },
      ),
    );
    if (kind === "brief_error") await assert.rejects(run, /review_failed/);
    else
      assert.match(
        (await run).fields.unresolved,
        /Needs confirmation.*Confirm Thursday or Friday/,
      );
    assert.equal(calls, 4);
  }
});

test("review rejection, malformed findings and unknown references fail without a new inference retry", async () => {
  for (const second of [
    { issues: "okay" },
    { issues: [issue("brief_error", "SLP_999_ was missing")] },
    {
      issues: [
        {
          ...issue("source_conflict", "Conflict"),
          evidence: "invented passage",
        },
      ],
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      extractBrief(
        { OPENAI_API_KEY: "mock" },
        filterBrief("Photos of stage"),
        async () =>
          response(++calls === 1 ? intakeFor({ title: "Capture" }) : second),
      ),
    );
    assert.equal(calls, 2);
  }
});
