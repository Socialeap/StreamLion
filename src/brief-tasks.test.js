import test from "node:test";
import assert from "node:assert/strict";
import {
  suggestTasks,
  appendReviewedTasks,
  validateBriefDraft,
} from "./brief-tasks.js";
import { readWorkflow, validateWorkflow } from "./workflow.js";
import { readBrief } from "./read-brief.js";

test("explicit rooms and tape readings become separate reviewed tasks with exact PDF passages", () => {
  const text =
    "[Page 2]\nCapture lobby + kitchen. Measure kitchen length and width.\nDo not scan the locked office.\nDeliver tour link.";
  const suggestions = suggestTasks({
    project: {},
    text,
    sourceName: "Original brief.pdf",
  });
  assert.deepEqual(
    suggestions.map(({ kind, area, reading }) => [kind, area, reading]),
    [
      ["capture", "lobby", undefined],
      ["capture", "kitchen", undefined],
      ["measurement", "kitchen", "Length"],
      ["measurement", "kitchen", "Width"],
      ["review", "", undefined],
      ["delivery", "", undefined],
    ],
  );
  assert.equal(
    suggestions[2].source.quote,
    "Measure kitchen length and width.",
  );
  assert.equal(suggestions[2].source.page, 2);
  assert.equal(suggestions[4].kind, "review");
  const draft = {
    text,
    sourceName: "Original brief.pdf",
    suggestions,
    reviewed: false,
  };
  assert.throws(() => appendReviewedTasks([], draft), /Review/);
  draft.reviewed = true;
  const tasks = appendReviewedTasks([], draft);
  const checked = tasks.map((row) => ({
    ...row,
    state: "done",
    evidence: ["photo"],
  }));
  assert.deepEqual(appendReviewedTasks(checked, draft), checked);
  const changed = structuredClone(draft);
  changed.suggestions[0].source.quote =
    "Capture lobby using the updated access instructions.";
  assert.throws(
    () => appendReviewedTasks(checked, changed),
    /changed source wording/,
  );
  assert.equal(
    validateWorkflow({ ...readWorkflow([], { id: "p" }), requirements: tasks })
      .version,
    1,
  );
});
test("conditional work stays a review request and incomplete room corrections cannot become checked work", () => {
  for (const text of [
    "Scan office if access is available",
    "Capture all rooms except storage",
    "No capture outside",
  ]) {
    assert.equal(suggestTasks({ project: {}, text })[0].kind, "review");
  }
  const draft = {
    text: "",
    sourceName: "Brief",
    reviewed: true,
    suggestions: suggestTasks({ project: { scope: "Measure kitchen width" } }),
  };
  draft.suggestions[0].area = "";
  assert.doesNotThrow(() => validateBriefDraft(draft));
  assert.throws(() => appendReviewedTasks([], draft), /Name the space/);
  assert.throws(
    () => suggestTasks({ project: {}, text: "a".repeat(6001) }),
    /6,000/,
  );
  assert.throws(
    () =>
      suggestTasks({
        project: {},
        text: Array(41).fill("Scan office").join("\n"),
      }),
    /smaller section/,
  );
});
test("text upload is bounded and errors do not produce partial or silently truncated briefs", async () => {
  const result = await readBrief(
    new File(["Capture office"], "brief.txt", { type: "text/plain" }),
  );
  assert.equal(result.text, "Capture office");
  assert.equal(result.reviewed, false);
  await assert.rejects(
    readBrief(new File(["x".repeat(6001)], "brief.txt")),
    /6,000/,
  );
  await assert.rejects(
    readBrief(new File(["not supported"], "source.docx")),
    /txt/,
  );
});
