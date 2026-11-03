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

const { render, fireEvent, act, cleanup, within, waitFor } =
  await import("@testing-library/react");
const { default: ProjectEditor } = await import("./ProjectEditor.jsx");
const { FIELD_HELP } = await import("./FieldHelp.jsx");
const { PROJECT_FIELDS, intakeFor } = await import("./project-schema.js");
const { readDraft, writeDraft, projectDraftKey } = await import("./drafts.js");
const { default: Jobs } = await import("./Jobs.jsx");
const { keepPendingBrief, readPendingBrief } =
  await import("./brief-import.js");

test("a recoverable brief prevents draft identity changes on both save paths until recovery clears", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let saves = 0;
  const key = projectDraftKey("pending-save", "new");
  const marker = {
    requestId: "11111111-1111-4111-8111-111111111111",
    scope: "original-scope",
  };
  const ui = render(
    <ProjectEditor
      draftScope="pending-save"
      onSave={async () => saves++}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Step 2: Identify the project" }),
  );
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Keep this draft" },
  });
  keepPendingBrief(key, marker); // Written by preparation even if its editor section subsequently unmounts.
  fireEvent.click(ui.getByRole("button", { name: "Save draft on device" }));
  await waitFor(() =>
    assert(
      ui
        .getByRole("alert")
        .textContent.includes("Recover this brief before saving"),
    ),
  );
  assert.equal(saves, 0);
  assert.deepEqual(readPendingBrief(key), marker);
  assert.equal(readDraft(key).fields.title, "Keep this draft");
  fireEvent.click(ui.getByRole("button", { name: "Step 9: Review and save" }));
  const review = ui.getByRole("checkbox");
  fireEvent.click(review);
  const finish = ui.getByRole("button", { name: /Save reviewed/ });
  fireEvent.click(finish);
  await waitFor(() =>
    assert(
      ui
        .getByRole("alert")
        .textContent.includes("Recover this brief before saving"),
    ),
  );
  assert.equal(saves, 0);
  assert.deepEqual(readPendingBrief(key), marker);
  localStorage.removeItem(key + ":brief-import-v1"); // Equivalent to recovered failure/import/discard.
  fireEvent.click(ui.getByRole("button", { name: "Save draft on device" }));
  await waitFor(() => assert.equal(saves, 1));
});

test("starting a preparation is disabled while saving a new draft", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const ui = render(
    <ProjectEditor
      draftScope="saving-brief"
      onSave={() => held}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Step 2: Identify the project" }),
  );
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Saving draft" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Step 1: Start with your project brief" }),
  );
  fireEvent.click(ui.getByRole("button", { name: "Save draft on device" }));
  try {
    assert(
      ui.getByRole("button", { name: "Upload a brief or paste text" }).disabled,
    );
  } finally {
    await act(async () => release());
  }
});

test("mocked in-app brief requires explicit review, preserves existing draft fields and never saves Google automatically", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  const proposed = intakeFor({
    title: "Prepared title",
    address: "10 Example Street",
    unresolved: "Confirm visit date",
  });
  let saves = 0,
    prepares = 0;
  globalThis.fetch = async (url, options) => {
    assert(String(url).startsWith("/api/brief-import/"));
    if (String(url).endsWith("config"))
      return new Response(
        JSON.stringify({
          enabled: true,
          canPrepare: true,
          priceMicros: 150000,
          balanceMicros: 1000000,
          scope: "scope",
          quoteKey: "quote",
        }),
      );
    if (options?.method === "POST") prepares++;
    return new Response(
      JSON.stringify({ state: "complete", project: proposed }),
    );
  };
  const ui = render(
    <ProjectEditor
      draftScope="native-review"
      onSave={async () => saves++}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Step 2: Identify the project" }),
  );
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "My existing title" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Step 1: Start with your project brief" }),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() => assert(ui.getByText(/12 credits \(\$0.15\)/)));
  fireEvent.change(ui.getByLabelText(/Or, paste the PDF text/), {
    target: { value: "Capture 10 Example Street" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Preview what OpenAI will receive" }),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Prepare my project · 12 credits" }),
  );
  await waitFor(() =>
    assert(ui.getByRole("region", { name: "Review prepared brief" })),
  );
  const key = projectDraftKey("native-review", "new");
  assert.equal(readDraft(key).fields.address, "");
  fireEvent.click(
    ui.getByRole("button", { name: "Fill empty fields with these details" }),
  );
  await waitFor(() =>
    assert.equal(ui.getByLabelText("Project name").value, "My existing title"),
  );
  assert.equal(readDraft(key).fields.address, "10 Example Street");
  assert.equal(readDraft(key).fields.unresolved, "Confirm visit date");
  assert.equal(saves, 0);
  assert.equal(prepares, 1);
  fireEvent.click(ui.getByRole("button", { name: "Save draft on device" }));
  await waitFor(() => assert.equal(saves, 1));
});

