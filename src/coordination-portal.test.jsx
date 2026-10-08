import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  newClientJob,
  reduceClientJob,
  clientView,
  CLIENT_FIELDS,
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
const { render, fireEvent, cleanup, waitFor, within } =
  await import("@testing-library/react");
const { default: Portal } = await import("./CoordinationPortal.jsx");
const { coordinationDraftKey } = await import("./coordination-drafts.js");
const { offerUpdate } = await import("./updates.js");
const { reviseIntakeTemplate, INTAKE_PRESETS } =
  await import("./intake-templates.js");
const { default: TemplateSettings } =
  await import("./IntakeTemplateSettings.jsx");
const { default: ArchiveSettings } =
  await import("./ArchiveRecoverySettings.jsx");
const accessError = (status, message, serviceUnavailable = false) =>
  Object.assign(new Error(message), { status, serviceUnavailable });
function providerAPI(job) {
  return async (path) => {
    if (path === "provider/status")
      return {
        enabled: true,
        connected: true,
        subject: "a",
        wallet: { available: 7500000 },
        projectMicros: 3000000,
        delivery: { email: true },
      };
    if (path === "provider/jobs")
      return { jobs: [job], pending: [], archives: [] };
    if (path === "provider/notifications")
      return { enabled: false, devices: [] };
    throw new Error("Unexpected fixture request: " + path);
  };
}
test("archive form retries the original recovery identity and holds new inputs behind a pending writer", async (t) => {
  t.after(cleanup);
  const calls = [];
  const restore = async (body) => {
    calls.push({ ...body });
    return calls.length > 1 ? { complete: true } : undefined;
  };
  const ui = render(
    <ArchiveSettings busy={false} recovering={false} restore={restore} />,
  );
  fireEvent.change(ui.getByLabelText("Archive file link or ID"), {
    target: { value: "archive-id" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Verify and recover archived job" }),
  );
  await waitFor(() => assert.equal(calls.length, 1));
  fireEvent.click(
    ui.getByRole("button", { name: "Verify and recover archived job" }),
  );
  await waitFor(() => assert.equal(calls.length, 2));
  assert.equal(calls[0].operation, calls[1].operation);
  await waitFor(() =>
    assert.equal(ui.getByLabelText("Archive file link or ID").value, ""),
  );
  ui.rerender(
    <ArchiveSettings busy={false} recovering={true} restore={restore} />,
  );
  assert.equal(ui.getByLabelText("Archive file link or ID").disabled, true);
  assert.equal(
    ui.getByRole("button", { name: "Verify and recover archived job" })
      .disabled,
    true,
  );
});
test("verified archive recovery selects archived history and permits only a reasoned reopen", async (t) => {
  t.after(cleanup);
  const job = { ...fixture(), state: "archived", closedAt: 2, archiveAt: 3 };
  let recovered = false;
  const base = providerAPI(job),
    calls = [];
  const ui = render(
    <Portal
      api={async (path, body) => {
        if (path === "provider/jobs")
          return { jobs: recovered ? [job] : [], pending: [], archives: [] };
        if (path === "provider/archive-restore") {
          recovered = true;
          calls.push(body);
          return { complete: true, jobId: job.id, archived: true };
        }
        if (path === "provider/command") {
          calls.push(body);
          Object.assign(
            job,
            reduceClientJob(job, body.command, { role: "provider" }, 20),
          );
          return { complete: true };
        }
        return base(path, body);
      }}
    />,
  );
  await ui.findByRole("heading", { name: "Invite a client" });
  fireEvent.change(ui.getByLabelText("Archive file link or ID"), {
    target: { value: "archive-id" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Verify and recover archived job" }),
  );
  await ui.findByText(
    "Archive recovery verified. The job remains archived and client access remains expired.",
  );
  assert.equal(calls.length, 1);
  assert.equal(ui.queryByLabelText("Private project link"), null);
  fireEvent.click(ui.getByRole("button", { name: "Progress", exact: true }));
  assert.equal(
    ui.getByRole("button", { name: "Reopen for correction" }).disabled,
    true,
  );
  assert.equal(
    ui.queryByRole("button", { name: "Extend client access 90 days" }),
    null,
  );
  assert.equal(
    ui.queryByRole("button", { name: "Send a fresh client sign-in link" }),
    null,
  );
  assert.equal(
    ui.queryByRole("button", { name: "Restore provider view" }),
    null,
  );
  fireEvent.change(ui.getByLabelText("Reason to reopen"), {
    target: { value: "Correct a delivery detail" },
  });
  assert.equal(
    ui.getByRole("button", { name: "Reopen for correction" }).disabled,
    false,
  );
  fireEvent.click(ui.getByRole("button", { name: "Reopen for correction" }));
  await ui.findByText(
    /Provider reopened for correction.*Correct a delivery detail/,
  );
  assert.equal(job.reopenReason, "Correct a delivery detail");
  assert.equal(job.reopenedAt, 20);
});
test("a provider creates an invitation with the selected saved service version", async (t) => {
  t.after(cleanup);
  const job = fixture(),
    base = providerAPI(job),
    calls = [];
  const record = reviseIntakeTemplate(
    null,
    {
      id: "intake-capture",
      provider: "a",
      expectedVersion: 0,
      config: INTAKE_PRESETS[0],
    },
    1,
  );
  const ui = render(
    <Portal
      api={async (path, body) => {
        if (path === "provider/jobs")
          return {
            jobs: [job],
            pending: [],
            archives: [],
            templates: [record],
          };
        if (path === "provider/create") {
          calls.push(body);
          return {
            jobId: "job-new",
            url: "https://app.example/api/client-portal?job=job-new",
          };
        }
        return base(path);
      }}
    />,
  );
  await ui.findByRole("heading", { name: "Invite a client" });
  fireEvent.change(ui.getByLabelText("Service & intake"), {
    target: { value: record.id },
  });
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "New office" },
  });
  fireEvent.change(ui.getByLabelText("Client email"), {
    target: { value: "client@example.com" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Create request & invite" }));
  await ui.findByText(/Invitation queued/);
  assert.deepEqual(calls[0].template, { id: record.id, version: 1 });
  assert.equal(calls[0].config, undefined);
});
test("conditional service questions respond to unsaved answers without deleting hidden wording", async (t) => {
  t.after(cleanup);
  const record = reviseIntakeTemplate(
    null,
    {
      id: "intake-capture",
      provider: "a",
      expectedVersion: 0,
      config: {
        name: "Capture",
        questions: [
          {
            field: "propertySizeSqFt",
            label: "Capture area",
            help: "",
            required: true,
          },
          {
            field: "notes",
            label: "Large-site preparation",
            help: "",
            required: true,
            when: {
              field: "propertySizeSqFt",
              op: "greater_than",
              value: "10000",
            },
          },
        ],
      },
    },
    1,
  );
  const job = newClientJob({
    id: "job-a",
    provider: "a",
    clientEmail: "client@example.com",
    title: "Office",
    now: 2,
    intakeTemplate: record,
  });
  job.fields.notes = "Keep exact wording 12 7/16";
  job.fields.offeredFee = "100";
  job.fields.currency = "USD";
  const ui = render(
    <Portal
      client
      api={async () => ({ job: clientView(job), brand: "Provider" })}
    />,
  );
  await ui.findByRole("heading", { name: "Office" });
  assert.ok(ui.getByText("Capture · intake version 1"));
  assert.equal(ui.queryByLabelText(/Large-site preparation/), null);
  fireEvent.click(ui.getByRole("button", { name: "Project", exact: true }));
  fireEvent.change(ui.getByLabelText(/Capture area/), {
    target: { value: "12000" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Scope", exact: true }));
  assert.equal(
    ui.getByLabelText(/Large-site preparation/).value,
    "Keep exact wording 12 7/16",
  );
  fireEvent.click(ui.getByRole("button", { name: "Project", exact: true }));
  fireEvent.change(ui.getByLabelText(/Capture area/), {
    target: { value: "9000" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Scope", exact: true }));
  assert.equal(ui.queryByLabelText(/Large-site preparation/), null);
  fireEvent.click(ui.getByRole("button", { name: "Agreement", exact: true }));
  assert.ok(ui.getByText("Large-site preparation"));
  assert.ok(ui.getByText("Offered fee"));
  assert.ok(ui.getByText("100"));
});
test("template editing preserves unsaved wording and blocks a stale save until the provider reloads", async (t) => {
  t.after(cleanup);
  const first = reviseIntakeTemplate(
    null,
    {
      id: "intake-capture",
      provider: "a",
      expectedVersion: 0,
      config: INTAKE_PRESETS[0],
    },
    1,
  );
  const ui = render(
    <TemplateSettings
      templates={[first]}
      busy={false}
      save={async () => assert.fail("A stale save must not be sent")}
    />,
  );
  fireEvent.click(ui.getByText("Services & intake templates"));
  fireEvent.change(ui.getByLabelText("Edit a saved service"), {
    target: { value: first.id },
  });
  fireEvent.change(ui.getByLabelText("Service name"), {
    target: { value: "Keep my service wording" },
  });
  const second = reviseIntakeTemplate(
    first,
    {
      id: first.id,
      provider: "a",
      expectedVersion: 1,
      config: INTAKE_PRESETS[1],
    },
    2,
  );
  ui.rerender(
    <TemplateSettings
      templates={[second]}
      busy={false}
      save={async () => assert.fail("A stale save must not be sent")}
    />,
  );
  assert.equal(
    ui.getByLabelText("Service name").value,
    "Keep my service wording",
  );
  assert.equal(
    ui.getByRole("button", { name: "Save version 2" }).disabled,
    true,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Load the latest saved template" }),
  );
  assert.equal(ui.getByLabelText("Service name").value, "Floor plan");
  assert.equal(
    ui.getByRole("button", { name: "Save version 3" }).disabled,
    false,
  );
});
test("a verified template save followed by a failed refresh retains its original recovery operation", async (t) => {
  t.after(cleanup);
  const base = providerAPI(fixture()),
    calls = [];
  let reads = 0,
    refreshFailure = true;
  const ui = render(
    <Portal
      api={async (path, body) => {
        if (path === "provider/jobs") {
          reads++;
          if (reads > 1 && refreshFailure)
            throw new Error("Synthetic read interruption");
        }
        if (path === "provider/template") {
          calls.push(body);
          return { complete: true };
        }
        return base(path);
      }}
    />,
  );
  await ui.findByRole("heading", { name: "Invite a client" });
  fireEvent.click(ui.getByText("Services & intake templates"));
  fireEvent.change(ui.getByLabelText("Service name"), {
    target: { value: "Capture" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Save service template" }));
  await ui.findByRole("alert");
  assert.equal(
    ui.queryByText(/Service template version 1 saved and verified/),
    null,
  );
  refreshFailure = false;
  fireEvent.click(ui.getByRole("button", { name: "Retry original request" }));
  await waitFor(() => assert.equal(calls.length, 2));
  assert.deepEqual(calls[1], calls[0]);
});
test("paused coordination explains the workflow without presenting sign-in as a fix", async () => {
  const ui = render(
    <Portal
      api={async () => {
        throw accessError(
          503,
          "Client coordination is awaiting activation.",
          true,
        );
      }}
    />,
  );
  await ui.findByRole("heading", {
    name: "Client coordination is unavailable",
  });
  assert.equal(ui.queryByRole("link", { name: "Sign in with Google" }), null);
  assert.ok(ui.getByText(/Signing in with Google does not activate/));
  assert.ok(ui.getByRole("button", { name: "Check availability again" }));
  assert.ok(ui.getByText(/Build the work order/));
  cleanup();
});
test("an available service distinguishes sign-in from a missing Core purchase", async () => {
  for (const status of [401, 403]) {
    const ui = render(
      <Portal
        api={async () => {
          throw accessError(
            status,
            status === 401
              ? "Sign in with Google."
              : "StreamLion Core purchase required.",
          );
        }}
      />,
    );
    await ui.findByRole("heading", {
      name:
        status === 401
          ? "Sign in to manage client requests"
          : "StreamLion Core is required",
    });
    assert.equal(
      Boolean(ui.queryByRole("link", { name: "Sign in with Google" })),
      status === 401,
    );
    if (status === 401)
      assert.match(
        ui
          .getByRole("link", { name: "Sign in with Google" })
          .getAttribute("href"),
        /returnTo=/,
      );
    cleanup();
  }
});
test("checking availability recovers from a paused service without a new sign-in", async () => {
  let paused = true;
  const job = fixture();
  const ready = providerAPI(job);
  const ui = render(
    <Portal
      api={async (path) => {
        if (paused) throw accessError(503, "Paused", true);
        return ready(path);
      }}
    />,
  );
  await ui.findByRole("button", { name: "Check availability again" });
  paused = false;
  fireEvent.click(ui.getByRole("button", { name: "Check availability again" }));
  await ui.findByRole("heading", { name: "Invite a client" });
  assert.equal(
    ui.queryByRole("heading", { name: "Client coordination is unavailable" }),
    null,
  );
  cleanup();
});
test("provider has a copyable job-specific link that contains no verification credential", async () => {
  const job = fixture();
  let copied;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text) => {
        copied = text;
      },
    },
  });
  const ui = render(<Portal api={providerAPI(job)} />);
  await ui.findByRole("heading", { name: "Invite a client" });
  fireEvent.click(ui.getByRole("button", { name: /Office.*Confirmed/ }));
  const link = await ui.findByLabelText("Private project link");
  assert.equal(link.value, "https://app.example/api/client-portal?job=job-a");
  fireEvent.click(ui.getByRole("button", { name: "Copy client link" }));
  await ui.findByText("Project link copied.");
  assert.equal(copied, link.value);
  assert.equal(new URL(copied).hash, "");
  cleanup();
});
test("an exhausted email allowance explains resumption and disables invites while the shared brief remains usable", async (t) => {
  t.after(cleanup);
  const job = fixture(),
    base = providerAPI(job),
    retryAt = Date.UTC(2026, 9, 9);
  const ui = render(
    <Portal
      api={async (path) => {
        const result = await base(path);
        return path === "provider/status"
          ? {
              ...result,
              delivery: { email: false, reason: "daily_limit", retryAt },
            }
          : result;
      }}
    />,
  );
  await ui.findByText(/Email send limit reached/);
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "New request" },
  });
  fireEvent.change(ui.getByLabelText("Client email"), {
    target: { value: "client@example.com" },
  });
  assert.equal(
    ui.getByRole("button", { name: "Create request & invite" }).disabled,
    true,
  );
  fireEvent.click(ui.getByRole("button", { name: /Office.*Confirmed/ }));
  await ui.findByLabelText("Private project link");
  fireEvent.click(ui.getByRole("button", { name: "Progress", exact: true }));
  assert.equal(
    ui.getByRole("button", { name: "Send a fresh client sign-in link" })
      .disabled,
    true,
  );
  fireEvent.click(ui.getByRole("button", { name: "Brief", exact: true }));
  assert.equal(
    within(ui.getByRole("region", { name: "Work order" })).getByLabelText(
      /Scope of work/,
    ).disabled,
    false,
  );
});
test("client can supply all original reference and document links while provider-only fields stay private", async () => {
  const job = fixture();
  const ui = render(
    <Portal
      client
      api={async () => ({ job: clientView(job), brand: "Provider" })}
    />,
  );
  await ui.findByRole("heading", { name: "Office" });
  fireEvent.click(ui.getByRole("button", { name: "Documents" }));
  for (const key of [
    "reference2Name",
    "reference2Url",
    "document1Name",
    "document1Url",
    "document2Name",
    "document2Url",
  ])
    assert.ok(CLIENT_FIELDS.has(key));
  assert.ok(ui.getByLabelText("Reference 2 link"));
  assert.ok(ui.getByLabelText("Document 1 link"));
  assert.ok(ui.getByLabelText("Document 2 link"));
  assert.equal(ui.queryByLabelText("Amount received"), null);
  const updated = reduceClientJob(
    job,
    {
      action: "propose",
      expectedRevision: job.revision,
      fields: { document2Url: "https://example.com/reference.pdf" },
    },
    { role: "client" },
    Date.now(),
  );
  assert.equal(
    updated.proposal.fields.document2Url,
    "https://example.com/reference.pdf",
  );
  cleanup();
});
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
test("client wording survives reopening and a newer shared revision without being silently submitted", async (t) => {
  t.after(cleanup);
  window.localStorage.clear();
  let job = fixture(),
    commands = 0;
  const api = async (path) => {
    if (path === "client/job")
      return { job: clientView(job), brand: "Provider" };
    if (path === "client/notifications") return { enabled: false, devices: [] };
    commands++;
    throw new Error("Unexpected mutation");
  };
  let ui = render(<Portal client api={api} />);
  await ui.findByRole("heading", { name: "Office" });
  fireEvent.change(ui.getByLabelText(/Scope of work/), {
    target: { value: "Exact draft 6 7/16 inches" },
  });
  await ui.findByText(/Draft saved on this device/);
  cleanup();
  ui = render(<Portal client api={api} />);
  await ui.findByRole("heading", { name: "Office" });
  await ui.findByText(/Draft saved on this device/);
  assert.equal(
    ui.getByLabelText(/Scope of work/).value,
    "Exact draft 6 7/16 inches",
  );
  assert.equal(ui.queryByText(/A newer brief arrived/), null);
  cleanup();
  job = {
    ...job,
    revision: job.revision + 1,
    fields: {
      ...job.fields,
      title: "Updated office",
      scope: "Latest agreed scope",
    },
  };
  ui = render(<Portal client api={api} />);
  await ui.findByRole("heading", { name: "Updated office" });
  assert.equal(
    ui.getByLabelText(/Scope of work/).value,
    "Exact draft 6 7/16 inches",
  );
  await ui.findByText(/A newer brief arrived/);
  assert.equal(commands, 0);
  fireEvent.click(
    ui.getByRole("button", {
      name: "Use latest brief and discard my unsaved edit",
    }),
  );
  assert.equal(ui.getByLabelText(/Scope of work/).value, "Latest agreed scope");
  assert.equal(
    window.localStorage.getItem(
      coordinationDraftKey("client", "client", job.id),
    ),
    null,
  );
});
test("client sign-out waits for server acknowledgement and then clears its local drafts", async (t) => {
  t.after(cleanup);
  window.localStorage.clear();
  const job = fixture();
  let unavailable = true;
  const api = async (path) => {
    if (path === "client/job")
      return { job: clientView(job), brand: "Provider" };
    if (path === "client/notifications") return { enabled: false, devices: [] };
    if (path === "client/logout") {
      if (unavailable) throw new Error("Sign-out could not reach the server.");
      return { signedOut: true };
    }
    throw new Error("Unexpected fixture request");
  };
  const ui = render(<Portal client api={api} />);
  await ui.findByRole("heading", { name: "Office" });
  fireEvent.change(ui.getByLabelText(/Scope of work/), {
    target: { value: "Private unsaved wording" },
  });
  await ui.findByText(/Draft saved on this device/);
  fireEvent.click(ui.getByRole("button", { name: "Sign out" }));
  await ui.findByRole("alert");
  assert.equal(
    ui.getByLabelText(/Scope of work/).value,
    "Private unsaved wording",
  );
  assert.ok(
    window.localStorage.getItem(
      coordinationDraftKey("client", "client", job.id),
    ),
  );
  unavailable = false;
  fireEvent.click(ui.getByRole("button", { name: "Sign out" }));
  await ui.findByRole("heading", { name: "Let’s get your project ready" });
  assert.equal(ui.queryByLabelText(/Scope of work/), null);
  assert.equal(
    window.localStorage.getItem(
      coordinationDraftKey("client", "client", job.id),
    ),
    null,
  );
});
test("unavailable device storage keeps the form usable and warns before the client leaves", async (t) => {
  t.after(cleanup);
  const original = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new Error("Device storage denied");
    },
  });
  t.after(() => Object.defineProperty(window, "localStorage", original));
  const job = fixture();
  const ui = render(
    <Portal
      client
      api={async (path) =>
        path === "client/notifications"
          ? { enabled: false, devices: [] }
          : { job: clientView(job), brand: "Provider" }
      }
    />,
  );
  await ui.findByRole("heading", { name: "Office" });
  fireEvent.change(ui.getByLabelText(/Scope of work/), {
    target: { value: "Keep my wording" },
  });
  await ui.findByText(/Device storage is unavailable/);
  assert.equal(ui.getByLabelText(/Scope of work/).value, "Keep my wording");
  assert.equal(
    ui.getByRole("button", { name: "Propose these changes" }).disabled,
    false,
  );
});
test("opening another project link never displays the existing client's different brief", async (t) => {
  t.after(cleanup);
  t.after(() => window.history.replaceState(null, "", "/client/?job=job-a"));
  window.history.replaceState(null, "", "/client/?job=job-b");
  const job = fixture();
  const ui = render(
    <Portal
      client
      api={async () => ({ job: clientView(job), brand: "Private provider" })}
    />,
  );
  await ui.findByRole("heading", { name: "Open your project" });
  assert.ok(ui.getByText(/session belongs to a different project/));
  assert.equal(ui.queryByRole("heading", { name: "Office" }), null);
  assert.equal(ui.queryByText("Private provider"), null);
  assert.equal(ui.queryByRole("button", { name: "Sign out" }), null);
  assert.equal(ui.queryByRole("button", { name: "Files" }), null);
});
test("an app update cannot discard a private link before verification is acknowledged", async (t) => {
  t.after(cleanup);
  t.after(() => window.history.replaceState(null, "", "/client/?job=job-a"));
  const token = "A".repeat(43),
    job = fixture(),
    calls = [];
  let updates = 0,
    releaseVerification;
  offerUpdate(() => updates++);
  window.history.replaceState(null, "", "/client/?job=job-a#verify=" + token);
  const ui = render(
    <Portal
      client
      api={async (path, body) => {
        calls.push({ path, body });
        if (path === "client/verify") {
          assert.equal(body.token, token);
          return await new Promise((resolve) => {
            releaseVerification = resolve;
          });
        }
        if (path === "client/job")
          return { job: clientView(job), brand: "Provider" };
        if (path === "client/notifications")
          return { enabled: false, devices: [] };
        throw new Error("Unexpected fixture request: " + path);
      }}
    />,
  );
  const verify = await ui.findByRole("button", {
    name: "Verify and open project",
  });
  assert.equal(window.location.hash, "");
  assert.equal(calls.length, 0);
  assert.equal(
    ui.getByRole("button", { name: "Update StreamLion" }).disabled,
    true,
  );
  fireEvent.click(ui.getByRole("button", { name: "Update StreamLion" }));
  assert.equal(updates, 0);
  fireEvent.click(verify);
  await waitFor(() => assert.equal(typeof releaseVerification, "function"));
  assert.equal(
    ui.getByRole("button", { name: "Update StreamLion" }).disabled,
    true,
  );
  releaseVerification({ verified: true });
  await ui.findByRole("heading", { name: "Office" });
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Update StreamLion" }).disabled,
      false,
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: "Update StreamLion" }));
  assert.equal(updates, 1);
});
test("verification acknowledgement unlocks updates even if initial project readback fails", async (t) => {
  t.after(cleanup);
  t.after(() => window.history.replaceState(null, "", "/client/?job=job-a"));
  window.history.replaceState(
    null,
    "",
    "/client/?job=job-a#verify=" + "B".repeat(43),
  );
  const job = fixture();
  let verifies = 0,
    readFails = true;
  offerUpdate(() => {});
  const ui = render(
    <Portal
      client
      api={async (path) => {
        if (path === "client/verify") {
          verifies++;
          return { verified: true };
        }
        if (path === "client/job") {
          if (readFails) throw accessError(500, "Temporary read failure");
          return { job: clientView(job), brand: "Provider" };
        }
        if (path === "client/notifications")
          return { enabled: false, devices: [] };
        throw new Error("Unexpected fixture request: " + path);
      }}
    />,
  );
  fireEvent.click(
    await ui.findByRole("button", { name: "Verify and open project" }),
  );
  const retry = await ui.findByRole("button", {
    name: "Check availability again",
  });
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Update StreamLion" }).disabled,
      false,
    ),
  );
  assert.equal(
    ui.queryByRole("button", { name: "Retry original request" }),
    null,
  );
  assert.equal(
    ui.queryByRole("button", { name: "Verify and open project" }),
    null,
  );
  readFails = false;
  fireEvent.click(retry);
  await ui.findByRole("heading", { name: "Office" });
  assert.equal(verifies, 1);
});
test("an expired verification link releases the update lock and offers a new link", async (t) => {
  t.after(cleanup);
  t.after(() => window.history.replaceState(null, "", "/client/?job=job-a"));
  window.history.replaceState(
    null,
    "",
    "/client/?job=job-a#verify=" + "C".repeat(43),
  );
  offerUpdate(() => {});
  const ui = render(
    <Portal
      client
      api={async () => {
        throw accessError(401, "Invalid private link");
      }}
    />,
  );
  fireEvent.click(
    await ui.findByRole("button", { name: "Verify and open project" }),
  );
  await ui.findByRole("heading", { name: "Open your project" });
  assert.ok(ui.getByText(/expired or already used/));
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Update StreamLion" }).disabled,
      false,
    ),
  );
  assert.equal(
    ui.queryByRole("button", { name: "Retry original request" }),
    null,
  );
  assert.ok(ui.getByRole("button", { name: "Email me a private link" }));
});
test("an unacknowledged transient verification keeps its token until authorized session recovery", async (t) => {
  t.after(cleanup);
  t.after(() => window.history.replaceState(null, "", "/client/?job=job-a"));
  window.history.replaceState(
    null,
    "",
    "/client/?job=job-a#verify=" + "D".repeat(43),
  );
  const job = fixture();
  let verifies = 0;
  offerUpdate(() => {});
  const ui = render(
    <Portal
      client
      api={async (path) => {
        if (path === "client/verify") {
          verifies++;
          throw new Error("Acknowledgement lost");
        }
        if (path === "client/job")
          return { job: clientView(job), brand: "Provider" };
        if (path === "client/notifications")
          return { enabled: false, devices: [] };
        throw new Error("Unexpected fixture request: " + path);
      }}
    />,
  );
  fireEvent.click(
    await ui.findByRole("button", { name: "Verify and open project" }),
  );
  await ui.findByText("Acknowledgement lost");
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Retry original request" }).disabled,
      false,
    ),
  );
  assert.equal(
    ui.getByRole("button", { name: "Update StreamLion" }).disabled,
    true,
  );
  fireEvent.click(ui.getByRole("button", { name: "Review current status" }));
  await ui.findByRole("heading", { name: "Office" });
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Update StreamLion" }).disabled,
      false,
    ),
  );
  assert.equal(verifies, 1);
  assert.equal(
    ui.queryByRole("button", { name: "Retry original request" }),
    null,
  );
});
