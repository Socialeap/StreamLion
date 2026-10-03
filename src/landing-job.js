// In-memory sample only. Uses the same conservative pipeline as the workspace.
import { suggestTasks, appendReviewedTasks } from "./brief-tasks.js";
import { readWorkflow, validateWorkflow } from "./workflow.js";
import {
  MEASUREMENT_KIND,
  parseMeasurements,
  measurementSet,
} from "./measurements.js";
import { attachException, exceptionText } from "./site-exceptions.js";

export const SAMPLE_BRIEF =
  "Capture ground-floor living room + Kitchen.\nCheck Kitchen length and width.\nDeliver tour link, site notes and checked measurements.";
export const SAMPLE_WORDING =
  "Length 12 feet 4 and a half inches. Width 10 feet 2 inches.";
export function sampleJob() {
  const project = {
    id: "sample-harbor-house",
    title: "Harbor House",
    reference: "HH-104",
    companyName: "Harbor Property",
    providerName: "Your Capture Studio",
    city: "Brooklyn",
    region: "NY",
    startLocal: "2026-10-09T09:00",
    timeZone: "America/New_York",
    scope: SAMPLE_BRIEF,
    deliverables: "Tour link, site notes and checked measurements.",
    deliveryDestination: "Harbor Property project manager",
    accessInstructions: "Meet Alex at the front entrance. Call on arrival.",
    contact1Name: "Alex Morgan",
    contact1Phone: "+1 202 555 0148",
    invoiceAmount: "300",
    paidAmount: "",
    currency: "USD",
  };
  return { project, plan: readWorkflow([], project), notes: [] };
}
export function sampleSuggestions(project, text) {
  return {
    text,
    sourceName: "Harbor House client brief",
    reviewed: false,
    suggestions: suggestTasks({
      project,
      text,
      sourceName: "Harbor House client brief",
    }),
  };
}
export function applySampleBrief(job, draft) {
  const project = {
    ...job.project,
    scope: draft.text,
    deliverables: draft.suggestions
      .filter((item) => item.selected && item.kind === "delivery")
      .map((item) => item.label)
      .join("\n"),
  };
  const plan = validateWorkflow({
    ...job.plan,
    scopeSignature: readWorkflow([], project).scopeSignature,
    requirements: appendReviewedTasks([], draft),
  });
  return { ...job, project, plan };
}
export function sampleReading(projectId, room, raw, reviewed = false) {
  const result = parseMeasurements(raw);
  if (!room.trim()) throw new Error("Name the room or space first.");
  if (!result.entries.length || result.issues.length)
    throw new Error(
      "Resolve the unclear wording before checking the readings.",
    );
  const createdAt = new Date().toISOString();
  const payload = measurementSet({
    kind: MEASUREMENT_KIND,
    version: 1,
    room: room.trim(),
    floor: "",
    side: "Interior",
    enteredAt: createdAt,
    raw,
    entries: result.entries,
    issues: result.issues,
  });
  return {
    id: crypto.randomUUID(),
    jobId: projectId,
    area: `Measurements · ${room.trim()}`,
    text: JSON.stringify(payload),
    sourceText: JSON.stringify(payload),
    reviewed,
    createdAt,
  };
}
export function sampleLockedRoom(job, taskId) {
  const task = job.plan.requirements.find(
    (item) => item.id === taskId && item.kind === "capture",
  );
  if (!task) throw new Error("Add a capture task before trying a locked room.");
  const draft = {
    type: "Access blocked",
    taskId,
    area: task.area,
    detail: "Room locked at the visit.",
    nextAction:
      "Ask the site contact for access before completing the capture.",
    reportedBy: "Provider on site",
    checked: true,
  };
  const note = {
    id: crypto.randomUUID(),
    jobId: job.project.id,
    area: task.area,
    text: exceptionText(draft),
    reviewed: true,
    createdAt: new Date().toISOString(),
  };
  return {
    ...job,
    plan: validateWorkflow(attachException(job.plan, draft, note.id)),
    notes: [...job.notes, note],
  };
}
