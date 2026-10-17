import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
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
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const { render, fireEvent, cleanup, waitFor } =
  await import("@testing-library/react");
const { default: BriefImporter } = await import("./BriefImporter.jsx");
const { intakeFor } = await import("./project-schema.js");
const { fillEmptyBriefFields, readPendingBrief, briefRequest } =
  await import("./brief-import.js");
const fields = intakeFor({
  title: "Existing draft",
  notes: "Keep this note",
}).fields;
const config = {
  enabled: true,
  canPrepare: true,
  priceMicros: 150000,
  balanceMicros: 1000000,
  scope: "scope",
  quoteKey: "quote",
};
const completed = {
  state: "complete",
  project: intakeFor({
    title: "AI title",
    address: "10 Example Street",
    unresolved: "Check visit date",
  }),
};

test("replacement QA shows one attempt and preserves the original expiry", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  const ui = render(
    <BriefImporter
      draftKey="replacement-draft"
      fields={fields}
      onUse={() => {}}
      request={async () => ({
        ...config,
        priceMicros: 100000,
        ownerQA: {
          attemptsRemaining: 1,
          attemptLimit: 1,
          replacement: true,
          expiresAt: "2026-10-18T00:46:02.266Z",
        },
      })}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() => assert(ui.getByText(/Owner-only replacement QA/)));
  assert.match(
    ui.getByText(/Owner-only replacement QA/).textContent,
    /1 of 1 attempts remaining/,
  );
  assert(ui.getByRole("button", { name: "Prepare my project · 8 credits" }));
});

test("a classified failed replacement preserves source and draft and never suggests another paid attempt", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  localStorage.setItem("preserved-draft", "original draft contents");
  const reference = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let posts = 0,
    imports = 0;
  const ui = render(
    <BriefImporter
      draftKey="failed-replacement"
      fields={fields}
      onUse={() => imports++}
      request={async (route) => {
        if (route === "prepare") {
          posts++;
          return {
            state: "failed",
            errorCode: "invalid_project",
            reference,
            error: `The prepared details did not pass the project checks. Reserved credits were returned; your draft is unchanged. Reference: ${reference}. Recover this attempt before starting anything else.`,
          };
        }
        return posts
          ? { enabled: false, reason: "qa_replacement_exhausted" }
          : {
              ...config,
              priceMicros: 100000,
              ownerQA: {
                attemptsRemaining: 1,
                attemptLimit: 1,
                replacement: true,
                expiresAt: "2026-10-18T00:46:02.266Z",
              },
            };
      }}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() =>
    assert(ui.getByRole("button", { name: "Prepare my project · 8 credits" })),
  );
  fireEvent.change(ui.getByLabelText(/Or, paste the PDF text/), {
    target: {
      value:
        "Keep these NYC venue details and the exact 6 7/16 inch measurement.",
    },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Prepare my project · 8 credits" }),
  );
  await waitFor(() => assert(ui.getByText(new RegExp(reference))));
  assert(ui.getByText(/replacement QA attempt has been used/));
  assert.equal(
    ui.getByLabelText(/Or, paste the PDF text/).value,
    "Keep these NYC venue details and the exact 6 7/16 inch measurement.",
  );
  assert(ui.getByRole("button", { name: "Prepare my project" }).disabled);
  assert.equal(readPendingBrief("failed-replacement"), null);
  assert.equal(
    localStorage.getItem("preserved-draft"),
    "original draft contents",
  );
  fireEvent.click(ui.getByRole("button", { name: "Check brief availability" }));
  await waitFor(() =>
    assert(
      !ui.getByRole("button", { name: "Check brief availability" }).disabled,
    ),
  );
  assert.equal(posts, 1);
  assert.equal(imports, 0);
});

test("pending preparation refreshes the reserved balance and remaining attempts without another POST", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let posts = 0;
  const request = async (route) => {
    if (route === "config")
      return {
        ...config,
        priceMicros: 100000,
        balanceMicros: 19000000 - posts * 100000,
        ownerQA: {
          attemptsRemaining: 3 - posts,
          expiresAt: "2026-10-17T20:00:00.000Z",
        },
      };
    assert.equal(route, "prepare");
    posts++;
    return { state: "pending" };
  };
  const ui = render(
    <BriefImporter
      draftKey="pending-draft"
      fields={fields}
      onUse={() => {}}
      request={request}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() =>
    assert.match(ui.getByText(/Owner-only QA/).textContent, /3 of 3/),
  );
  fireEvent.change(ui.getByLabelText(/Or, paste the PDF text/), {
    target: { value: "Synthetic venue brief" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Prepare my project · 8 credits" }),
  );
  await waitFor(() =>
    assert.match(ui.getByText(/Owner-only QA/).textContent, /2 of 3/),
  );
  assert.match(
    ui.getByText(/per completed preparation/).textContent,
    /1512 credits available/,
  );
  assert(ui.getByRole("button", { name: "Recover prepared brief" }));
  assert.equal(
    ui.getByLabelText(/Or, paste the PDF text/).value,
    "Synthetic venue brief",
  );
  assert(readPendingBrief("pending-draft"));
  assert.equal(posts, 1);
});

test("owner QA displays its remaining attempts and expiry without suggesting a credit purchase", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  const request = async () => ({
    ...config,
    priceMicros: 100000,
    canPrepare: false,
    ownerQA: { attemptsRemaining: 2, expiresAt: "2026-10-17T20:00:00.000Z" },
  });
  const ui = render(
    <BriefImporter
      draftKey="qa-draft"
      fields={fields}
      onUse={() => {}}
      request={request}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() => assert(ui.getByText(/Owner-only QA/)));
  assert.match(
    ui.getByText(/Owner-only QA/).textContent,
    /2 of 3 attempts remaining/,
  );
  assert(ui.getByText(/do not buy or transfer credits/));
  assert.equal(ui.queryByText("View credits"), null);
  assert(
    ui.getByRole("button", { name: "Prepare my project · 8 credits" }).disabled,
  );
});

