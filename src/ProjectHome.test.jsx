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
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: ProjectHome } = await import("./ProjectHome.jsx");
const { readWorkflow, WORKFLOW_AREA } = await import("./workflow.js");
const { writeDraft } = await import("./drafts.js");

test("project home saves a reasoned exception, retains unfinished checklist on navigation, and separates delivery", async () => {
  const project = {
    id: "job",
    title: "Synthetic",
    deviceOnly: true,
    deliverables: "Rear room capture",
    scope: "Interior",
    reviewState: "reviewed",
  };
  let saved;
  const props = {
    project,
    notes: [],
    scope: "local",
    connected: false,
    onEdit: () => {},
    onAsk: () => {},
    onBack: () => {},
    onNotes: () => {},
    onRepeat: () => {},
    onSave: async (plan, base) => {
      saved = { plan, base };
    },
  };
  let ui = render(<ProjectHome {...props} />);
  fireEvent.click(
    ui.getByRole("button", { name: "Use the requested outputs" }),
  );
  fireEvent.change(ui.getByLabelText("Status: Rear room capture"), {
    target: { value: "blocked" },
  });
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Save checklist" })),
  );
  assert.ok(ui.getByRole("alert"));
  assert.equal(saved, undefined);
  fireEvent.change(ui.getByLabelText("Explain why (required)"), {
    target: { value: "Room locked; client requested a return visit" },
  });
  cleanup();
  ui = render(<ProjectHome {...props} />);
  assert.equal(ui.getByLabelText("Status: Rear room capture").value, "blocked");
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Save checklist" })),
  );
  assert.equal(
    saved.plan.requirements[0].reason,
    "Room locked; client requested a return visit",
  );
  assert.equal(saved.base, "");
  fireEvent.click(ui.getByRole("button", { name: "3. Before leaving" }));
  assert.equal(
    ui.getByRole("button", { name: "Record capture finished" }).disabled,
    true,
  );
  fireEvent.click(ui.getByRole("button", { name: "4. Delivery" }));
  assert.equal(ui.getByLabelText("Delivery status").value, "not-sent");
  fireEvent.change(ui.getByLabelText("Delivery status"), {
    target: { value: "accepted" },
  });
  await act(async () =>
    fireEvent.click(ui.getByRole("button", { name: "Save checklist" })),
  );
  assert.equal(saved.plan.delivery, "accepted");
  assert.equal(saved.plan.visit, "not-started");
  assert.ok(saved.plan.acceptedAt);
  cleanup();
});
test("verified checklist retry clears only matching local edits and keeps newer edits visibly stale", async () => {
  localStorage.clear();
  const project = { id: "job", title: "Synthetic", deviceOnly: false };
  const plan = readWorkflow([], project);
  plan.requirements = [
    {
      id: "req",
      label: "Check door",
      area: "Door",
      state: "done",
      reason: "",
      evidence: [],
    },
  ];
  const props = {
    project,
    scope: "book",
    connected: true,
    onEdit: () => {},
    onBack: () => {},
    onNotes: () => {},
    onSave: async () => {},
  };
  writeDraft("book:checklist:job", { plan, base: "" });
  const ui = render(<ProjectHome {...props} notes={[]} />);
  assert.ok(ui.getByRole("button", { name: "Save checklist" }));
  const verified = {
    id: "meta",
    jobId: "job",
    area: WORKFLOW_AREA,
    text: JSON.stringify(plan),
  };
  await act(async () =>
    ui.rerender(<ProjectHome {...props} notes={[verified]} />),
  );
  assert.equal(ui.queryByRole("button", { name: "Save checklist" }), null);
  fireEvent.change(ui.getByLabelText("Status: Check door"), {
    target: { value: "todo" },
  });
  const changedElsewhere = {
    ...plan,
    siteLessons: "Changed by another editor",
  };
  await act(async () =>
    ui.rerender(
      <ProjectHome
        {...props}
        notes={[{ ...verified, text: JSON.stringify(changedElsewhere) }]}
      />,
    ),
  );
  assert.equal(ui.getByLabelText("Status: Check door").value, "todo");
  assert.equal(
    ui.getByRole("button", { name: "Save checklist" }).disabled,
    true,
  );
  assert.match(ui.getByRole("alert").textContent, /changed elsewhere/);
  cleanup();
});
test.after(() => dom.window.close());
