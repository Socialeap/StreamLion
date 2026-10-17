import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { BRIEF_SCHEMA, validateBriefResult } from "./brief-import-contract.js";
import { intakeFor } from "./project-schema.js";

// Exercise the schema actually sent to the provider, independently of the
// project's post-generation validator. No model call is needed to expose gaps.
const accepts = new Ajv({ strict: true }).compile(BRIEF_SCHEMA);
const project = intakeFor({ title: "Synthetic NYC event venue" });

test("the provider contract rejects field representations that the project rejects", async (t) => {
  for (const [key, value, extra] of [
    ["offeredFee", "$1,500", { currency: "USD" }],
    ["agreedFee", "1500.125", { currency: "USD" }],
    ["propertySizeSqFt", "9,200 sq ft", {}],
    ["siteHours", "four hours", {}],
    ["appointmentStatus", "tentative", {}],
    ["currency", "US dollars", {}],
    ["requesterEmail", "email to follow", {}],
    ["reference1Url", "http://example.test/brief", {}],
    ["paidDate", "October 20, 2026", {}],
    ["startLocal", "2026-10-20 08:00", { timeZone: "America/New_York" }],
  ])
    await t.test(key, () => {
      const output = {
        ...project,
        fields: { ...project.fields, ...extra, [key]: value },
      };
      assert.throws(() => validateBriefResult(JSON.stringify(output)));
      assert.equal(
        accepts(output),
        false,
        `${key} must be constrained before generation`,
      );
    });
});

test("the provider contract accepts empty unknowns and exact valid project details", () => {
  const output = intakeFor({
    title: "Synthetic NYC event venue",
    propertySizeSqFt: "9200",
    siteHours: "4.25",
    offeredFee: "1500.00",
    currency: "USD",
    appointmentStatus: "proposed",
    startLocal: "2026-10-20T08:00",
    timeZone: "America/New_York",
    paidDate: "2026-10-19",
    requesterEmail: "client@example.test",
    reference1Url: "https://example.test/brief",
    scope: "Photograph the stage. Record the exact entry width: 6 7/16 inches.",
  });
  assert.equal(accepts(project), true);
  assert.equal(accepts(output), true, JSON.stringify(accepts.errors));
  assert.deepEqual(validateBriefResult(JSON.stringify(output)), output);
});
