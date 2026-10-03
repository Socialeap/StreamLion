import { validateFields } from "../project-schema.js";
import { readWorkflow, WORKFLOW_AREA } from "../workflow.js";
export function sampleProject() {
  const project = {
    ...validateFields({
      title: "Harbor House",
      city: "Brooklyn",
      region: "NY",
      scope:
        "Capture the living room and kitchen. Measure kitchen length and width.",
      deliverables: "Deliver tour link and checked kitchen measurements.",
      companyName: "Harbor Property Group",
      accessInstructions: "Meet the contact at the front entrance.",
      agreedFee: "350",
      currency: "USD",
    }),
    id: "sample-harbor",
    recordId: "sample-harbor",
    revisionId: "sample-revision",
    reviewState: "draft",
    status: "Draft",
  };
  const plan = readWorkflow([], project);
  plan.requirements = [
    {
      id: "sample-capture",
      label: "Capture the living room and kitchen",
      area: "Ground floor",
      kind: "capture",
      state: "done",
      reason: "",
      evidence: [],
    },
    {
      id: "sample-tape",
      label: "Check kitchen length and width against the tape",
      area: "Kitchen",
      kind: "review",
      state: "todo",
      reason: "",
      evidence: [],
    },
  ];
  const notes = [
    {
      id: "sample-note",
      recordId: "sample-note",
      revisionId: "sample-note-r1",
      jobId: project.id,
      projectId: project.id,
      area: "Kitchen",
      text: "Kitchen island blocked one corner. Ask the contact to move it before the final scan.",
      sourceText:
        "Kitchen island blocked one corner. Ask the contact to move it before the final scan.",
      reviewed: true,
      reviewState: "reviewed",
      createdAt: "2026-10-03T12:00:00Z",
    },
    {
      id: "sample-work",
      recordId: "sample-work",
      revisionId: "sample-work-r1",
      jobId: project.id,
      projectId: project.id,
      area: WORKFLOW_AREA,
      text: JSON.stringify(plan),
      reviewed: true,
      createdAt: "2026-10-03T12:00:00Z",
    },
  ];
  return {
    kind: "project",
    sample: true,
    project,
    notes,
    destination: {
      title: "Synthetic example · changes stay in this view",
      asOf: "2026-10-03T12:00:00Z",
    },
  };
}
