import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  localStorage: dom.window.localStorage,
  IS_REACT_ACT_ENVIRONMENT: true,
});
dom.window.scrollTo = () => {};
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});

const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: ProjectEditor } = await import("./ProjectEditor.jsx");
const { chatUrl } = await import("./ChatGPTPanel.jsx");
const { FIELD_HELP } = await import("./FieldHelp.jsx");
const { PROJECT_FIELDS } = await import("./project-schema.js");
const { default: Jobs } = await import("./Jobs.jsx");

test("project wizard starts with the ChatGPT action and reveals one field group at a time", () => {
  localStorage.clear();
  const ui = render(
    <ProjectEditor
      onSave={async () => {}}
      onCancel={() => {}}
      bookId="workbook123"
      draftScope="wizard-test"
    />,
  );
  const launch = ui.getByRole("link", { name: /Prepare my brief in ChatGPT/ });
  assert.equal(new URL(launch.href).pathname, "/");
  assert.equal(new URL(launch.href).searchParams.get("hints"), null);
  assert.equal(ui.queryByLabelText("Project name"), null);

  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  assert.ok(ui.getByLabelText("Project name"));
  assert.equal(ui.queryByLabelText("Street address"), null);
  fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  assert.ok(ui.getByLabelText("Street address"));
  assert.equal(ui.queryByLabelText("Project name"), null);
  cleanup();
});

test("empty client-template selection leaves custom draft details unchanged", async () => {
  localStorage.clear();
  let saved;
  const ui = render(
    <ProjectEditor
      draftScope="empty-template-test"
      templates={[
        {
          name: "Client one",
          project: {
            id: "template",
            title: "Template",
            companyName: "Template company",
            scope: "Template scope",
            paymentTerms: "Template terms",
          },
        },
      ]}
      onSave={async (fields) => {
        saved = fields;
      }}
      onCancel={() => {}}
    />,
  );
  const templateLabel = "Start with an approved client checklist";
  fireEvent.change(ui.getByLabelText(templateLabel), {
    target: { value: "0" },
  });
  assert.equal(
    ui.getByLabelText("Commissioning company").value,
    "Template company",
  );
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Custom job" },
  });
  fireEvent.change(ui.getByLabelText("Commissioning company"), {
    target: { value: "Custom company" },
  });
  fireEvent.change(ui.getByLabelText("Go to section"), {
    target: { value: "5" },
  });
  fireEvent.change(ui.getByLabelText("Scope of work"), {
    target: { value: "Custom scope" },
  });
  fireEvent.change(ui.getByLabelText("Go to section"), {
    target: { value: "6" },
  });
  fireEvent.change(ui.getByLabelText("Payment terms and trigger"), {
    target: { value: "Custom terms" },
  });
  fireEvent.change(ui.getByLabelText("Go to section"), {
    target: { value: "0" },
  });
  fireEvent.change(ui.getByLabelText(templateLabel), { target: { value: "" } });
  assert.ok(ui.getByRole("heading", { name: "Start with your project brief" }));
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Save draft on device" })),
  );
  assert.equal(saved.companyName, "Custom company");
  assert.equal(saved.scope, "Custom scope");
  assert.equal(saved.paymentTerms, "Custom terms");
  cleanup();
});

test("manual project details survive the steps and reach save unchanged", async () => {
  localStorage.clear();
  let saved;
  const ui = render(
    <ProjectEditor
      onSave={async (...args) => {
        saved = args;
      }}
      onCancel={() => {}}
      draftScope="manual-save-test"
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Test property" },
  });
  for (let index = 0; index < 7; index++) {
    fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  }
  fireEvent.change(ui.getByLabelText("Sources: document, page, passage"), {
    target: { value: "Customer brief, page 1" },
  });
  fireEvent.click(
    ui.getByLabelText("I checked these details against the source documents"),
  );
  await act(async () => {
    fireEvent.click(ui.getByRole("button", { name: "Save reviewed project" }));
  });
  assert.equal(saved[0].title, "Test property");
  assert.equal(saved[0].sourceNotes, "Customer brief, page 1");
  assert.equal(saved[2], true);
  cleanup();
});

test("Save draft is available in the editor header before Finish", async () => {
  localStorage.clear();
  let saved;
  const ui = render(
    <ProjectEditor
      draftScope="header-save-test"
      bookId="workbook123"
      googleReady
      onSave={async (...args) => {
        saved = args;
      }}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Nassau Street" },
  });
  await act(async () => {
    fireEvent.click(ui.getByRole("button", { name: "Save draft to Google" }));
  });
  assert.equal(saved[0].title, "Nassau Street");
  assert.equal(saved[2], false);
  cleanup();
});

