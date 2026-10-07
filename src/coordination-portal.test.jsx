import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  newClientJob,
  reduceClientJob,
  clientView,
} from "./client-workflow.js";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example/client/?job=job-a",
});
Object.assign(globalThis, {
  React,
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const { render, fireEvent, cleanup } = await import("@testing-library/react");
const { default: Portal } = await import("./CoordinationPortal.jsx");
function fixture() {
  let job = newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Office",
    now: 1,
  });
  for (const [action, role, extra] of [
    [
      "edit",
      "client",
      {
        fields: {
          address: "1 Main",
          scope: "Whole office",
          deliverables: "Tour",
          accessInstructions: "Meet owner",
        },
      },
    ],
    ["submit", "client", {}],
    ["approve", "client", {}],
    ["approve", "provider", {}],
    ["activate", "system", {}],
  ])
    job = reduceClientJob(
      job,
      { action, expectedRevision: job.revision, ...extra },
      { role },
      job.revision + 2,
    );
  return job;
}
test("client proposes changes and retains the same operation after an interrupted save", async () => {
  const job = fixture(),
    calls = [];
  const api = async (path, body) => {
    if (path === "client/job")
      return { job: clientView(job), brand: "Provider" };
    calls.push({ path, body });
    throw new Error("Synthetic interruption");
  };
  const ui = render(<Portal client api={api} />);
  await ui.findByRole("heading", { name: "Office" });
  assert.equal(ui.queryByLabelText("Amount received"), null);
  fireEvent.change(ui.getByLabelText(/Scope of work/), {
    target: { value: "Only lobby" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Propose these changes" }));
  await ui.findByRole("alert");
  assert.equal(ui.getByLabelText(/Scope of work/).value, "Only lobby");
  assert.equal(calls[0].body.command.action, "propose");
  fireEvent.click(ui.getByRole("button", { name: "Retry original request" }));
  await ui.findByRole("alert");
  assert.equal(calls[1].body.operation, calls[0].body.operation);
  cleanup();
});
test("closed client brief is read-only and payment status identifies its source", async () => {
  let job = fixture();
  job = reduceClientJob(
    job,
    { action: "progress", state: "delivered", expectedRevision: job.revision },
    { role: "provider" },
    7,
  );
  job = reduceClientJob(
    job,
    {
      action: "close",
      reason: "Approved by phone",
      expectedRevision: job.revision,
    },
    { role: "provider" },
    8,
  );
  const ui = render(
    <Portal
      client
      api={async () => ({ job: clientView(job), brand: "Provider" })}
    />,
  );
  await ui.findByRole("heading", { name: "Office" });
  assert.equal(ui.getByLabelText(/Scope of work/).disabled, true);
  assert.equal(
    ui.queryByRole("button", { name: "Save current information" }),
    null,
  );
  fireEvent.click(ui.getByRole("button", { name: "Progress" }));
  await ui.findByText("Payment receipt has not been confirmed.");
  assert.ok(ui.getByText(/Bank settlement is not connected/));
  cleanup();
});