test("exhausted QA preserves pasted source and explains recovery instead of top-ups", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  const ui = render(
    <BriefImporter
      draftKey="qa-draft"
      fields={fields}
      onUse={() => {}}
      request={async () => ({ enabled: false, reason: "qa_exhausted" })}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  fireEvent.change(ui.getByLabelText(/Or, paste the PDF text/), {
    target: { value: "Synthetic venue brief" },
  });
  await waitFor(() => assert(ui.getByText(/All three owner QA attempts/)));
  assert.equal(
    ui.getByLabelText(/Or, paste the PDF text/).value,
    "Synthetic venue brief",
  );
  assert(
    ui.getByRole("button", { name: "Prepare my project", exact: true })
      .disabled,
  );
});

test("disabled importer exposes PDF tips and preserves source text without preparing or changing drafts", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let preparations = 0,
    uses = 0;
  const request = async (route) => {
    if (route !== "config") preparations++;
    return { enabled: false, reason: "not_open" };
  };
  const ui = render(
    <BriefImporter
      draftKey="draft"
      fields={fields}
      onUse={() => uses++}
      request={request}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() =>
    assert(ui.getByRole("status").textContent.includes("not open")),
  );
  assert(
    ui
      .getByText("Easy ways to turn emails or messages into a PDF")
      .closest("details"),
  );
  fireEvent.change(ui.getByLabelText(/Or, paste the PDF text/), {
    target: { value: "My email thread" },
  });
  assert(ui.getByRole("button", { name: "Prepare my project" }).disabled);
  fireEvent.click(ui.getByRole("button", { name: "Hide brief preparation" }));
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() =>
    assert.equal(
      ui.getByLabelText(/Or, paste the PDF text/).value,
      "My email thread",
    ),
  );
  assert.equal(preparations, 0);
  assert.equal(uses, 0);
});

test("PDF text and quoted price lead to review; explicit use fills only empty fields", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let imported,
    prepared,
    reads = 0;
  const request = async (route, body) => {
    if (route === "config") return config;
    if (route === "prepare") {
      prepared = body;
      return completed;
    }
    reads++;
    return completed;
  };
  const ui = render(
    <BriefImporter
      draftKey="draft"
      fields={fields}
      onUse={(value) => (imported = fillEmptyBriefFields(fields, value))}
      request={request}
      readFile={async () => ({
        text: "Capture 10 Example Street.",
        sourceName: "capture.pdf",
      })}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() => assert(ui.getByText(/12 credits \(\$0.15\)/)));
  fireEvent.change(ui.getByLabelText("Choose brief PDF"), {
    target: { files: [{ name: "capture.pdf" }] },
  });
  await waitFor(() =>
    assert.equal(
      ui.getByLabelText(/Or, paste the PDF text/).value,
      "Capture 10 Example Street.",
    ),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Prepare my project · 12 credits" }),
  );
  await waitFor(() =>
    assert(ui.getByRole("region", { name: "Review prepared brief" })),
  );
  assert.equal(imported, undefined);
  assert.equal(prepared.sourceName, "capture.pdf");
  assert.equal(prepared.priceMicros, 150000);
  assert.equal(readPendingBrief("draft").requestId, prepared.requestId);
  assert(ui.getByText(/Keeping your existing detail: Existing draft/));
  fireEvent.click(
    ui.getByRole("button", { name: "Fill empty fields with these details" }),
  );
  await waitFor(() => assert.equal(imported?.address, "10 Example Street"));
  assert.equal(imported.title, "Existing draft");
  assert.equal(imported.notes, "Keep this note");
  assert.equal(reads, 1);
  assert.equal(readPendingBrief("draft"), null);
});