test("a remembered workbook requires reconnection before saving", () => {
  localStorage.clear();
  let reconnect = false;
  const ui = render(
    <ProjectEditor
      bookId="workbook123"
      onSave={async () => {}}
      onCancel={() => {}}
      onConnectGoogle={() => {
        reconnect = true;
      }}
    />,
  );
  assert.equal(
    ui.getByRole("button", { name: "Save draft to Google" }).disabled,
    true,
  );
  assert.match(
    ui.getByRole("status").textContent,
    /connection needs to be renewed/,
  );
  assert.match(
    ui.getByRole("region", { name: "Where this project is saved" }).textContent,
    /selected on this device, but Google is not connected/,
  );
  assert.doesNotMatch(
    ui.getByRole("region", { name: "Where this project is saved" }).textContent,
    /workbook is connected/,
  );
  fireEvent.click(ui.getByRole("button", { name: "Reconnect Google" }));
  assert.equal(reconnect, true);
  cleanup();
});

test("any numbered step opens directly and keeps entered details", () => {
  localStorage.clear();
  const ui = render(
    <ProjectEditor
      draftId="draft-jump"
      draftScope="jump-test"
      onSave={async () => {}}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: /Step 3: Where is the site/ }),
  );
  fireEvent.change(ui.getByLabelText("City"), {
    target: { value: "Brooklyn" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: /Step 2: Identify the project/ }),
  );
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Nassau Street" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: /Step 3: Where is the site/ }),
  );
  assert.equal(ui.getByLabelText("City").value, "Brooklyn");
  cleanup();
});

test("Step 1 explains the workbook and opens Connections when needed", () => {
  localStorage.clear();
  let connect = false;
  const ui = render(
    <ProjectEditor
      draftScope="no-book"
      onSave={async () => {}}
      onCancel={() => {}}
      onConnectGoogle={() => {
        connect = true;
      }}
    />,
  );
  assert.match(
    ui.getByRole("region", { name: "Where this project is saved" }).textContent,
    /draft stays on this device/,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Connect Google and choose a workbook" }),
  );
  assert.equal(connect, true);
  cleanup();
});

test("Projects shows a named unfinished draft, its count and edit/delete controls", () => {
  const draft = {
    scope: "local",
    draftId: "draft-a",
    fields: {
      title: "Nassau Street",
      city: "Brooklyn",
      startLocal: "2026-10-01T10:00",
    },
  };
  let edited = false;
  let deleted = false;
  const ui = render(
    <Jobs
      workspace={{ jobs: [], notes: [] }}
      bookId="workbook123"
      drafts={[draft]}
      onCreate={() => {}}
      onResumeDraft={() => {
        edited = true;
      }}
      onDeleteDraft={() => {
        deleted = true;
      }}
    />,
  );
  assert.equal(
    ui.getByText("Projects and named drafts").previousElementSibling
      .textContent,
    "1",
  );
  assert.ok(ui.getByText("Nassau Street"));
  assert.ok(ui.getByText("Brooklyn"));
  assert.ok(ui.getByText("Oct 1, 2026"));
  assert.ok(ui.getByText("Needs review"));
  assert.ok(ui.getByRole("searchbox", { name: "Find a project" }));
  fireEvent.click(ui.getByRole("button", { name: "Edit" }));
  fireEvent.click(ui.getByRole("button", { name: "Delete" }));
  assert.equal(edited, true);
  assert.equal(deleted, true);
  cleanup();
});

test("ChatGPT handoff uses ordinary chat without private plugin or customer data in the URL", () => {
  const url = new URL(chatUrl({ mode: "create", bookId: "workbook123" }));
  assert.equal(url.origin, "https://chatgpt.com");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("surface"), null);
  assert.equal(url.searchParams.get("hints"), null);
  assert.match(url.searchParams.get("prompt"), /brief I will upload/);
  assert.match(
    url.searchParams.get("prompt"),
    /Do not add keys or save anything to Google/,
  );
  const projectUrl = chatUrl({
    project: { id: "opaque-123", title: "Private Customer Name" },
    bookId: "workbook123",
  });
  assert.ok(!projectUrl.includes("opaque-123"));
  assert.ok(!projectUrl.includes("Private+Customer+Name"));
  assert.ok(!projectUrl.includes("workbook123"));
});

test("each project field has a help explanation", () => {
  assert.deepEqual(
    PROJECT_FIELDS.filter((field) => !FIELD_HELP[field.key]).map(
      (field) => field.key,
    ),
    [],
  );
});

test.afterEach(() => cleanup());
test.after(() => dom.window.close());