test("saved project import keeps file first and a paste alternative", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let saves = 0;
  const ui = render(
    <ProjectEditor
      draftScope="brief-paste"
      onSave={async () => {
        saves++;
      }}
      onCancel={() => {}}
    />,
  );
  const card = within(
    ui.getByRole("region", { name: "Import a project file" }),
  );
  const bringBack = card.getByRole("button", {
    name: "Import saved project details",
  });
  assert.equal(bringBack.getAttribute("aria-expanded"), "false");
  fireEvent.click(bringBack);
  const file = card.getByLabelText("Choose project file (.json)"),
    paste = card.getByLabelText("Or, paste the project details here:");
  assert.equal(document.activeElement, file);
  assert(
    file.compareDocumentPosition(paste) &
      window.Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const text = JSON.stringify(
    intakeFor({ title: "Pasted project", scope: "Lobby and stairs" }),
  );
  fireEvent.change(paste, { target: { value: text } });
  fireEvent.click(bringBack);
  fireEvent.click(bringBack);
  assert.equal(
    card.getByLabelText("Or, paste the project details here:").value,
    text,
  );
  fireEvent.click(card.getByRole("button", { name: "Use these details" }));
  assert.equal(ui.getByLabelText("Project name").value, "Pasted project");
  assert.equal(
    readDraft(projectDraftKey("brief-paste", "new")).fields.scope,
    "Lobby and stairs",
  );
  assert.equal(saves, 0);
});

test("a saved project file fills review steps without saving the project", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let saves = 0;
  const ui = render(
    <ProjectEditor
      draftScope="brief-file"
      onSave={async () => {
        saves++;
      }}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Import saved project details" }),
  );
  const file = {
    size: 200,
    text: async () =>
      JSON.stringify(
        intakeFor({ title: "Uploaded project", address: "100 Example Street" }),
      ),
  };
  fireEvent.change(ui.getByLabelText("Choose project file (.json)"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    assert.equal(ui.getByLabelText("Project name").value, "Uploaded project"),
  );
  assert.equal(
    readDraft(projectDraftKey("brief-file", "new")).fields.address,
    "100 Example Street",
  );
  assert.equal(saves, 0);
});

test("invalid, oversized and unreadable imports preserve the existing draft and paste input", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  const ui = render(
    <ProjectEditor
      draftScope="brief-errors"
      onSave={async () => {
        throw Error("Import must not save");
      }}
      onCancel={() => {}}
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Keep my draft" },
  });
  const before = readDraft(projectDraftKey("brief-errors", "new"));
  fireEvent.click(
    ui.getByRole("button", { name: "Step 1: Start with your project brief" }),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Import saved project details" }),
  );
  fireEvent.change(ui.getByLabelText("Or, paste the project details here:"), {
    target: { value: "Keep this paste draft" },
  });
  for (const [file, message] of [
    [
      {
        size: 150001,
        text: async () => {
          throw Error("Must not read oversized file");
        },
      },
      /too large/,
    ],
    [
      {
        size: 20,
        text: async () => {
          throw Error("Unreadable");
        },
      },
      /Could not read/,
    ],
    [
      { size: 20, text: async () => "not project JSON" },
      /complete project JSON/,
    ],
  ]) {
    const input = ui.getByLabelText("Choose project file (.json)");
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      assert.match(ui.getByRole("alert").textContent, message),
    );
    assert.equal(input.value, "");
    assert.deepEqual(readDraft(projectDraftKey("brief-errors", "new")), before);
    assert.equal(
      ui.getByLabelText("Or, paste the project details here:").value,
      "Keep this paste draft",
    );
  }
});

