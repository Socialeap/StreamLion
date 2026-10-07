import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.example",
  pretendToBeVisual: true,
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
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: Answers } = await import("./ProjectVoiceAnswers.jsx");
const project = {
  id: "synthetic",
  title: "Harbor House",
  contact1Name: "Sam Example",
};
const props = {
  project,
  source: "device",
  layout: "workspace",
  projectPanel: <p>Project chooser</p>,
  contextPanel: <p>Saved records</p>,
  toolsPanel: <p>Optional handoff</p>,
};

test("AI consent appears only on submission, is scoped to the account/workbook/quote, and survives reopening", async () => {
  const original = globalThis.fetch,
    requests = [];
  let config = {
    enabled: true,
    priceMicros: 12500,
    balanceMicros: 262500,
    preferenceScope: "a".repeat(43),
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return url.endsWith("config")
      ? Response.json(config)
      : new Response(
          '{"type":"text","delta":"Sam Example is the contact."}\n{"type":"text_done","balanceMicros":250000}\n{"type":"done"}\n',
        );
  };
  window.localStorage.clear();
  let ui;
  const open = async () => {
    await act(async () => {
      ui = render(<Answers {...props} source="google" />);
    });
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Who is the site contact?" },
    });
  };
  const submit = async () =>
    act(async () =>
      fireEvent.click(
        ui.getByRole("button", { name: "Get answer", exact: true }),
      ),
    );
  const paid = () => requests.filter((r) => r.url.endsWith("answer"));
  try {
    await open();
    assert.equal(ui.queryByText(/credits remaining/), null);
    assert.equal(ui.queryByRole("navigation", { name: "Ask stages" }), null);
    await submit();
    assert.equal(paid().length, 0);
    assert.ok(ui.getByRole("dialog", { name: "Use AI for this workbook?" }));
    assert.ok(
      ui.getByText("1 credit per completed answer; 21 credits remaining."),
    );
    await act(async () => {
      const button = ui.getByRole("button", { name: "Use AI and get answer" });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    assert.equal(paid().length, 1);
    assert.equal(
      JSON.parse(paid()[0].options.body).preferenceScope,
      config.preferenceScope,
    );
    assert.ok(ui.getByText("Sam Example is the contact."));
    cleanup();
    await open();
    await submit();
    assert.equal(paid().length, 2);
    assert.equal(ui.queryByRole("dialog"), null);
    cleanup();
    config = { ...config, preferenceScope: "b".repeat(43) };
    await open();
    await submit();
    assert.ok(ui.getByRole("dialog", { name: "Use AI for this workbook?" }));
    assert.equal(paid().length, 2);
    cleanup();
    config = { ...config, preferenceScope: "a".repeat(43), priceMicros: 25000 };
    await open();
    await submit();
    assert.ok(
      ui.getByText("2 credits per completed answer; 21 credits remaining."),
    );
    assert.equal(paid().length, 2);
  } finally {
    cleanup();
    globalThis.fetch = original;
    window.localStorage.clear();
  }
});

test("stage and utility switches preserve the question and answer without an extra request", () => {
  const ui = render(<Answers {...props} />);
  fireEvent.change(ui.getByRole("textbox", { name: "Your question" }), {
    target: { value: "Who is the site contact?" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Context", exact: true }));
  assert.ok(ui.getByRole("dialog"));
  assert.ok(ui.getByText("Saved records"));
  fireEvent.click(ui.getByRole("button", { name: "Done", exact: true }));
  assert.equal(ui.getByRole("textbox").value, "Who is the site contact?");
  fireEvent.click(ui.getByRole("button", { name: "Get answer", exact: true }));
  assert.equal(ui.container.querySelector(".ask-answer-stage").hidden, false);
  assert.ok(ui.getByText(/Sam Example/));
  fireEvent.click(ui.getByRole("button", { name: "Ask another", exact: true }));
  assert.equal(ui.getByRole("textbox").value, "Who is the site contact?");
  fireEvent.click(ui.getByRole("button", { name: "Tools", exact: true }));
  assert.ok(ui.getByText("Optional handoff"));
  fireEvent.click(ui.getByRole("button", { name: "Last answer", exact: true }));
  assert.ok(ui.getByText(/Sam Example/));
  ui.rerender(
    <Answers {...props} project={{ id: "other", title: "Other site" }} />,
  );
  assert.equal(ui.queryByText(/Sam Example/), null);
  assert.equal(ui.getByRole("textbox").value, "");
  cleanup();
});

test("a paused pilot never impersonates an AI answer and availability retry spends nothing", async () => {
  const original = globalThis.fetch,
    calls = [];
  const scope = "a".repeat(43);
  window.localStorage.clear();
  window.localStorage.setItem(
    `streamlion-ai-choice-v1:${scope}`,
    JSON.stringify({ mode: "ai", priceMicros: 12500 }),
  );
  let config = {
    enabled: false,
    reason: "pilot_paused",
    preferenceScope: scope,
    priceMicros: 12500,
    balanceMicros: 262500,
  };
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json(config);
  };
  let ui;
  try {
    await act(async () => {
      ui = render(<Answers {...props} source="google" />);
    });
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Who is the site contact?" },
    });
    fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    assert.ok(ui.getByRole("dialog", { name: "AI unavailable" }));
    assert.match(
      ui.getByRole("alert").textContent,
      /paused by the administrator/,
    );
    assert.equal(ui.queryByText(/Sam Example/), null);
    assert.equal(ui.queryByText(/Question received/), null);
    config = { ...config, enabled: true };
    await act(async () => {
      fireEvent.click(
        ui.getByRole("button", { name: "Check AI availability" }),
      );
    });
    assert.ok(ui.getByRole("button", { name: "Use AI and get answer" }));
    assert.equal(calls.filter((url) => url.endsWith("answer")).length, 0);
    fireEvent.click(ui.getByRole("button", { name: "Use free lookup" }));
    assert.ok(ui.getByText(/Sam Example/));
    assert.equal(
      JSON.parse(
        window.localStorage.getItem(`streamlion-ai-choice-v1:${scope}`),
      ).mode,
      "free",
    );
    assert.equal(calls.filter((url) => url.endsWith("answer")).length, 0);
  } finally {
    cleanup();
    globalThis.fetch = original;
    window.localStorage.clear();
  }
});

