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

test("the quiet credit quote is visible before opt-in and one submission starts one paid turn", async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return url.endsWith("config")
      ? Response.json({
          enabled: true,
          priceMicros: 12500,
          balanceMicros: 262500,
        })
      : new Response(
          '{"type":"text","delta":"Sam Example is the contact."}\n{"type":"text_done","balanceMicros":250000}\n{"type":"done"}\n',
        );
  };
  window.localStorage.clear();
  let ui;
  try {
    await act(async () => {
      ui = render(<Answers {...props} source="google" />);
    });
    assert.ok(ui.getByText("1 credit / answer"));
    assert.ok(ui.getByText("21 credits available"));
    assert.equal(
      ui.getByRole("checkbox", { name: "Use AI credits" }).checked,
      false,
    );
    fireEvent.click(ui.getByRole("checkbox", { name: "Use AI credits" }));
    fireEvent.change(ui.getByRole("textbox"), {
      target: { value: "Who is the site contact?" },
    });
    assert.equal(requests.filter((r) => r.url.endsWith("answer")).length, 0);
    await act(async () => {
      fireEvent.click(
        ui.getByRole("button", { name: "Get answer", exact: true }),
      );
    });
    assert.equal(requests.filter((r) => r.url.endsWith("answer")).length, 1);
    assert.ok(ui.getByText("20 credits available"));
    fireEvent.click(ui.getByRole("button", { name: "Context", exact: true }));
    fireEvent.click(ui.getByRole("button", { name: "Done", exact: true }));
    assert.equal(requests.filter((r) => r.url.endsWith("answer")).length, 1);
  } finally {
    cleanup();
    globalThis.fetch = original;
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
  assert.equal(
    ui
      .getByRole("button", { name: "Answer", exact: true })
      .getAttribute("aria-current"),
    "step",
  );
  assert.ok(ui.getByText(/Sam Example/));
  fireEvent.click(ui.getByRole("button", { name: "Ask", exact: true }));
  assert.equal(ui.getByRole("textbox").value, "Who is the site contact?");
  fireEvent.click(ui.getByRole("button", { name: "Tools", exact: true }));
  assert.ok(ui.getByText("Optional handoff"));
  fireEvent.click(ui.getByRole("button", { name: "Close panel" }));
  fireEvent.click(ui.getByRole("button", { name: "Answer", exact: true }));
  assert.ok(ui.getByText(/Sam Example/));
  ui.rerender(
    <Answers {...props} project={{ id: "other", title: "Other site" }} />,
  );
  assert.equal(ui.queryByText(/Sam Example/), null);
  assert.equal(ui.getByRole("textbox").value, "");
  cleanup();
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
