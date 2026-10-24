import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<html><body></body></html>", {
  url: "https://app.example/pilot/",
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
const { default: PilotControls } = await import("./PilotControls.jsx");
const now = Date.now();
const policy = {
  revision: 4,
  active_cap: 5,
  admission_cap: 7,
  duration_days: 7,
  application_start: now - 86400000,
  application_end: now + 30 * 86400000,
  closes_at: now + 45 * 86400000,
  interest_open: 1,
  admissions_open: 0,
  admission_mode: "manual",
  reopen_at: now + 86400000,
  reopen_slots: 2,
};
const counts = { admissions: 6, active: 2, reserved: 1 };
function reason(ui) {
  fireEvent.change(ui.getByLabelText("Policy note (optional)"), {
    target: { value: "Owner approved opening" },
  });
}
test("controls show live counts, UTC fields and send complete revision checked settings", (t) => {
  t.after(cleanup);
  const calls = [];
  const ui = render(
    <PilotControls
      policy={policy}
      counts={counts}
      perform={(...v) => calls.push(v)}
    />,
  );
  assert.match(ui.getByText(/Current active/).textContent, /2.*1/);
  assert.match(ui.getByText(/Cumulative admissions/).textContent, /6.*7/);
  reason(ui);
  fireEvent.change(ui.getByLabelText("Admission mode"), {
    target: { value: "instant" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save pilot settings" }));
  assert.equal(calls[0][0], "admin/settings");
  assert.equal(calls[0][1].revision, 4);
  assert.equal(calls[0][1].admissionMode, "instant");
  assert.equal(calls[0][1].admissionsOpen, false);
  assert.equal(calls[0][1].durationDays, 7);
  assert.equal(
    calls[0][1].applicationStart,
    Math.floor(policy.application_start / 60000) * 60000,
  );
});
test("invalid UTC date never submits; stale policy replacement refreshes revision and form", (t) => {
  t.after(cleanup);
  const calls = [];
  const perform = (...v) => calls.push(v);
  const ui = render(
    <PilotControls policy={policy} counts={counts} perform={perform} />,
  );
  reason(ui);
  fireEvent.change(ui.getByLabelText("Applications close (UTC)"), {
    target: { value: "" },
  });
  fireEvent.submit(
    ui.getByRole("button", { name: "Save pilot settings" }).closest("form"),
  );
  assert.match(ui.getByRole("alert").textContent, /valid UTC/);
  assert.equal(calls.length, 0);
  ui.rerender(
    <PilotControls
      policy={{ ...policy, revision: 5, active_cap: 3 }}
      counts={counts}
      perform={perform}
    />,
  );
  assert.equal(ui.getByLabelText("Maximum active places").value, "3");
  reason(ui);
  fireEvent.click(ui.getByRole("button", { name: "Save pilot settings" }));
  assert.equal(calls[0][1].revision, 5);
});
test("one-time schedule, cancel and pause use distinct action-specific requests", (t) => {
  t.after(cleanup);
  const calls = [];
  const ui = render(
    <PilotControls
      policy={policy}
      counts={counts}
      perform={(...v) => calls.push(v)}
    />,
  );
  reason(ui);
  fireEvent.change(ui.getByLabelText("Additional places"), {
    target: { value: "3" },
  });
  fireEvent.change(ui.getByLabelText("Add places on (UTC)"), {
    target: { value: new Date(now + 2 * 86400000).toISOString().slice(0, 16) },
  });
  const save = ui.getByRole("button", { name: "Schedule one-time addition" });
  assert(save.disabled);
  fireEvent.click(ui.getByLabelText(/I confirm this future UTC/));
  fireEvent.click(save);
  assert.equal(calls[0][0], "admin/schedule");
  assert.equal(calls[0][1].slots, 3);
  assert.deepEqual(Object.keys(calls[0][1]).sort(), [
    "reason",
    "reopenAt",
    "revision",
    "slots",
  ]);
  fireEvent.click(
    ui.getByRole("button", { name: "Cancel scheduled addition only" }),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Pause admissions and cancel schedule" }),
  );
  assert.deepEqual(calls.slice(1), [
    [
      "admin/cancel-schedule",
      { revision: 4, reason: "Owner approved opening" },
    ],
    ["admin/pause", { revision: 4, reason: "Owner approved opening" }],
  ]);
});
test("schedule outside window or beyond total budget is rejected before request", (t) => {
  t.after(cleanup);
  const calls = [];
  const ui = render(
    <PilotControls
      policy={policy}
      counts={counts}
      perform={(...v) => calls.push(v)}
    />,
  );
  reason(ui);
  fireEvent.change(ui.getByLabelText("Additional places"), {
    target: { value: "20" },
  });
  fireEvent.click(ui.getByLabelText(/I confirm this future UTC/));
  fireEvent.submit(
    ui
      .getByRole("button", { name: "Schedule one-time addition" })
      .closest("form"),
  );
  assert.equal(calls.length, 0);
  assert.match(ui.getByRole("alert").textContent, /20/);
});

test("routine controls stay visible and every action supplies an audited default reason", (t) => {
  t.after(cleanup);
  const calls = [];
  const ui = render(
    <PilotControls
      policy={{ ...policy, admission_mode: "instant" }}
      counts={counts}
      perform={(...args) => calls.push(args)}
    />,
  );
  const details = ui
    .getByText("Pilot setup and availability")
    .closest("details");
  assert.equal(details.open, false);
  assert.equal(
    ui.getByLabelText("Maximum active places").closest("details"),
    null,
  );
  assert.equal(ui.getByLabelText("Additional places").closest("details"), null);
  assert.equal(ui.getByLabelText("Policy note (optional)").required, false);
  fireEvent.click(ui.getByRole("button", { name: "Save pilot settings" }));
  fireEvent.click(ui.getByLabelText(/I confirm this future UTC/));
  fireEvent.click(
    ui.getByRole("button", { name: "Schedule one-time addition" }),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Cancel scheduled addition only" }),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Pause admissions and cancel schedule" }),
  );
  assert.equal(calls.length, 4);
  assert.equal(new Set(calls.map(([, body]) => body.reason)).size, 4);
  for (const [, body] of calls) assert(body.reason.length > 10);
  ui.rerender(
    <PilotControls
      policy={{ ...policy, application_start: null }}
      counts={counts}
      perform={() => {}}
    />,
  );
  assert.equal(
    ui.getByText("Pilot setup and availability").closest("details").open,
    true,
  );
});

test("paused settings may clear a pending schedule but active limit cannot exceed total", (t) => {
  t.after(cleanup);
  const calls = [];
  const ui = render(
    <PilotControls
      policy={{ ...policy, admission_cap: 19, reopen_slots: 1 }}
      counts={counts}
      perform={(...args) => calls.push(args)}
    />,
  );
  fireEvent.change(ui.getByLabelText("Total admission limit"), {
    target: { value: "20" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save pilot settings" }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].admissionsOpen, false);
  fireEvent.change(ui.getByLabelText("Total admission limit"), {
    target: { value: "6" },
  });
  fireEvent.change(ui.getByLabelText("Maximum active places"), {
    target: { value: "7" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save pilot settings" }));
  assert.equal(calls.length, 1);
  assert.match(ui.getByRole("alert").textContent, /active limit/);
});

test("schedule rejects a start whose full duration reaches the closing boundary", (t) => {
  t.after(cleanup);
  const calls = [];
  const reopenAt = Math.ceil((now + 86400000) / 60000) * 60000;
  const ui = render(
    <PilotControls
      policy={{
        ...policy,
        reopen_at: reopenAt,
        closes_at: reopenAt + 7 * 86400000,
      }}
      counts={counts}
      perform={(...args) => calls.push(args)}
    />,
  );
  fireEvent.click(ui.getByLabelText(/I confirm this future UTC/));
  fireEvent.click(
    ui.getByRole("button", { name: "Schedule one-time addition" }),
  );
  assert.equal(calls.length, 0);
  assert.match(ui.getByRole("alert").textContent, /full pilot duration/);
});
