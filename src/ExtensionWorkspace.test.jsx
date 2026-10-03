import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  DOMParser: dom.window.DOMParser,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
test.afterEach(() => cleanup());
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { ExtensionWorkspace } = await import("./extension/workspace.jsx");
const { sampleProject } = await import("./extension/sample.js");
const { extensionContext, extensionDeepLink } =
  await import("./extension/context.js");
function bridge() {
  const calls = [],
    contexts = [],
    messages = [];
  return {
    calls,
    contexts,
    messages,
    connect: async () => {},
    getHostContext: () => ({}),
    getHostCapabilities: () => ({
      serverTools: {},
      message: { text: {} },
      updateModelContext: { text: {} },
    }),
    callServerTool: async (args) => {
      calls.push(args);
      throw new Error("Unexpected tool call");
    },
    updateModelContext: async (args) => {
      contexts.push(args);
      return {};
    },
    sendMessage: async (args) => {
      messages.push(args);
      return {};
    },
    openLink: async () => ({}),
  };
}
async function mount(b) {
  let ui;
  await act(async () => {
    ui = render(<ExtensionWorkspace bridge={b} />);
  });
  return ui;
}
async function result(b, data, meta) {
  await act(async () =>
    b.ontoolresult({ structuredContent: data, _meta: meta }),
  );
}
const response = (data) => ({ structuredContent: data });
test("entrypoint consumes its first result without repeating the opener", async () => {
  const b = bridge(),
    ui = await mount(b);
  await result(b, {
    kind: "projects",
    projects: [
      {
        recordId: "job-a",
        title: "Nassau Street",
        city: "Freeport",
        reviewState: "draft",
      },
    ],
    destination: { title: "My workbook", asOf: "2026-10-03T12:00:00Z" },
  });
  assert.ok(ui.getByRole("button", { name: /Nassau Street/ }));
  assert.equal(b.calls.length, 0);
  cleanup();
});
test("temporary connection errors remain retryable; job context is explicit and clears on navigation", async () => {
  const b = bridge();
  let fail = true;
  const data = { ...sampleProject(), sample: false };
  const list = {
    kind: "projects",
    projects: [
      {
        recordId: data.project.id,
        title: data.project.title,
        city: data.project.city,
        reviewState: "draft",
      },
    ],
    destination: data.destination,
  };
  b.callServerTool = async (args) => {
    b.calls.push(args);
    if (fail) throw new Error("Temporary network issue");
    return response(args.name === "get_streamlion_project" ? data : list);
  };
  const ui = await mount(b);
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Connect my workbook" })),
  );
  assert.match(ui.getByRole("alert").textContent, /Temporary network/);
  fail = false;
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Retry connection / refresh" }),
    ),
  );
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: /Harbor House/ })),
  );
  assert.deepEqual(
    b.contexts.at(-1),
    { content: [] },
    "opening a job does not silently attach private content",
  );
  await act(async () =>
    fireEvent.click(ui.getByLabelText("Share this job with this conversation")),
  );
  assert.match(b.contexts.at(-1).content[0].text, /sample-harbor/);
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Ask what’s next" })),
  );
  assert.deepEqual(b.messages[0]._meta, {
    "openai/message": { target: "active", send: true },
  });
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "← Projects" })),
  );
  assert.deepEqual(b.contexts.at(-1), { content: [] });
  cleanup();
});
test("a model-prepared draft opens directly; uncertain saves retain the same review and confirmation", async () => {
  const b = bridge(),
    ui = await mount(b),
    p = sampleProject().project;
  await result(
    b,
    {
      kind: "draft",
      draftId: "draft-a",
      recordType: "project",
      revision: p,
      destination: { title: "Chosen workbook" },
    },
    { confirmation: "c".repeat(43), expectedRevisionId: "" },
  );
  assert.ok(ui.getByRole("button", { name: "Save draft" }));
  assert.equal(b.calls.length, 0);
  b.callServerTool = async (args) => {
    b.calls.push(args);
    throw new Error("Google save result uncertain");
  };
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Save draft" })),
  );
  assert.equal(
    ui.queryByRole("button", { name: "Retry connection / refresh" }),
    null,
    "refresh cannot discard an uncertain review",
  );
  assert.ok(ui.getByRole("button", { name: "Keep editing instead" }).disabled);
  await act(async () =>
    fireEvent.click(
      ui.getByRole("button", { name: "Retry / confirm this save" }),
    ),
  );
  assert.deepEqual(b.calls[0], b.calls[1]);
  cleanup();
});
test("closing a project review keeps its proposed fields editable", async () => {
  const b = bridge(),
    ui = await mount(b),
    p = {
      ...sampleProject().project,
      title: "Retained edit",
      city: "Freeport",
    };
  await result(
    b,
    {
      kind: "draft",
      draftId: "draft-a",
      recordType: "project",
      revision: p,
      destination: { title: "Chosen workbook" },
    },
    { confirmation: "c".repeat(43), expectedRevisionId: "" },
  );
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Keep editing instead" })),
  );
  assert.equal(ui.getByLabelText("Project name").value, "Retained edit");
  fireEvent.click(ui.getByRole("button", { name: "Location" }));
  assert.equal(ui.getByLabelText("City").value, "Freeport");
  cleanup();
});
test("a confirmed rejection before writing unlocks editing and offers the latest source", async () => {
  const b = bridge(),
    ui = await mount(b),
    p = sampleProject().project;
  await result(
    b,
    {
      kind: "draft",
      draftId: "preflight",
      recordType: "project",
      revision: p,
      destination: { title: "Chosen workbook" },
    },
    { confirmation: "c".repeat(43), expectedRevisionId: "old-revision" },
  );
  b.callServerTool = async () => ({
    isError: true,
    content: [{ type: "text", text: "The record changed in Google" }],
    _meta: { "streamlion/safeToEdit": true },
  });
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Save draft" })),
  );
  assert.equal(
    ui.getByRole("button", { name: "Keep editing instead" }).disabled,
    false,
  );
  fireEvent.click(ui.getByRole("button", { name: "Load latest project" }));
  assert.ok(ui.getByRole("heading", { name: "Keep your unsaved changes?" }));
});
test("a verified project save keeps the editor open with the saved revision as its new baseline", async () => {
  const b = bridge(),
    ui = await mount(b),
    data = { ...sampleProject(), sample: false };
  data.project = {
    ...data.project,
    revisionId: "saved-r2",
    title: "Normalized title",
  };
  b.callServerTool = async (args) => {
    b.calls.push(args);
    if (args.name === "save_streamlion_review")
      return response({
        kind: "saved",
        projectId: data.project.id,
        revisionId: "saved-r2",
        destination: data.destination,
      });
    if (args.name === "get_streamlion_project") return response(data);
    return {
      structuredContent: {
        kind: "draft",
        draftId: "follow-up",
        recordType: "project",
        revision: { ...data.project, ...args.arguments.fields },
        destination: data.destination,
      },
      _meta: {
        confirmation: "c".repeat(43),
        expectedRevisionId: args.arguments.expectedRevisionId,
      },
    };
  };
  await result(
    b,
    {
      kind: "draft",
      draftId: "first",
      recordType: "project",
      revision: { ...data.project, title: " Normalized title " },
      destination: data.destination,
    },
    { confirmation: "c".repeat(43), expectedRevisionId: "" },
  );
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Save draft" })),
  );
  assert.ok(ui.getByRole("heading", { name: "Edit project" }));
  assert.equal(ui.getByLabelText("Project name").value, "Normalized title");
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Follow-up edit" },
  });
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Review changes" })),
  );
  const prepared = b.calls.at(-1);
  assert.equal(prepared.arguments.expectedRevisionId, "saved-r2");
  assert.equal(prepared.arguments.fields.title, "Follow-up edit");
});
test("incoming tool views preserve typed notes, and an unsaved checklist is labelled as a working copy", async () => {
  const b = bridge(),
    ui = await mount(b),
    data = { ...sampleProject(), sample: false };
  await result(b, data);
  fireEvent.click(ui.getByRole("button", { name: "Field notes" }));
  fireEvent.change(ui.getByLabelText("Observation"), {
    target: { value: "Keep my unfinished observation" },
  });
  fireEvent.click(ui.getByRole("button", { name: "← Projects" }));
  assert.ok(ui.getByRole("heading", { name: "Keep your unsaved changes?" }));
  assert.equal(b.calls.length, 0);
  fireEvent.click(ui.getByRole("button", { name: "Keep editing" }));
  await result(b, {
    kind: "projects",
    projects: [],
    destination: data.destination,
  });
  assert.match(ui.container.textContent, /ChatGPT has a new view ready/);
  assert.equal(
    ui.getByLabelText("Observation").value,
    "Keep my unfinished observation",
  );
  fireEvent.click(ui.getByRole("button", { name: "Work" }));
  fireEvent.change(
    ui.getByLabelText(
      "Status for Check kitchen length and width against the tape",
    ),
    { target: { value: "done" } },
  );
  fireEvent.click(ui.getByRole("button", { name: "Handover" }));
  assert.match(
    ui.container.querySelector(".handover-preview").textContent,
    /Working copy/,
  );
  assert.match(
    ui.container.textContent,
    /checklist changes that have not been saved/,
  );
});
test("sample forms retain their input across tabs and organize units without a model call", async () => {
  const b = bridge(),
    ui = await mount(b);
  fireEvent.click(ui.getByRole("button", { name: "Try a sample job" }));
  fireEvent.click(ui.getByRole("button", { name: "Measurements" }));
  fireEvent.change(ui.getByLabelText("Room or space"), {
    target: { value: "Front office" },
  });
  fireEvent.change(ui.getByLabelText("Readings"), {
    target: { value: "Length 12 ft 6 in. Width 10 ft." },
  });
  assert.match(
    ui.container.querySelector(".measurement-preview").textContent,
    /12½′|12′ 6″/,
  );
  fireEvent.click(ui.getByRole("button", { name: "Overview" }));
  fireEvent.click(ui.getByRole("button", { name: "Measurements" }));
  assert.equal(ui.getByLabelText("Room or space").value, "Front office");
  assert.equal(b.calls.length, 0);
  cleanup();
});
test("handover defaults exclude unchecked evidence and payment; no nested iframe or source execution", async () => {
  const b = bridge(),
    ui = await mount(b),
    data = sampleProject();
  data.notes.push({
    id: "private-a",
    jobId: data.project.id,
    area: "Private attic",
    text: "<img src=x onerror=alert(1)>",
    reviewed: false,
  });
  await result(b, data);
  fireEvent.click(ui.getByRole("button", { name: "Handover" }));
  let report = ui.container.querySelector(".handover-preview");
  assert.ok(!report.textContent.includes("Private attic"));
  assert.ok(!report.textContent.includes("Payment record"));
  assert.equal(ui.container.querySelector("iframe"), null);
  fireEvent.click(ui.getByLabelText("Include unchecked field records"));
  report = ui.container.querySelector(".handover-preview");
  assert.ok(report.textContent.includes("Private attic"));
  assert.equal(report.querySelector("img"), null);
  cleanup();
});
test("deep links are scoped project IDs; attached context has a stable timestamp and no unrelated job", () => {
  assert.equal(
    extensionDeepLink({ "openai/deepLink": { url: "/projects/job-a" } }),
    "job-a",
  );
  assert.equal(
    extensionDeepLink({
      "openai/deepLink": { url: "https://evil.example/job-a" },
    }),
    "",
  );
  assert.equal(
    extensionDeepLink({
      "openai/deepLink": { url: "/projects/job-a?book=other" },
    }),
    "",
  );
  const data = sampleProject(),
    one = extensionContext(data);
  assert.deepEqual(one, extensionContext(data));
  assert.equal(one.content[0]._meta["openai/title"], "Harbor House");
  assert.deepEqual(extensionContext(null), { content: [] });
});
