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
test.beforeEach(() => window.localStorage.clear());
const project = {
  id: "project",
  title: "Synthetic venue",
  address: "123 Example Street",
};

test("hosted voice animation starts on queued PCM audio and clears on Stop while retaining text", async () => {
  const original = globalThis.fetch;
  let streamController, asking, hook;
  const nodes = [];
  window.AudioContext = class {
    state = "running";
    currentTime = 0;
    resume = async () => {};
    close = async () => {};
    createBuffer = () => ({
      duration: 0.01,
      getChannelData: () => new Float32Array(2),
    });
    createBufferSource() {
      const node = { connect() {}, start() {}, stop() {}, disconnect() {} };
      nodes.push(node);
      return node;
    }
  };
  globalThis.fetch = async (url) =>
    url.endsWith("config")
      ? Response.json({
          enabled: true,
          preferenceScope: "a".repeat(43),
          priceMicros: 12500,
          balanceMicros: 100000,
        })
      : new Response(
          new ReadableStream({
            start(controller) {
              streamController = controller;
            },
          }),
        );
  const send = (event) =>
    streamController.enqueue(
      new TextEncoder().encode(JSON.stringify(event) + "\n"),
    );
  const results = [];
  try {
    await act(async () => {
      hook = renderHook(() =>
        useManagedAnswers({
          project,
          source: "google",
          onResult: (result) => results.push(result),
          onMessage() {},
        }),
      );
    });
    await act(async () => {
      asking = hook.result.current.ask("Contact?", true);
    });
    assert.equal(hook.result.current.busy, true);
    assert.equal(hook.result.current.audioPlaying, false);
    await act(async () => {
      send({ type: "text", delta: "Contact: Sam." });
      send({
        type: "audio",
        audio: "AAABAA==",
        format: "pcm_s16le",
        sampleRate: 24000,
      });
      send({ type: "text_done", balanceMicros: 87500 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(nodes.length, 1);
    assert.equal(hook.result.current.audioPlaying, true);
    assert.equal(results.at(-1).answers[0].text, "Contact: Sam.");
    await act(async () => {
      hook.result.current.cancel();
      send({ type: "done" });
      streamController.close();
      await asking;
    });
    assert.equal(hook.result.current.audioPlaying, false);
    assert.equal(hook.result.current.busy, false);
    assert.equal(results.length, 1);
  } finally {
    cleanup();
    globalThis.fetch = original;
    delete window.AudioContext;
  }
});

test("broader questions stay free until explicit AI opt-in, then use the managed answer route", async () => {
  const original = globalThis.fetch,
    requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return url.endsWith("config")
      ? Response.json({
          enabled: true,
          preferenceScope: "a".repeat(43),
          priceMicros: 12500,
          balanceMicros: 100000,
        })
      : new Response(
          '{"type":"start","source":"Google workbook · read now"}\n{"type":"text","delta":"Room dimensions are required. Source: Requested work."}\n{"type":"text_done","balanceMicros":87500}\n{"type":"done","balanceMicros":87500}\n',
        );
  };
  try {
    let ui;
    await act(async () => {
      ui = render(<Answers project={project} source="google" />);
    });
    assert.ok(ui.getByText("Free saved-detail lookup · AI is off"));
    assert.ok(ui.getByText(/AI is available.*Choose AI credits/));
    fireEvent.change(ui.getByRole("textbox"), {
      target: {
        value: "are measurements for room dimensions required for this project",
      },
    });
    fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    assert.match(
      ui.getByRole("status").textContent,
      /Question received.*Saved-detail lookup cannot answer/,
    );
    assert.equal(requests.filter((r) => r.url.endsWith("answer")).length, 0);
    fireEvent.click(
      ui.getByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" }),
    );
    assert.ok(ui.getByText("AI answers · Luna + Kokoro"));
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    });
    assert.ok(
      ui.getByText("Room dimensions are required. Source: Requested work."),
    );
    assert.equal(requests.filter((r) => r.url.endsWith("answer")).length, 1);
    assert.equal(
      JSON.parse(requests.at(-1).options.body).question,
      "are measurements for room dimensions required for this project",
    );
    assert.equal(ui.queryByText(/Question received/), null);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

for (const [reason, message, setup] of [
  ["pilot_paused", /AI pilot is paused/, false],
  ["account_not_enabled", /Google account is not enrolled/, false],
  ["select_workbook", /Choose a Google workbook in Connections/, true],
  ["connect_google", /Reconnect Google before using AI answers/, true],
])
  test(`AI availability explains ${reason} and retry does not opt in or request an answer`, async () => {
    const original = globalThis.fetch,
      requests = [];
    globalThis.fetch = async (url) => {
      requests.push(url);
      return Response.json(
        requests.length === 1
          ? { enabled: false, reason }
          : {
              enabled: true,
              preferenceScope: "a".repeat(43),
              priceMicros: 12500,
              balanceMicros: 100000,
            },
      );
    };
    try {
      let ui;
      await act(async () => {
        ui = render(
          <Answers project={project} source="google" onAISetup={() => {}} />,
        );
      });
      assert.ok(ui.getByText(message));
      assert.equal(
        Boolean(ui.queryByRole("button", { name: "Open Connections" })),
        setup,
      );
      assert.equal(
        ui.queryByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" }),
        null,
      );
      await act(async () => {
        fireEvent.click(
          ui.getByRole("button", { name: "Check AI availability" }),
        );
      });
      assert.equal(
        ui.getByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" })
          .checked,
        false,
      );
      assert.deepEqual(requests, ["/api/ai/config", "/api/ai/config"]);
    } finally {
      cleanup();
      globalThis.fetch = original;
    }
  });

test("config errors disable AI until recovery without erasing consent or accepting older responses", async () => {
  const original = globalThis.fetch;
  let fail = false,
    pending,
    calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 3) return new Promise((resolve) => (pending = resolve));
    if (fail) throw new Error("Offline");
    return Response.json({
      enabled: true,
      preferenceScope: "a".repeat(43),
      priceMicros: 12500,
      balanceMicros: 100000,
    });
  };
  try {
    let ui;
    await act(async () => {
      ui = render(<Answers project={project} source="google" />);
    });
    fireEvent.click(
      ui.getByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" }),
    );
    fail = true;
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Refresh credits" }));
    });
    assert.ok(ui.getByText(/AI availability could not be checked/));
    assert.equal(
      ui.queryByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" }),
      null,
    );
    await act(async () => {
      fireEvent.click(
        ui.getByRole("button", { name: "Check AI availability" }),
      );
    });
    fail = false;
    await act(async () => {
      fireEvent.click(
        ui.getByRole("button", { name: "Check AI availability" }),
      );
    });
    assert.equal(
      ui.getByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" })
        .checked,
      true,
    );
    await act(async () => {
      pending(Response.json({ enabled: false, reason: "pilot_paused" }));
    });
    assert.ok(
      ui.getByRole("checkbox", { name: "Use AI pilot · Luna + Kokoro" }),
    );
    assert.equal(calls, 4);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

test("AI opt-in shows exact price; request sends only identity/question, displays streamed answer and updated credits", async () => {
  const original = globalThis.fetch,
    requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return url.endsWith("config")
      ? Response.json({
          enabled: true,
          preferenceScope: "a".repeat(43),
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
    assert.match(
      ui.getByText(/per completed answer/).textContent,
      /1 credit per completed answer/,
    );
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
    assert.match(
      ui.getByText(/per completed answer/).textContent,
      /7 credits remaining/,
    );
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
          preferenceScope: "a".repeat(43),
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
          preferenceScope: "a".repeat(43),
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
            preferenceScope: "a".repeat(43),
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
          preferenceScope: "a".repeat(43),
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
            preferenceScope: "a".repeat(43),
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
