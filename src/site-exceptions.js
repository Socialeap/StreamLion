export const EXCEPTION_TYPES = [
  "Access blocked",
  "Changed request",
  "Site condition",
  "Follow-up",
];
export const emptyException = {
  type: "Access blocked",
  taskId: "",
  area: "",
  detail: "",
  nextAction: "",
  reportedBy: "",
  checked: false,
};
export function validateExceptionDraft(value, complete = false) {
  if (
    !value ||
    !EXCEPTION_TYPES.includes(value.type) ||
    typeof value.checked !== "boolean"
  )
    throw new Error("Choose the type of site exception.");
  for (const [key, limit] of Object.entries({
    taskId: 100,
    area: 200,
    detail: 700,
    nextAction: 300,
    reportedBy: 200,
  }))
    if (typeof value[key] !== "string" || value[key].length > limit)
      throw new Error(
        "Shorten the exception details before saving; your wording is kept.",
      );
  if (value.taskId && !/^[\w-]{1,100}$/.test(value.taskId))
    throw new Error("Choose an available requirement.");
  if (
    value.recordId !== undefined &&
    (typeof value.recordId !== "string" ||
      !/^[\w-]{1,100}$/.test(value.recordId))
  )
    throw new Error("Invalid exception save identity.");
  if (
    complete &&
    (!value.area.trim() ||
      !value.detail.trim() ||
      !value.nextAction.trim() ||
      !value.checked)
  )
    throw new Error(
      "Record the area, what happened, and the next action, then check your wording.",
    );
  return value;
}
export function exceptionText(draft) {
  validateExceptionDraft(draft, true);
  return [
    `Site exception — ${draft.type}`,
    draft.detail.trim(),
    `Next action: ${draft.nextAction.trim()}`,
    ...(draft.reportedBy.trim()
      ? [`Instruction / information from: ${draft.reportedBy.trim()}`]
      : []),
    ...(draft.type === "Changed request"
      ? ["Changed work awaits confirmation in the agreed project scope."]
      : []),
  ].join("\n");
}
export function attachException(plan, draft, recordId) {
  validateExceptionDraft(draft, true);
  const reason = `${draft.detail.trim()} Next: ${draft.nextAction.trim()}`;
  if (
    draft.taskId &&
    !plan.requirements.some((item) => item.id === draft.taskId)
  )
    throw new Error(
      "This requirement is no longer available. Choose it again before saving.",
    );
  const requirements = plan.requirements.map((item) => {
    if (item.id !== draft.taskId) return item;
    const explanation = [item.reason, reason].filter(Boolean).join("\n");
    if (explanation.length > 1000 || item.evidence.length >= 20)
      throw new Error(
        "This requirement is full. Save the exception as a separate field record instead.",
      );
    return {
      ...item,
      reason: explanation,
      state: draft.type === "Access blocked" ? "blocked" : item.state,
      evidence: [...item.evidence, recordId],
    };
  });
  // An extra request is never silently treated as part of the agreed work.
  if (
    draft.type === "Changed request" ||
    draft.type === "Follow-up" ||
    (draft.type === "Access blocked" && !draft.taskId)
  ) {
    if (requirements.length >= 40)
      throw new Error(
        "This checklist is full. Add this exception in project details first.",
      );
    requirements.push({
      id: recordId,
      label: `${draft.type === "Changed request" ? "Confirm changed request" : draft.type === "Follow-up" ? "Follow up" : "Resolve access"}: ${draft.detail.trim().slice(0, 450)}`,
      kind: "review",
      area: draft.area.trim(),
      state: draft.type === "Access blocked" ? "blocked" : "todo",
      reason,
      evidence: [recordId],
    });
  }
  return { ...plan, requirements, exceptionDraft: undefined };
}
