import test from "node:test";
import assert from "node:assert/strict";
import { privateAIInput, restoreAIAnswer } from "../../server/ai-privacy.js";

test("case-varied known names bind the question and records to one canonical identity", () => {
  const input = privateAIInput(
    "Does JANE RIVERA need photos?",
    { contact1Name: "Jane Rivera", scope: "Jane Rivera requested photos." },
    [
      {
        text: "Contact: jane rivera\nNeeds 6 7/16 inch clearance.",
        area: "Ballroom",
        reviewed: false,
      },
    ],
  );
  const context = JSON.parse(input.context),
    token = context.project.contact1Name;
  assert(input.question.includes(token));
  assert(context.fieldRecords[0].text.includes(token));
  assert.equal(
    restoreAIAnswer(`Ask ${token}.`, input.privacy),
    "Ask Jane Rivera.",
  );
});

test("a private map belongs only to its request; restoration never depends on device storage", () => {
  const first = privateAIInput("Who?", { contact1Name: "Avery Clark" }, []);
  const second = privateAIInput("Who?", { contact1Name: "Morgan Cruz" }, []);
  assert.equal(
    restoreAIAnswer(
      JSON.parse(first.context).project.contact1Name,
      first.privacy,
    ),
    "Avery Clark",
  );
  assert.equal(
    restoreAIAnswer(
      JSON.parse(second.context).project.contact1Name,
      second.privacy,
    ),
    "Morgan Cruz",
  );
  assert.doesNotMatch(JSON.stringify(second), /Avery Clark/);
});

test("structured masking retains JSON, case-sensitive links, numeric types and exact measurements", () => {
  const input = privateAIInput(
    "Read the requirements.",
    {
      title: "Harbor Hall",
      address: "123 Harbor Street",
      propertySizeSqFt: "5000",
      finished: false,
      scope: 'Use the "east" room.\nKeep \\ marks and 6 7/16 inches.',
      reference1Url: "https://example.test/Case?A=1",
      accessInstructions: "2468",
    },
    [],
  );
  const p = JSON.parse(input.context).project;
  assert.equal(
    p.scope,
    'Use the "east" room.\nKeep \\ marks and 6 7/16 inches.',
  );
  assert.equal(p.finished, false);
  assert.equal(p.propertySizeSqFt, "5000");
  assert.doesNotMatch(
    input.context,
    /2468|123 Harbor Street|Harbor Hall|https:\/\//,
  );
  assert.equal(
    restoreAIAnswer(p.reference1Url, input.privacy),
    "https://example.test/Case?A=1",
  );
});

test("the AI context retains its existing 10 KB bound rather than inheriting the 6,000-character brief limit", () => {
  const input = privateAIInput(
    "Summarize the scope.",
    { scope: "x".repeat(7000) },
    [],
  );
  assert.equal(JSON.parse(input.context).project.scope.length, 7000);
  assert.throws(
    () => privateAIInput("What?", { scope: "x".repeat(10000) }, []),
    /too large/,
  );
});

test("restoration cannot expand the answer beyond its original display and voice bound", () => {
  const input = privateAIInput("Who?", { contact1Name: "a".repeat(480) }, []);
  const token = JSON.parse(input.context).project.contact1Name;
  assert.throws(
    () => restoreAIAnswer(`${token} ${token}`, input.privacy),
    /too large/,
  );
  assert.throws(
    () => restoreAIAnswer("SLP_999_", input.privacy),
    /Unknown private reference/,
  );
  assert.throws(
    () => restoreAIAnswer("slp_1_", input.privacy),
    /filtered|reference/i,
  );
});

for (const [label, repeated, phrase] of [
  ["Password: open sesame", "open sesame", "open sesame"],
  ["Passcode is stone river!", "stone river!", "stone river!"],
  ['Password: "quiet harbor"', "quiet harbor", "quiet harbor"],
  ["Password: “copper lantern.”", "copper lantern", "copper lantern"],
])
  test(`multi-word secrets are removed in full from questions and other fields: ${label}`, () => {
    const input = privateAIInput(
      `Does ${repeated} still work?`,
      {
        title: "Venue",
        scope: `Use ${repeated} at the rear entrance. Clearance 6 7/16 inches.`,
      },
      [{ text: label, area: "Entry", reviewed: true }],
    );
    const context = JSON.parse(input.context);
    assert.equal(input.question, "Does [PRIVATE_ACCESS_REMOVED] still work?");
    assert.equal(
      context.project.scope,
      "Use [PRIVATE_ACCESS_REMOVED] at the rear entrance. Clearance 6 7/16 inches.",
    );
    assert.equal(context.fieldRecords[0].text, "[PRIVATE_ACCESS_REMOVED]");
    assert(!JSON.stringify(input).includes(phrase));
    assert.equal(
      input.privacy.entries.some((e) => phrase.includes(e.value)),
      false,
    );
  });

test("single-word codes followed by explanatory prose remain hidden in repeated questions", () => {
  const input = privateAIInput("Does 7319 still work?", { title: "Venue" }, [
    {
      text: "Access code: 7319 for the rear entrance",
      area: "Entry",
      reviewed: true,
    },
  ]);
  assert.equal(input.question, "Does [PRIVATE_ACCESS_REMOVED] still work?");
  assert.doesNotMatch(JSON.stringify(input), /7319/);
});
