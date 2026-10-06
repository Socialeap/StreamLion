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
const { render, renderHook, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: Answers } = await import("./ProjectVoiceAnswers.jsx");
const { default: useManagedAnswers } = await import("./useManagedAnswers.js");
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

test("text completion is visible before stalled audio and Stop clears batched/stale text", async () => {
  const original = globalThis.fetch;
  let streamController, request;
  globalThis.fetch = async (url, options) =>
    url.endsWith("config")
      ? Response.json({
          enabled: true,
          priceMicros: 12500,
          balanceMicros: 100000,
        })
      : ((request = JSON.parse(options.body)),
        new Response(
          new ReadableStream({
            start(c) {
              streamController = c;
            },
          }),
        ));
  const results = [],
    messages = [];
  let hook, asking;
  const send = (event) =>
    streamController.enqueue(
      new TextEncoder().encode(JSON.stringify(event) + "\n"),
    );
  try {
    await act(async () => {
      hook = renderHook(() =>
        useManagedAnswers({
          project,
          source: "google",
          onResult: (r) => results.push(r),
          onMessage: (m) => messages.push(m),
        }),
      );
    });
    await act(async () => {
      asking = hook.result.current.ask("Clearance?", true);
    });
    assert.equal(request.audioFormat, "pcm_s16le");
    assert.equal(request.speech, false); // No AudioContext: don't bill unnecessary Kokoro generation.
    await act(async () => {
      send({ type: "start", source: "Google workbook" });
      for (const delta of ["6 ", "7/", "16 ", "inches."])
        send({ type: "text", delta });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.equal(results.length, 0); // Token deltas don't each cause a React update.
    await act(async () => {
      send({ type: "text_done", balanceMicros: 87500 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].kind, "answer");
    assert.equal(results[0].answers[0].text, "6 7/16 inches.");
    assert.equal(hook.result.current.config.balanceMicros, 87500);
    assert.equal(hook.result.current.busy, true); // Speech/delivery still pending.
    assert.match(messages.at(-1), /Read answer aloud/);
    await act(async () => {
      hook.result.current.cancel();
      send({ type: "text", delta: "Stale text" });
      send({ type: "done" });
      streamController.close();
      await asking;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 70));
    });
    assert.equal(results.length, 1);
    assert.equal(hook.result.current.busy, false);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

for (const completion of ["text_done", "legacy-done"])
  test(`${completion} publishes one completed result without republishing at voice completion`, async () => {
    const original = globalThis.fetch,
      results = [];
    globalThis.fetch = async (url) =>
      url.endsWith("config")
        ? Response.json({
            enabled: true,
            priceMicros: 12500,
            balanceMicros: 100000,
          })
        : new Response(
            [
              { type: "start", source: "Google workbook" },
              { type: "text", delta: "6 7/16 inches, unreviewed." },
              ...(completion === "text_done"
                ? [{ type: "text_done", balanceMicros: 87500 }]
                : []),
              { type: "done", balanceMicros: 87500 },
            ]
              .map((event) => JSON.stringify(event))
              .join("\n") + "\n",
          );
    try {
      let hook;
      await act(async () => {
        hook = renderHook(() =>
          useManagedAnswers({
            project,
            source: "google",
            onResult: (r) => results.push(r),
            onMessage() {},
          }),
        );
      });
      await act(async () => {
        await hook.result.current.ask("Clearance?", false);
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].kind, "answer");
      assert.equal(results[0].answers[0].text, "6 7/16 inches, unreviewed.");
      assert.equal(hook.result.current.config.balanceMicros, 87500);
      assert.equal(hook.result.current.busy, false);
    } finally {
      cleanup();
      globalThis.fetch = original;
    }
  });

for (const failure of [429, 503, "network"])
  test(`pre-text ${failure} failure shows its error without an empty answer card`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (url.endsWith("config"))
        return Response.json({
          enabled: true,
          priceMicros: 12500,
          balanceMicros: 100000,
        });
      if (failure === "network") throw new Error("Network unavailable.");
      return Response.json(
        { error: "AI capacity unavailable." },
        { status: failure },
      );
    };
    try {
      let ui;
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
      assert.ok(
        ui.getByText(
          failure === "network"
            ? "Network unavailable."
            : "AI capacity unavailable.",
        ),
      );
      assert.equal(
        ui.queryByRole("heading", { name: "AI answer arriving · incomplete" }),
        null,
      );
      assert.equal(
        ui.queryByRole("heading", {
          name: "AI answer · check against your records",
        }),
        null,
      );
      assert.ok(
        ui.getByRole("button", { name: "Get answer" }).disabled === false,
      );
    } finally {
      cleanup();
      globalThis.fetch = original;
    }
  });

for (const completed of [false, true])
  test(`stream failure ${completed ? "after" : "before"} text completion preserves the existing answer state`, async () => {
    const original = globalThis.fetch,
      results = [],
      messages = [];
    globalThis.fetch = async (url) =>
      url.endsWith("config")
        ? Response.json({
            enabled: true,
            priceMicros: 12500,
            balanceMicros: 100000,
          })
        : new Response(
            [
              { type: "start", source: "Google workbook" },
              { type: "text", delta: "6 7/16 inches." },
              ...(completed
                ? [{ type: "text_done", balanceMicros: 87500 }]
                : []),
              { type: "error", message: "Connection interrupted." },
            ]
              .map((event) => JSON.stringify(event))
              .join("\n") + "\n",
          );
    try {
      let hook;
      await act(async () => {
        hook = renderHook(() =>
          useManagedAnswers({
            project,
            source: "google",
            onResult: (r) => results.push(r),
            onMessage: (m) => messages.push(m),
          }),
        );
      });
      await act(async () => {
        await hook.result.current.ask("Clearance?", false);
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].kind, completed ? "answer" : "partial");
      assert.equal(results[0].answers[0].text, "6 7/16 inches.");
      assert.equal(messages.at(-1), "Connection interrupted.");
    } finally {
      cleanup();
      globalThis.fetch = original;
    }
  });