test("initial configuration blocks submission; unsupported free lookup retains the question with actionable recovery", async () => {
  const original = globalThis.fetch;
  let resolveConfig,
    calls = 0;
  globalThis.fetch = () => {
    calls++;
    return new Promise((resolve) => {
      resolveConfig = resolve;
    });
  };
  window.localStorage.clear();
  let ui;
  try {
    await act(async () => {
      ui = render(<Answers {...props} source="google" />);
    });
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Are room dimensions required?" },
    });
    assert.equal(
      ui.getByRole("button", { name: "Checking AI…" }).disabled,
      true,
    );
    await act(async () => {
      resolveConfig(
        Response.json({ enabled: false, reason: "pilot_unavailable" }),
      );
    });
    fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    assert.match(
      ui.getByRole("alert").textContent,
      /administrator configuration/,
    );
    fireEvent.click(ui.getByRole("button", { name: "Use free lookup" }));
    assert.equal(
      ui.getByRole("textbox").value,
      "Are room dimensions required?",
    );
    assert.ok(ui.getByText(/This question needs AI/));
    assert.equal(ui.queryByText(/Saved-detail lookup cannot answer/), null);
    assert.equal(calls, 1);
  } finally {
    cleanup();
    globalThis.fetch = original;
  }
});

test("availability recheck shows progress and completion for an unchanged pause, then recovers without submitting", async () => {
  const original = globalThis.fetch,
    calls = [];
  let pending;
  const paused = { enabled: false, reason: "pilot_paused" };
  globalThis.fetch = async (url) => {
    calls.push(url);
    return calls.length === 1
      ? Response.json(paused)
      : new Promise((resolve) => {
          pending = resolve;
        });
  };
  window.localStorage.clear();
  let ui;
  try {
    await act(async () => {
      ui = render(<Answers {...props} source="google" />);
    });
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Are room dimensions required?" },
    });
    fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    const button = ui.getByRole("button", { name: "Check AI availability" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    assert.equal(calls.length, 2);
    assert.equal(
      ui.getByRole("button", { name: "Checking AI availability…" }).disabled,
      true,
    );
    assert.ok(ui.getByText("Checking AI availability…", { selector: "p" }));
    await act(async () => {
      pending(Response.json(paused));
    });
    assert.ok(
      ui.getByText("Check complete — the administrator pause is still active."),
    );
    assert.equal(
      ui.getByRole("button", { name: "Check AI availability" }).disabled,
      false,
    );
    assert.ok(ui.getByRole("dialog", { name: "AI unavailable" }));
    await act(async () => {
      fireEvent.click(
        ui.getByRole("button", { name: "Check AI availability" }),
      );
    });
    await act(async () => {
      pending(
        Response.json({
          enabled: true,
          priceMicros: 12500,
          balanceMicros: 262500,
          preferenceScope: "r".repeat(43),
        }),
      );
    });
    assert.ok(ui.getByRole("dialog", { name: "Use AI for this workbook?" }));
    assert.ok(ui.getByText("AI is available. This check used no credits."));
    assert.equal(calls.filter((url) => url.endsWith("answer")).length, 0);
    fireEvent.click(ui.getByRole("button", { name: "Cancel", exact: true }));
    assert.equal(
      ui.getByRole("textbox").value,
      "Are room dimensions required?",
    );
    fireEvent.click(ui.getByRole("button", { name: "Voice and AI settings" }));
    act(() => {
      fireEvent.click(
        ui.getByRole("button", { name: "Check AI availability" }),
      );
    });
    assert.equal(
      ui.getByRole("checkbox", { name: "Use AI credits" }).disabled,
      true,
    );
    await act(async () => {
      pending(Response.json(paused));
    });
    assert.ok(
      ui.getByText("Check complete — the administrator pause is still active."),
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
    window.localStorage.clear();
  }
});

test("dictation shows real listening state but final words wait for explicit Get answer", () => {
  let recognition;
  window.SpeechRecognition = class {
    constructor() {
      recognition = this;
    }
    start() {}
    abort() {
      this.aborted = true;
    }
  };
  const ui = render(<Answers {...props} />);
  try {
    fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
    assert.equal(
      ui.container.querySelector(".focused-ask").dataset.phase,
      "listening",
    );
    act(() => recognition.onspeechstart());
    assert.equal(
      ui.container.querySelector(".ask-state").textContent,
      "Hearing your question",
    );
    const lateResult = recognition.onresult;
    act(() =>
      recognition.onresult({
        results: [
          Object.assign(
            [{ transcript: "Who is the site contact?", confidence: 1 }],
            { isFinal: true },
          ),
        ],
      }),
    );
    assert.equal(
      ui.container.querySelector(".focused-ask").dataset.phase,
      "ready",
    );
    assert.equal(ui.queryByText(/Sam Example/), null);
    assert.equal(ui.getByRole("textbox").value, "Who is the site contact?");
    assert.equal(recognition.aborted, true);
    fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    assert.ok(ui.getByText(/Sam Example/));
    act(() =>
      lateResult({
        results: [
          Object.assign([{ transcript: "Late words", confidence: 1 }], {
            isFinal: true,
          }),
        ],
      }),
    );
    assert.equal(ui.queryByText("Late words"), null);
  } finally {
    cleanup();
    delete window.SpeechRecognition;
  }
});

test("Ask another begins a fresh voice capture in one tap and spends only after submission", async () => {
  const original = globalThis.fetch;
  let recognition,
    starts = 0,
    paid = 0,
    ui;
  window.SpeechRecognition = class {
    constructor() {
      recognition = this;
    }
    start() {
      starts++;
    }
    abort() {
      this.aborted = true;
    }
  };
  globalThis.fetch = async (url) => {
    if (url.endsWith("config"))
      return Response.json({
        enabled: true,
        priceMicros: 12500,
        balanceMicros: 262500,
        preferenceScope: "f".repeat(43),
      });
    paid++;
    return new Response(
      '{"type":"text","delta":"A concise project answer."}\n{"type":"text_done"}\n{"type":"done"}\n',
    );
  };
  window.localStorage.clear();
  try {
    await act(async () => {
      ui = render(<Answers {...props} source="google" />);
    });
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Who is the site contact?" },
    });
    fireEvent.click(
      ui.getByRole("button", { name: "Get answer", exact: true }),
    );
    await act(async () =>
      fireEvent.click(
        ui.getByRole("button", { name: "Use AI and get answer" }),
      ),
    );
    assert.equal(paid, 1);
    fireEvent.click(
      ui.getByRole("button", { name: "Ask another", exact: true }),
    );
    assert.equal(starts, 1);
    assert.equal(
      ui.container.querySelector(".focused-ask").dataset.phase,
      "listening",
    );
    assert.equal(ui.getByRole("textbox").value, "");
    assert.equal(paid, 1);
    act(() =>
      recognition.onresult({
        results: [
          Object.assign(
            [{ transcript: "Are room dimensions required?", confidence: 1 }],
            { isFinal: true },
          ),
        ],
      }),
    );
    assert.equal(
      ui.getByRole("textbox").value,
      "Are room dimensions required?",
    );
    assert.equal(recognition.aborted, true);
    assert.equal(paid, 1);
    await act(async () =>
      fireEvent.click(
        ui.getByRole("button", { name: "Get answer", exact: true }),
      ),
    );
    assert.equal(paid, 2);
    assert.equal(ui.queryByRole("dialog"), null);
    assert.ok(ui.getByText("A concise project answer."));
  } finally {
    cleanup();
    delete window.SpeechRecognition;
    globalThis.fetch = original;
    window.localStorage.clear();
  }
});

test("voice playback and Stop drive the speaking state without losing its answer", () => {
  let utterance;
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  window.speechSynthesis = {
    speak(value) {
      utterance = value;
    },
    cancel() {},
  };
  const ui = render(<Answers {...props} />);
  try {
    fireEvent.click(ui.getByRole("checkbox", { name: "Read aloud" }));
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Who is the site contact?" },
    });
    fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
    assert.equal(
      ui.container.querySelector(".focused-ask").dataset.phase,
      "speaking",
    );
    assert.match(utterance.text, /Sam Example/);
    fireEvent.click(ui.getByRole("button", { name: "Stop", exact: true }));
    assert.equal(
      ui.container.querySelector(".focused-ask").dataset.phase,
      "ready",
    );
    assert.ok(ui.getByText(/Sam Example/));
  } finally {
    cleanup();
    delete window.SpeechSynthesisUtterance;
    delete window.speechSynthesis;
  }
});
