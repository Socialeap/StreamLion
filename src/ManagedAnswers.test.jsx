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
  IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: Answers } = await import("./ProjectVoiceAnswers.jsx");
const project = {
  id: "project",
  title: "Synthetic venue",
  address: "123 Example Street",
};

test("AI opt-in shows exact price; request sends only identity/question, displays streamed answer and updated credits", async () => {
  const original = globalThis.fetch,
    requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return url.endsWith("config")
      ? Response.json({
          enabled: true,
          priceMicros: 12500,
          balanceMicros: 100000,
        })
      : new Response(
          [
            { type: "start", source: "Google workbook · read now" },
            {
              type: "text",
              delta:
                "The location name is Synthetic venue. Source: Project name.",
            },
            { type: "done", balanceMicros: 87500 },
          ]
            .map((e) => JSON.stringify(e))
            .join("\n") + "\n",
        );
  };
  let ui;
  try {
    await act(async () => {
      ui = render(<Answers project={project} source="google" />);
    });
    assert.match(ui.getByText(/per completed answer/).textContent, /\$0.0125/);
    fireEvent.click(
      ui.getByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" }),
    );
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "What is the name of the location?" },
    });
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    });
    assert.ok(
      ui.getByText(
        "The location name is Synthetic venue. Source: Project name.",
      ),
    );
    assert.match(ui.getByText(/per completed answer/).textContent, /\$0.0875/);
    const payload = JSON.parse(
      requests.find((r) => r.url.endsWith("answer")).options.body,
    );
    assert.equal(payload.projectId, "project");
    assert.equal(payload.priceMicros, 12500);
    assert.equal(payload.speech, false);
    assert.equal(payload.project, undefined);
    assert.equal(payload.workbookId, undefined);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

test("Stop aborts a pending answer and stale responses cannot replace a changed project", async () => {
  const original = globalThis.fetch;
  let signal, resolve;
  globalThis.fetch = async (url, options) =>
    url.endsWith("config")
      ? Response.json({
          enabled: true,
          priceMicros: 12500,
          balanceMicros: 100000,
        })
      : new Promise((done) => {
          signal = options.signal;
          resolve = done;
        });
  let ui;
  try {
    await act(async () => {
      ui = render(<Answers project={project} source="google" />);
    });
    fireEvent.click(
      ui.getByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" }),
    );
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Who is the contact?" },
    });
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    });
    assert.ok(ui.getByRole("button", { name: "Getting AI answer…" }).disabled);
    fireEvent.click(ui.getByRole("button", { name: "Stop AI answer" }));
    assert.equal(signal.aborted, true);
    await act(async () => {
      ui.rerender(
        <Answers
          project={{ id: "other", title: "Different venue" }}
          source="google"
        />,
      );
      resolve(
        new Response(
          '{"type":"text","delta":"Stale answer"}\n{"type":"done"}\n',
        ),
      );
    });
    assert.equal(ui.queryByText("Stale answer"), null);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});
