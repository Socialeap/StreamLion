import "fake-indexeddb/auto";
import React from "react";
import { JSDOM } from "jsdom";
import test from "node:test";
import assert from "node:assert/strict";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://localhost",
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
window.scrollTo = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: App } = await import("./App.jsx");
const { saveWorkspace } = await import("./storage.js");
const { offerUpdate } = await import("./updates.js");

test("Project home and Ask route voice activity into the app update gate", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ enabled: false, connected: false }));
  const instances = [];
  window.SpeechRecognition = class {
    constructor() {
      instances.push(this);
    }
    start() {}
    abort() {
      this.aborted = true;
    }
  };
  try {
    await saveWorkspace({
      version: 1,
      revision: 1,
      jobs: [
        {
          id: "voice-job",
          title: "Synthetic voice site",
          address: "123 Example Street",
        },
      ],
      notes: [],
    });
    const ui = render(<App />);
    fireEvent.click(
      await ui.findByRole(
        "button",
        { name: "Synthetic voice site" },
        { timeout: 5000 },
      ),
    );
    assert.ok(ui.getByRole("heading", { name: "Ask this project" }));
    let applied = 0;
    await act(() => offerUpdate(() => applied++));
    fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
    assert.equal(
      ui.getByRole("button", { name: "Update StreamLion" }).disabled,
      true,
    );
    fireEvent.click(ui.getByRole("button", { name: "Cancel listening" }));
    assert.equal(
      ui.getByRole("button", { name: "Update StreamLion" }).disabled,
      false,
    );
    fireEvent.click(ui.getByRole("button", { name: "Open Connections" }));
    assert.ok(ui.getByRole("heading", { name: "Connections" }));
    fireEvent.click(ui.getByRole("button", { name: "Ask", exact: true }));
    assert.ok(
      ui.container.querySelector(
        "#ask-read-aloud-controls input[type=checkbox]",
      ),
    );
    assert.equal(ui.queryByRole("navigation", { name: "Ask stages" }), null);
    assert.equal(ui.queryByRole("heading", { name: "Ask this project" }), null);
    fireEvent.click(ui.getByRole("button", { name: "Voice and AI settings" }));
    fireEvent.click(ui.getByRole("button", { name: "Open Connections" }));
    assert.ok(ui.getByRole("heading", { name: "Connections" }));
    assert.equal(instances[0].aborted, true);
    fireEvent.click(ui.getByRole("button", { name: "Ask", exact: true }));
    fireEvent.click(
      ui.getByRole("button", { name: "Synthetic voice site", exact: true }),
    );
    assert.equal(ui.getByRole("combobox").value, "voice-job");
    fireEvent.click(ui.getByRole("button", { name: "Continue to Ask" }));
    fireEvent.click(ui.getByRole("button", { name: "Ask by voice" }));
    assert.equal(
      ui.getByRole("button", { name: "Update StreamLion" }).disabled,
      true,
    );
    fireEvent.click(ui.getByRole("button", { name: "Cancel listening" }));
    assert.equal(applied, 0);
    assert.equal(
      ui.getByRole("button", { name: "Update StreamLion" }).disabled,
      false,
    );
  } finally {
    cleanup();
    globalThis.fetch = original;
    delete window.SpeechRecognition;
  }
});
