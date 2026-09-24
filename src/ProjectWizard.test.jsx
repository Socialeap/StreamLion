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
  const launch = ui.getByRole("link", { name: /Open StreamLion chat/ });
  assert.equal(new URL(launch.href).pathname, "/");
  assert.match(new URL(launch.href).searchParams.get("prompt"), /workbook123/);
  assert.equal(ui.queryByLabelText("Project name"), null);

  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  assert.ok(ui.getByLabelText("Project name"));
  assert.equal(ui.queryByLabelText("Street address"), null);
  fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  assert.ok(ui.getByLabelText("Street address"));
  assert.equal(ui.queryByLabelText("Project name"), null);
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

test("ChatGPT link opens a Work chat with StreamLion selected and a drafted message", () => {
  const url = new URL(chatUrl({ mode: "create", bookId: "workbook123" }));
  assert.equal(url.origin, "https://chatgpt.com");
  assert.equal(url.pathname, "/");
  assert.equal(url.searchParams.get("surface"), "work");
  assert.match(url.searchParams.get("hints"), /^plugin:plugin_/);
  assert.match(url.searchParams.get("prompt"), /specifications I will upload/);
  assert.match(url.searchParams.get("prompt"), /workbook123/);
  const projectUrl = chatUrl({
    project: { id: "opaque-123", title: "Private Customer Name" },
    bookId: "workbook123",
  });
  assert.ok(projectUrl.includes("opaque-123"));
  assert.ok(!projectUrl.includes("Private+Customer+Name"));
});

test("each project field has a help explanation", () => {
  assert.deepEqual(
    PROJECT_FIELDS.filter((field) => !FIELD_HELP[field.key]).map(
      (field) => field.key,
    ),
    [],
  );
});

test.after(() => dom.window.close());