test("project wizard preserves manual entry and reveals one field group at a time", () => {
  localStorage.clear();
  const ui = render(
    <ProjectEditor
      onSave={async () => {}}
      onCancel={() => {}}
      bookId="workbook123"
      draftScope="wizard-test"
    />,
  );
  assert.equal(ui.queryByRole("link", { name: /ChatGPT/ }), null);
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

test("Finish project download uses an attached link, reports its filename and offers valid copyable JSON", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let captured;
  t.mock.method(URL, "createObjectURL", () => "blob:project-test");
  t.mock.method(URL, "revokeObjectURL", () => {});
  t.mock.method(dom.window.HTMLAnchorElement.prototype, "click", function () {
    assert.equal(this.isConnected, true);
    captured = this.download;
  });
  const ui = render(
    <ProjectEditor
      onSave={async () => {}}
      onCancel={() => {}}
      draftScope="download-finish"
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Synthetic mobile QA" },
  });
  for (let i = 0; i < 7; i++)
    fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  fireEvent.click(ui.getByRole("button", { name: "Download project details" }));
  assert.equal(captured, "streamlion-project.json");
  assert.match(
    within(ui.container.querySelector(".finish-review")).getByRole("status")
      .textContent,
    /download requested/,
  );
  assert.equal(
    ui
      .getByRole("link", { name: "save the project details file directly" })
      .getAttribute("href"),
    "blob:project-test",
  );
  assert.equal(
    JSON.parse(ui.getByLabelText("Project details JSON").value).fields.title,
    "Synthetic mobile QA",
  );
  fireEvent.change(ui.getByLabelText("Sources: document, page, passage"), {
    target: { value: "New source after export" },
  });
  assert.equal(
    ui.queryByRole("link", { name: "save the project details file directly" }),
    null,
  );
});

test("a browser download failure leaves copyable project JSON and an adjacent error", (t) => {
  t.after(cleanup);
  localStorage.clear();
  t.mock.method(URL, "createObjectURL", () => {
    throw Error("Downloads unavailable");
  });
  const ui = render(
    <ProjectEditor
      onSave={async () => {}}
      onCancel={() => {}}
      draftScope="blocked-download"
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Keep my mobile details" },
  });
  for (let i = 0; i < 7; i++)
    fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  fireEvent.click(ui.getByRole("button", { name: "Download project details" }));
  const alert = ui.getByRole("alert");
  assert.match(alert.textContent, /Downloads unavailable/);
  assert(alert.closest(".finish-review"));
  assert.equal(ui.queryByText(/download started/), null);
  assert.equal(
    JSON.parse(ui.getByLabelText("Project details JSON").value).fields.title,
    "Keep my mobile details",
  );
});

