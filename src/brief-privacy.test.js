import test from "node:test";
import assert from "node:assert/strict";
import {
  filterBrief,
  validatePrivateBrief,
  restoreBrief,
} from "./brief-privacy.js";

test("a discovered name is hidden in every unlabeled repeat and cannot leak through a modified envelope", () => {
  const value = filterBrief(
    "Client: Avery Jones\nAvery Jones requests photos. Call AVERY JONES before arrival.",
  );
  assert.doesNotMatch(value.text, /avery jones/i);
  assert.equal(value.privacy.entries.length, 1);
  assert.equal((value.text.match(/SLP_1_/g) || []).length, 3);
  assert.throws(() =>
    validatePrivateBrief({ ...value, text: value.text + " Avery Jones" }),
  );
});

test("case-sensitive URL paths retain separate references and restore without changing their destination", () => {
  const value = filterBrief(
    "Reference one https://example.test/Spec\nReference two https://example.test/spec",
  );
  assert.equal(value.privacy.entries.length, 2);
  assert.equal(
    restoreBrief({ fields: { notes: value.text } }, value.privacy).fields.notes,
    "Reference one https://example.test/Spec\nReference two https://example.test/spec",
  );
});

test("privacy filtering preserves work details and restores repeated identities without sending their map", () => {
  const value = filterBrief(
    "Contact Jane Smith at jane@example.test, 503-555-0142. Jane Smith requests photos at 123 Harbor Street; 5,000 sq ft, USD 1500 and 6 7/16 inches.",
    { requesterName: "Jane Smith" },
  );
  assert.doesNotMatch(
    value.text,
    /Jane Smith|jane@example|503-555-0142|123 Harbor Street/,
  );
  assert.match(value.text, /5,000 sq ft, USD 1500 and 6 7\/16 inches/);
  assert.equal(value.sourceName, "Project brief");
  assert.equal(
    value.privacy.entries.filter((e) => e.value === "Jane Smith").length,
    1,
  );
  validatePrivateBrief(value);
  const token = value.privacy.entries.find(
    (e) => e.value === "Jane Smith",
  ).token;
  assert.equal(
    restoreBrief(
      { fields: { scope: `${token} requests photos` } },
      value.privacy,
    ).fields.scope,
    "Jane Smith requests photos",
  );
});

test("labeled names, URLs, manual phrases and credentials are handled without treating measurements as secrets", () => {
  const value = filterBrief(
    "Client: Avery Jones\nEmail: a@example.test\nWebsite https://venue.example/private\nDoor code: 9842\nPassword: hush\nMeasure the 9842 mm corridor. Special Harbor ballroom",
    {},
    ["Special Harbor ballroom"],
  );
  assert.doesNotMatch(
    value.text,
    /Avery Jones|a@example|venue.example|hush|Door code: 9842|Special Harbor/,
  );
  assert.match(value.text, /9842 mm corridor/);
  assert(!JSON.stringify(value.privacy).includes("hush"));
  assert(!value.privacy.entries.some((e) => e.value.includes("9842")));
  assert.match(value.text, /PRIVATE_ACCESS_REMOVED/);
});

test("unknown or edited references, malformed maps, raw contacts and reserved source tokens fail closed", () => {
  const value = filterBrief("Email jane@example.test");
  assert.throws(() =>
    restoreBrief({ fields: { scope: "SLP_999_" } }, value.privacy),
  );
  assert.throws(() =>
    restoreBrief({ fields: { scope: "SLP_1" } }, value.privacy),
  );
  assert.throws(() =>
    validatePrivateBrief({ ...value, text: "Email jane@example.test" }),
  );
  assert.throws(() =>
    validatePrivateBrief({
      ...value,
      privacy: {
        version: 1,
        entries: [
          { token: "SLP_1_", value: "x", kind: "email" },
          { token: "SLP_1_", value: "y", kind: "email" },
        ],
      },
    }),
  );
  assert.throws(() => filterBrief("Already contains SLP_1_"));
});