test("interrupted preparation survives remount and recovers without another paid POST", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let posts = 0;
  const request = async (route) => {
    if (route === "config") return config;
    if (route === "prepare") {
      posts++;
      throw new Error("Connection lost");
    }
    return completed;
  };
  let ui = render(
    <BriefImporter
      draftKey="draft"
      fields={fields}
      onUse={() => {}}
      request={request}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() => assert(ui.getByText(/12 credits \(\$0.15\)/)));
  fireEvent.change(ui.getByLabelText(/Or, paste the PDF text/), {
    target: { value: "Capture the lobby" },
  });
  fireEvent.click(
    ui.getByRole("button", { name: "Prepare my project · 12 credits" }),
  );
  await waitFor(() =>
    assert(
      ui.getByRole("alert").textContent.includes("Recover prepared brief"),
    ),
  );
  const marker = readPendingBrief("draft");
  assert(marker);
  assert.equal(Object.keys(marker).length, 2);
  ui.unmount();
  ui = render(
    <BriefImporter
      draftKey="draft"
      fields={fields}
      onUse={() => {}}
      request={request}
    />,
  );
  fireEvent.click(ui.getByRole("button", { name: "Recover prepared brief" }));
  await waitFor(() =>
    assert(ui.getByRole("region", { name: "Review prepared brief" })),
  );
  assert.equal(posts, 1);
  assert.equal(readPendingBrief("draft").requestId, marker.requestId);
});

test("unreadable PDF and failed preparation keep existing fields and return to a usable input", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let uses = 0;
  const ui = render(
    <BriefImporter
      draftKey="draft"
      fields={fields}
      onUse={() => uses++}
      readFile={async () => {
        throw new Error("Page 1 has no readable text");
      }}
      request={async (route) =>
        route === "config"
          ? config
          : { state: "failed", error: "Reserved credits were returned." }
      }
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() => assert(ui.getByText(/12 credits \(\$0.15\)/)));
  const input = ui.getByLabelText(/Or, paste the PDF text/);
  fireEvent.change(input, { target: { value: "Keep this pasted source" } });
  fireEvent.change(ui.getByLabelText("Choose brief PDF"), {
    target: { files: [{ name: "scan.pdf" }] },
  });
  await waitFor(() =>
    assert(ui.getByRole("alert").textContent.includes("no readable text")),
  );
  assert.equal(input.value, "Keep this pasted source");
  fireEvent.click(
    ui.getByRole("button", { name: "Prepare my project · 12 credits" }),
  );
  await waitFor(() => assert(ui.getByText("Reserved credits were returned.")));
  assert.equal(readPendingBrief("draft"), null);
  assert.equal(input.disabled, false);
  assert.equal(uses, 0);
  assert.equal(fields.title, "Existing draft");
});

test("brief POST timeout is bounded and never automatically retried", async () => {
  let calls = 0;
  await assert.rejects(
    briefRequest("prepare", { text: "brief" }, async (_url, options) => {
      calls++;
      assert(options.signal instanceof AbortSignal);
      assert.equal(options.method, "POST");
      throw new DOMException("Timeout", "TimeoutError");
    }),
    /Timeout/,
  );
  assert.equal(calls, 1);
});

test("blocked device storage prevents a paid request; failed draft import keeps its recoverable result", async (t) => {
  t.after(cleanup);
  localStorage.clear();
  let posts = 0;
  const request = async (route) => {
    if (route === "config") return config;
    if (route === "prepare") posts++;
    return completed;
  };
  const ui = render(
    <BriefImporter
      draftKey="storage"
      fields={fields}
      request={request}
      onUse={() => {
        throw new Error("Draft storage is full");
      }}
    />,
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Upload a brief or paste text" }),
  );
  await waitFor(() => assert(ui.getByText(/12 credits \(\$0.15\)/)));
  fireEvent.change(ui.getByLabelText(/Or, paste the PDF text/), {
    target: { value: "Capture the lobby" },
  });
  const original = dom.window.Storage.prototype.setItem;
  dom.window.Storage.prototype.setItem = () => {
    throw new Error("Storage full");
  };
  t.after(() => (dom.window.Storage.prototype.setItem = original));
  fireEvent.click(
    ui.getByRole("button", { name: "Prepare my project · 12 credits" }),
  );
  await waitFor(() =>
    assert(ui.getByRole("alert").textContent.includes("No request was sent")),
  );
  assert.equal(posts, 0);
  dom.window.Storage.prototype.setItem = original;
  fireEvent.click(
    ui.getByRole("button", { name: "Prepare my project · 12 credits" }),
  );
  await waitFor(() =>
    assert(ui.getByRole("region", { name: "Review prepared brief" })),
  );
  fireEvent.click(
    ui.getByRole("button", { name: "Fill empty fields with these details" }),
  );
  await waitFor(() =>
    assert(ui.getByRole("alert").textContent.includes("Draft storage is full")),
  );
  assert(readPendingBrief("storage"));
  assert.equal(posts, 1);
});