test("invalid project fields explain the blocked export beside the Finish button without losing edits", (t) => {
  t.after(cleanup);
  localStorage.clear();
  const ui = render(
    <ProjectEditor
      onSave={async () => {}}
      onCancel={() => {}}
      draftScope="invalid-download"
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Enter details myself" }));
  fireEvent.change(ui.getByLabelText("Project name"), {
    target: { value: "Keep invalid draft" },
  });
  for (let i = 0; i < 5; i++)
    fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  fireEvent.change(ui.getByLabelText("Offered fee"), {
    target: { value: "$200" },
  });
  for (let i = 0; i < 2; i++)
    fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  fireEvent.click(ui.getByRole("button", { name: "Download project details" }));
  assert.match(
    ui.getByRole("alert").textContent,
    /without units or currency symbols/,
  );
  assert(ui.getByRole("alert").closest(".finish-review"));
  assert.equal(ui.queryByText(/download started/), null);
  fireEvent.click(ui.getByRole("button", { name: /Step 7:/ }));
  assert.equal(ui.getByLabelText("Offered fee").value, "$200");
});

test("a saved invalid currency remains visible until corrected using the currency dropdown", (t) => {
  t.after(cleanup);
  localStorage.clear();
  t.mock.method(URL, "createObjectURL", () => "blob:currency-test");
  t.mock.method(URL, "revokeObjectURL", () => {});
  t.mock.method(dom.window.HTMLAnchorElement.prototype, "click", () => {});
  writeDraft(projectDraftKey("currency-export"), {
    fields: {
      ...Object.fromEntries(PROJECT_FIELDS.map((f) => [f.key, ""])),
      title: "Currency QA",
      currency: "US",
    },
  });
  const ui = render(
    <ProjectEditor
      onSave={async () => {}}
      onCancel={() => {}}
      draftScope="currency-export"
    />,
  );
  for (let i = 0; i < 7; i++)
    fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  fireEvent.click(ui.getByRole("button", { name: "Download project details" }));
  assert.match(
    ui.getByRole("alert").textContent,
    /Use a three-letter uppercase currency code/,
  );
  assert(ui.getByRole("alert").closest(".finish-review"));
  fireEvent.click(
    ui.getByRole("button", { name: "Review currency in Payment" }),
  );
  const currency = ui.getByRole("combobox", { name: "Currency (ISO code)" });
  assert.equal(currency.value, "US");
  assert.equal(
    within(currency).getByRole("option", { name: /US.*saved value/ }).disabled,
    true,
  );
  assert(
    [...currency.options]
      .filter((o) => !o.disabled && o.value)
      .every((o) => /^[A-Z]{3}$/.test(o.value)),
  );
  fireEvent.change(ui.getByLabelText("Currency (ISO code)"), {
    target: { value: "USD" },
  });
  assert.equal(ui.getByLabelText("Currency (ISO code)").value, "USD");
  for (let i = 0; i < 2; i++)
    fireEvent.click(ui.getByRole("button", { name: /Continue/ }));
  fireEvent.click(ui.getByRole("button", { name: "Download project details" }));
  assert.equal(ui.queryByRole("alert"), null);
  assert.equal(
    JSON.parse(ui.getByLabelText("Project details JSON").value).fields.currency,
    "USD",
  );
});

for (const timeZone of ["", "New York city"]) {
  test(`export explains and corrects a ${timeZone ? "invalid" : "missing"} visit time zone without changing the scheduled time`, (t) => {
    t.after(cleanup);
    localStorage.clear();
    t.mock.method(URL, "createObjectURL", () => "blob:timezone-test");
    t.mock.method(URL, "revokeObjectURL", () => {});
    t.mock.method(dom.window.HTMLAnchorElement.prototype, "click", () => {});
    writeDraft(projectDraftKey("timezone-export"), {
      fields: {
        ...Object.fromEntries(PROJECT_FIELDS.map((f) => [f.key, ""])),
        title: "Visit timezone QA",
        startLocal: "2026-11-04T10:00",
        timeZone,
      },
    });
    const ui = render(
      <ProjectEditor
        draftScope="timezone-export"
        onSave={async () => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(
      ui.getByRole("button", { name: "Step 9: Review and save" }),
    );
    fireEvent.click(
      ui.getByRole("button", { name: "Download project details" }),
    );
    assert.match(ui.getByRole("alert").textContent, /time zone/i);
    assert(ui.getByRole("alert").closest(".finish-review"));
    assert(ui.getByText(/In step 5, Visit, set the time zone/));
    fireEvent.click(
      ui.getByRole("button", { name: "Review time zone in Visit" }),
    );
    assert.equal(
      ui.getByLabelText("Start date and time").value,
      "2026-11-04T10:00",
    );
    assert.equal(
      ui.getByLabelText("Time zone (e.g. America/New_York)").value,
      timeZone,
    );
    assert(ui.getByText(/Required when a start or end time is entered/));
    fireEvent.change(ui.getByLabelText("Time zone (e.g. America/New_York)"), {
      target: { value: "America/New_York" },
    });
    fireEvent.click(
      ui.getByRole("button", { name: "Step 9: Review and save" }),
    );
    fireEvent.click(
      ui.getByRole("button", { name: "Download project details" }),
    );
    assert.equal(ui.queryByRole("alert"), null);
    const exported = JSON.parse(
      ui.getByLabelText("Project details JSON").value,
    );
    assert.equal(exported.fields.timeZone, "America/New_York");
    assert.equal(exported.fields.startLocal, "2026-11-04T10:00");
  });
}
