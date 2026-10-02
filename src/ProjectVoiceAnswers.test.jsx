import React from "react";
import { JSDOM } from "jsdom";
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html lang='en'><body></body></html>", {
  url: "https://localhost",
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
const { default: ProjectVoiceAnswers } =
  await import("./ProjectVoiceAnswers.jsx");
const project = {
  id: "one",
  title: "Synthetic Nassau",
  address: "123 Example Street",
  contact1Name: "Example Manager",
  scope: "31 3/8 in doorway",
};
let instances, busy, spoken, cancels, hidden, throwStart;
beforeEach(() => {
  instances = [];
  busy = [];
  spoken = [];
  cancels = 0;
  hidden = false;
  throwStart = false;
  window.localStorage.clear();
  Object.defineProperty(document, "hidden", {
    get: () => hidden,
    configurable: true,
  });
  window.SpeechRecognition = class {
    constructor() {
      this.aborts = 0;
      instances.push(this);
    }
    start() {
      if (throwStart) throw new Error("blocked");
    }
    abort() {
      this.aborts++;
    }
  };
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  window.speechSynthesis = {
    speak: (value) => spoken.push(value),
    cancel: () => cancels++,
  };
});
afterEach(() => cleanup());
function mount(props = {}) {
  return render(
    <ProjectVoiceAnswers
      project={project}
      onBusy={(value) => busy.push(value)}
      {...props}
    />,
  );
}
function say(recognition, text, final = true, confidence = 0.9) {
  const item = [{ transcript: text, confidence }];
  item.isFinal = final;
  act(() => recognition.onresult?.({ results: [item] }));
}

test("typed facts work without speech APIs and do not require a connection", () => {
  delete window.SpeechRecognition;
  delete window.SpeechSynthesisUtterance;
  const ui = mount();
  assert.equal(ui.getByRole("button", { name: "Ask by voice" }).disabled, true);
  fireEvent.change(ui.getByRole("textbox"), {
    target: { value: "What is the address?" },
  });
  fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
  assert.match(
    ui.getByRole("status").textContent,
    /123 Example Street.*Source: Street address.*not verified against Google/,
  );
});

test("one tap accepts only final speech, stops microphone, and optionally speaks", () => {
  const ui = mount({ source: "google", asOf: "2026-10-01" });
  fireEvent.click(ui.getByRole("checkbox", { name: "Read answers aloud" }));
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  assert.equal(instances[0].continuous, false);
  say(instances[0], "Who is the site", false);
  assert.ok(!ui.queryByText(/Example Manager/));
  say(instances[0], "Who is the site contact?");
  assert.equal(instances[0].aborts, 1);
  assert.equal(spoken.length, 1);
  assert.match(spoken[0].text, /Synthetic Nassau.*Example Manager/);
  assert.match(ui.getByRole("status").textContent, /last read 2026-10-01/);
  act(() => spoken[0].onend());
  assert.equal(busy.at(-1), false);
});

test("low confidence retains editable words and requires Get answer", () => {
  const ui = mount();
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  say(instances[0], "address", true, 0.3);
  assert.equal(ui.getByRole("textbox").value, "address");
  assert.match(ui.getByRole("status").textContent, /check the words/);
  assert.ok(!ui.queryByText(/123 Example Street/));
  fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
  assert.match(ui.getByRole("status").textContent, /123 Example Street/);
});

for (const initiallyEnabled of [true, false]) {
  test(`read-aloud can be ${initiallyEnabled ? "disabled" : "enabled"} while recognition is active`, () => {
    window.localStorage.setItem(
      "streamlion-read-answers-v1",
      String(initiallyEnabled),
    );
    const ui = mount();
    fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
    const recognition = instances[0];
    fireEvent.click(ui.getByRole("checkbox", { name: "Read answers aloud" }));
    assert.equal(instances.length, 1);
    assert.equal(recognition.aborts, 0);
    say(recognition, "Who is the site contact?");
    assert.equal(spoken.length, initiallyEnabled ? 0 : 1);
    assert.match(ui.getByRole("status").textContent, /Example Manager/);
    assert.equal(
      window.localStorage.getItem("streamlion-read-answers-v1"),
      String(!initiallyEnabled),
    );
  });
}

