import React from "react";
import { JSDOM } from "jsdom";
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, fireEvent, act, cleanup } =
  await import("@testing-library/react");
const { default: Recorder } = await import("./Recorder.jsx");
let hidden, resolvePermission, trackStops, instances, busy, downloads;
beforeEach(() => {
  hidden = false;
  trackStops = 0;
  instances = [];
  busy = [];
  downloads = 0;
  Object.defineProperty(document, "hidden", {
    get: () => hidden,
    configurable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: () =>
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
    },
    configurable: true,
  });
  globalThis.MediaRecorder = class {
    state = "inactive";
    mimeType = "audio/webm";
    constructor() {
      instances.push(this);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable({ data: new Blob(["test audio"]) });
      this.onstop();
    }
  };
  URL.createObjectURL = () => "blob:test-audio";
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {
    downloads++;
  };
});
afterEach(() => cleanup());
const setup = (save = async () => {}) =>
  render(
    <Recorder
      jobId="job-1"
      area="Office 1"
      onSave={save}
      onBusy={(value) => busy.push(value)}
    />,
  );
async function permit() {
  await act(async () =>
    resolvePermission({ getTracks: () => [{ stop: () => trackStops++ }] }),
  );
}
function visibility(value) {
  hidden = value;
  fireEvent(document, new dom.window.Event("visibilitychange"));
}
test("permission resolved while hidden releases tracks without starting recording", async () => {
  const ui = setup();
  fireEvent.click(ui.getByText("Record audio"));
  visibility(true);
  await permit();
  assert.equal(instances.length, 0);
  assert.equal(trackStops, 1);
  assert.equal(busy.at(-1), false);
  assert.ok(ui.getByText("Record audio"));
  assert.match(ui.getByRole("alert").textContent, /cancelled/);
});
test("foreground return does not revive a cancelled permission request", async () => {
  const ui = setup();
  fireEvent.click(ui.getByText("Record audio"));
  visibility(true);
  visibility(false);
  await permit();
  assert.equal(instances.length, 0);
  assert.equal(trackStops, 1);
  assert.equal(busy.at(-1), false);
});
test("unmount during permission acquisition releases acquired tracks", async () => {
  const ui = setup();
  fireEvent.click(ui.getByText("Record audio"));
  ui.unmount();
  await permit();
  assert.equal(instances.length, 0);
  assert.equal(trackStops, 1);
});
test("foreground recording still saves with original context", async () => {
  let result;
  const ui = setup(async (context, blob) => {
    result = { context, blob };
  });
  fireEvent.click(ui.getByText("Record audio"));
  await permit();
  await act(async () => fireEvent.click(ui.getByText(/Stop ·/)));
  assert.equal(result.context.jobId, "job-1");
  assert.equal(result.context.area, "Office 1");
  assert.ok(result.blob.size > 0);
  assert.equal(trackStops, 1);
  assert.equal(busy.at(-1), false);
});
test("failed save retains audio until explicit recovery confirmation, then unlocks", async () => {
  const ui = setup(async () => {
    throw new Error("Quota exceeded");
  });
  fireEvent.click(ui.getByText("Record audio"));
  await permit();
  await act(async () => fireEvent.click(ui.getByText(/Stop ·/)));
  assert.equal(busy.at(-1), true);
  assert.ok(ui.getByText("Retry save"));
  fireEvent.click(ui.getByText("Download audio"));
  assert.equal(downloads, 1);
  assert.equal(busy.at(-1), true);
  const before = new dom.window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(before);
  assert.equal(before.defaultPrevented, true);
  fireEvent.click(ui.getByText("I have a copy — continue"));
  assert.equal(busy.at(-1), false);
  assert.ok(ui.getByText("Record audio"));
  assert.equal(ui.queryByRole("alert"), null);
  const after = new dom.window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  assert.equal(after.defaultPrevented, false);
});
test("download failure retains retry path and capture lock", async () => {
  const ui = setup(async () => {
    throw new Error("Quota exceeded");
  });
  fireEvent.click(ui.getByText("Record audio"));
  await permit();
  await act(async () => fireEvent.click(ui.getByText(/Stop ·/)));
  URL.createObjectURL = () => {
    throw new Error("Download blocked");
  };
  fireEvent.click(ui.getByText("Download audio"));
  assert.equal(busy.at(-1), true);
  assert.ok(ui.getByText("Retry save"));
  assert.equal(ui.queryByText("I have a copy — continue"), null);
  assert.match(ui.getByRole("alert").textContent, /audio is still available/);
});
