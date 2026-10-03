import test from "node:test";
import assert from "node:assert/strict";
import {
  attachException,
  exceptionText,
  emptyException,
} from "./site-exceptions.js";
import { readWorkflow, beforeLeaving } from "./workflow.js";
import { newFieldRecord, appendFieldRecord } from "./field-records.js";
const draft = {
  ...emptyException,
  type: "Access blocked",
  taskId: "task",
  area: "Office",
  detail: "Door locked",
  nextAction: "Client to arrange access",
  checked: true,
};
const project = { id: "job" };
const plan = {
  ...readWorkflow([], project),
  requirements: [
    {
      id: "task",
      label: "Capture office",
      area: "Office",
      state: "todo",
      reason: "",
      evidence: [],
    },
  ],
};
test("a site exception links its stable field record and blocks only the selected task", () => {
  const text = exceptionText(draft);
  const note = newFieldRecord(
    { jobId: project.id, area: draft.area, text, reviewed: true },
    "book",
    undefined,
    "reserved-id",
  );
  const linked = attachException(plan, draft, note.id);
  assert.equal(linked.requirements[0].state, "blocked");
  assert.deepEqual(linked.requirements[0].evidence, [note.id]);
  assert.equal(linked.exceptionDraft, undefined);
  const retried = newFieldRecord(
    { jobId: project.id, area: draft.area, text, reviewed: true },
    "book",
    undefined,
    "reserved-id",
  );
  assert.equal(appendFieldRecord([note], retried).length, 1);
  assert.throws(
    () => appendFieldRecord([note], { ...retried, jobId: "other" }),
    /different wording/,
  );
});
test("changed requests stay pending and unfinished exceptions remain in the departure check", () => {
  const change = {
    ...draft,
    type: "Changed request",
    detail: "Add basement scan",
  };
  const linked = attachException(plan, change, "change-note");
  assert.equal(linked.requirements[0].state, "todo");
  assert.match(linked.requirements[1].label, /Confirm changed request/);
  assert.equal(linked.requirements[1].state, "todo");
  assert.equal(
    attachException(
      plan,
      { ...draft, type: "Follow-up", taskId: "" },
      "followup",
    ).requirements[1].state,
    "todo",
  );
  assert.equal(
    attachException(plan, { ...draft, taskId: "" }, "access").requirements[1]
      .state,
    "blocked",
  );
  assert.match(exceptionText(change), /awaits confirmation/);
  assert.throws(
    () => exceptionText({ ...draft, checked: false }),
    /check your wording/,
  );
  assert.ok(
    beforeLeaving(project, { ...plan, exceptionDraft: draft }, []).some(
      (warning) => /unfinished site/.test(warning.label),
    ),
  );
  assert.throws(
    () => attachException({ ...plan, requirements: [] }, draft, "note"),
    /no longer available/,
  );
});
