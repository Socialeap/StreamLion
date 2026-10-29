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

for (const count of [40, 119, 120]) {
  for (const type of ["Changed request", "Follow-up", "Access blocked"]) {
    test(`${type} at ${count} tasks respects shared checklist capacity`, () => {
      const large = {
        ...readWorkflow([], project),
        requirements: Array.from({ length: count }, (_, i) => ({
          id: `task-${i}`,
          label: `Capture room ${i}`,
          area: "Room",
          state: "todo",
          reason: "",
          evidence: [],
        })),
      };
      const original = structuredClone(large);
      const request = { ...draft, type, taskId: "" };
      if (count === 120) {
        assert.throws(
          () => attachException(large, request, "new-exception"),
          /checklist is full/,
        );
      } else {
        const updated = attachException(large, request, "new-exception");
        assert.equal(updated.requirements.length, count + 1);
        assert.deepEqual(updated.requirements.at(-1).evidence, [
          "new-exception",
        ]);
        assert.equal(
          updated.requirements.at(-1).state,
          type === "Access blocked" ? "blocked" : "todo",
        );
      }
      assert.deepEqual(
        large,
        original,
        "keep existing work and evidence unchanged",
      );
      if (type === "Access blocked") {
        const linked = attachException(
          large,
          { ...request, taskId: "task-0" },
          "linked-exception",
        );
        assert.equal(linked.requirements.length, count);
        assert.equal(linked.requirements[0].state, "blocked");
      }
    });
  }
}