test("permission, network and start errors release busy state and allow retry", () => {
  const ui = mount();
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  act(() => instances[0].onerror({ error: "not-allowed" }));
  assert.match(
    ui.getByRole("status").textContent,
    /Microphone access was blocked/,
  );
  assert.equal(busy.at(-1), false);
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  act(() => instances[1].onerror({ error: "network" }));
  assert.match(ui.getByRole("status").textContent, /internet/);
  throwStart = true;
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  assert.match(ui.getByRole("status").textContent, /could not start/);
  assert.equal(busy.at(-1), false);
  throwStart = false;
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  say(instances.at(-1), "address");
  assert.match(ui.getByRole("status").textContent, /123 Example Street/);
});

test("cancel, background, project, ownership change and unmount ignore late callbacks", () => {
  const ui = mount({ scope: "book-a" });
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  const first = instances[0],
    late = first.onresult;
  fireEvent.click(ui.getByRole("button", { name: "Cancel listening" }));
  act(() =>
    late({
      results: [Object.assign([{ transcript: "address" }], { isFinal: true })],
    }),
  );
  assert.ok(!ui.queryByText(/123 Example Street/));
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  hidden = true;
  fireEvent(document, new window.Event("visibilitychange"));
  assert.equal(instances[1].aborts, 1);
  assert.equal(busy.at(-1), false);
  hidden = false;
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  const old = instances[2],
    callback = old.onresult;
  ui.rerender(
    <ProjectVoiceAnswers
      project={{
        ...project,
        id: "two",
        title: "Other site",
        address: "Other address",
      }}
      scope="book-a"
    />,
  );
  assert.equal(old.aborts, 1);
  act(() =>
    callback({
      results: [Object.assign([{ transcript: "address" }], { isFinal: true })],
    }),
  );
  assert.ok(!ui.queryByText(/123 Example Street/));
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  ui.rerender(
    <ProjectVoiceAnswers
      project={{
        ...project,
        id: "two",
        title: "Other site",
        address: "Other address",
      }}
      scope="book-b"
    />,
  );
  assert.equal(instances[3].aborts, 1);
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  ui.unmount();
  assert.equal(instances[4].aborts, 1);
});

test("freshness-only rerenders keep capture, changed saved fields cancel, playback can stop", () => {
  const ui = mount({ asOf: "first" });
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  ui.rerender(<ProjectVoiceAnswers project={{ ...project }} asOf="second" />);
  assert.equal(instances[0].aborts, 0);
  ui.rerender(
    <ProjectVoiceAnswers
      project={{ ...project, address: "Updated" }}
      asOf="second"
    />,
  );
  assert.equal(instances[0].aborts, 1);
  fireEvent.change(ui.getByRole("textbox"), { target: { value: "address" } });
  fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
  fireEvent.click(ui.getByRole("button", { name: "Read answer aloud" }));
  fireEvent.click(ui.getByRole("button", { name: "Stop voice" }));
  assert.equal(cancels, 1);
  assert.match(ui.getByText(/Street address: Updated/).textContent, /Updated/);
});

test("listening times out and playback failure leaves a usable text answer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = mount();
  fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
  act(() => t.mock.timers.tick(20000));
  assert.equal(instances[0].aborts, 1);
  assert.equal(busy.at(-1), false);
  fireEvent.change(ui.getByRole("textbox"), { target: { value: "address" } });
  fireEvent.click(ui.getByRole("button", { name: "Get answer" }));
  fireEvent.click(ui.getByRole("button", { name: "Read answer aloud" }));
  act(() => spoken[0].onerror());
  assert.equal(busy.at(-1), false);
  assert.ok(ui.getByText(/Audio could not play/));
  assert.ok(ui.getByText(/Street address: 123 Example Street/));
  t.mock.timers.reset();
});
