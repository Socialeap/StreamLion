import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { sampleProject } from "../src/extension/sample.js";
import { validateFields } from "../src/project-schema.js";
import { makeRevision } from "../src/workbook.js";
import { parseMeasurements, MEASUREMENT_KIND } from "../src/measurements.js";
const frame = document.querySelector("#view");
const messages = document.querySelector("#messages");
function showMessage(text) {
  const item = document.createElement("p");
  item.textContent = text;
  messages.append(item);
}
let job = {
  ...sampleProject(),
  sample: false,
  destination: {
    title: "QA workbook · synthetic",
    workbookUrl: "https://docs.google.com/spreadsheets/d/qa-synthetic/edit",
    asOf: "2026-10-03T12:00:00Z",
  },
};
let pending;
const jobs = new Map([[job.project.id, job]]);
window.qa = { calls: [], contexts: [], messages: [], saves: 0, links: [] };
const bridge = new AppBridge(
  null,
  { name: "Simulated ChatGPT host", version: "1.0" },
  {
    serverTools: {},
    message: { text: {} },
    updateModelContext: { text: {} },
    openLinks: {},
  },
  { hostContext: { displayMode: "fullscreen", platform: "web" } },
);
bridge.oncalltool = async (args) => {
  qa.calls.push(args);
  const a = args.arguments || {};
  let result;
  if (args.name === "list_streamlion_projects")
    result = {
      kind: "projects",
      destination: job.destination,
      projects: [...jobs.values()].map(({ project }) => ({
        recordId: project.id,
        title: project.title,
        city: project.city,
        reviewState: project.reviewState,
      })),
    };
  else if (args.name === "get_streamlion_project") {
    job = jobs.get(a.recordId);
    result = job;
  } else if (args.name === "save_streamlion_review") {
    qa.saves++;
    const r = {
      ...pending.revision,
      reviewState: a.reviewed ? "reviewed" : "draft",
    };
    if (pending.recordType === "project")
      job = {
        ...job,
        notes: jobs.get(r.recordId)?.notes || [],
        project: { ...r, id: r.recordId },
      };
    else
      job = {
        ...job,
        notes: [
          ...job.notes.filter((n) => n.id !== r.recordId),
          {
            ...r,
            id: r.recordId,
            jobId: r.projectId,
            reviewed: a.reviewed,
            createdAt: r.updatedAt,
          },
        ],
      };
    jobs.set(job.project.id, job);
    result = {
      kind: "saved",
      recordId: r.recordId,
      projectId: r.projectId || r.recordId,
      revisionId: r.revisionId,
      destination: job.destination,
    };
  } else {
    let fields, recordType;
    if (args.name === "prepare_streamlion_project") {
      fields = validateFields(a.fields);
      recordType = "project";
    } else if (args.name === "prepare_streamlion_measurements") {
      const text = JSON.stringify({
        kind: MEASUREMENT_KIND,
        version: 1,
        room: a.room,
        floor: a.floor || "",
        side: a.side || "Interior",
        raw: a.raw,
        enteredAt: new Date().toISOString(),
        ...parseMeasurements(a.raw),
      });
      fields = {
        projectId: job.project.id,
        area: "Measurements · " + a.room,
        text,
        sourceText: text,
        audioUrl: "",
      };
      recordType = "measurement";
    } else if (args.name === "prepare_streamlion_checklist") {
      fields = {
        projectId: job.project.id,
        area: "StreamLion project checklist",
        text: JSON.stringify(a.plan),
        sourceText: JSON.stringify(a.plan),
        audioUrl: "",
      };
      recordType = "workflow";
    } else {
      fields = {
        projectId: job.project.id,
        area: a.area,
        text: a.text,
        sourceText: a.sourceText,
        audioUrl: "",
      };
      recordType = "note";
    }
    if (recordType === "project") fields = validateFields(a.fields);
    pending = {
      kind: "draft",
      draftId: "qa-draft",
      recordType,
      revision: makeRevision(
        fields,
        a.recordId
          ? recordType === "project"
            ? job.project
            : job.notes.find((n) => n.id === a.recordId)
          : undefined,
      ),
      destination: job.destination,
    };
    return {
      structuredContent: pending,
      content: [{ type: "text", text: "Synthetic review" }],
      _meta: {
        confirmation: "q".repeat(43),
        expectedRevisionId: a.expectedRevisionId || "",
      },
    };
  }
  return {
    structuredContent: result,
    content: [{ type: "text", text: "Synthetic host response" }],
  };
};
bridge.onupdatemodelcontext = async (p) => {
  qa.contexts.push(p);
  document.querySelector("#attachment").textContent = p.content?.length
    ? "Selected project context attached"
    : "No project attached";
  return {};
};
bridge.onmessage = async (p) => {
  qa.messages.push(p);
  showMessage(
    p.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
  );
  return {};
};
bridge.onopenlink = async (p) => {
  qa.links.push(p);
  return {};
};
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} });
  await bridge.sendToolResult({
    structuredContent: { kind: "workspace", connected: false },
    content: [],
  });
};
await bridge.connect(
  new PostMessageTransport(frame.contentWindow, frame.contentWindow),
);
