import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
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
dom.window.HTMLMediaElement.prototype.pause = function () {};
const { render, fireEvent, cleanup, waitFor } =
  await import("@testing-library/react");
const { default: VoiceControls } = await import("./VoiceControls.jsx");
const { useDeviceVoice } = await import("./device-voice.js");
let voices = [];
const synth = new dom.window.EventTarget();
synth.getVoices = () => voices;
window.speechSynthesis = synth;
const request = { projectId: "p", question: "contact" };
const pendingKey = "streamlion-hosted-speech-pending-v1";
function Harness({ lookup = request }) {
  const device = useDeviceVoice();
  return (
    <VoiceControls
      device={device}
      canSpeak
      source="google"
      request={lookup}
      onTestDevice={() => {}}
      onBeforePlay={() => {}}
      controllerRef={{ current: null }}
    />
  );
}
function mock(t, { enabled = true, speak } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/config"))
      return Response.json({
        enabled,
        scope: "scope-a",
        priceMicros: 1300,
        balanceMicros: 10000,
        maxChars: 1200,
      });
    if (url.endsWith("/quote"))
      return Response.json({
        text: "Site contact: Example Person",
        quoteToken: "quote",
        priceMicros: 1300,
        balanceMicros: 10000,
        expiresAt: Date.now() + 60000,
      });
    if (url.endsWith("/speak")) {
      if (speak) return speak(options);
      return new Response(new Uint8Array(48), {
        headers: {
          "Content-Type": "audio/wav",
          "X-Speech-Request-ID": JSON.parse(options.body).requestId,
        },
      });
    }
    if (url.includes("/status"))
      return Response.json({ state: "complete", priceMicros: 1300 });
    throw Error("unexpected URL");
  });
  return calls;
}
test.beforeEach(() => {
  window.localStorage.clear();
  voices = [];
});
test.afterEach(cleanup);

test("device voices load asynchronously, persist selection/speed, and preview makes no synthesis request", async (t) => {
  const calls = mock(t, { enabled: false }),
    ui = render(<Harness />);
  voices = [{ voiceURI: "voice-1", name: "Available voice", lang: "en-US" }];
  synth.dispatchEvent(new dom.window.Event("voiceschanged"));
  await waitFor(() =>
    assert.ok(ui.getByRole("option", { name: "Available voice · en-US" })),
  );
  fireEvent.change(ui.getByLabelText("Device voice"), {
    target: { value: "voice-1" },
  });
  fireEvent.change(ui.getByLabelText(/^Speech speed/), {
    target: { value: "1.2" },
  });
  assert.deepEqual(
    JSON.parse(window.localStorage.getItem("streamlion-device-voice-v1")),
    { voiceURI: "voice-1", rate: 1.2 },
  );
  const preview = ui.getByLabelText("Kokoro hosted voice sample");
  assert.equal(preview.getAttribute("preload"), "none");
  assert.equal(
    preview.getAttribute("src"),
    "/voice/kokoro-af-heart-preview.wav",
  );
  fireEvent.play(preview);
  fireEvent.click(ui.getByRole("button", { name: "Test device voice" }));
  await waitFor(() =>
    assert.ok(ui.getByText(/Paid hosted speech is not available/)),
  );
  assert.equal(
    ui.getByRole("button", { name: "Review speech-only price" }).disabled,
    true,
  );
  assert(calls.every((c) => !c.options.method || c.options.method === "GET"));
});

test("a fresh speech-only quote and explicit confirmation are required; double clicks buy one clip", async (t) => {
  let resolveSpeech;
  const calls = mock(t, {
    speak: (options) =>
      new Promise((resolve) => {
        resolveSpeech = () =>
          resolve(
            new Response(new Uint8Array(48), {
              headers: {
                "Content-Type": "audio/wav",
                "X-Speech-Request-ID": JSON.parse(options.body).requestId,
              },
            }),
          );
      }),
  });
  const ui = render(<Harness />);
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Review speech-only price" }).disabled,
      false,
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: "Review speech-only price" }));
  await ui.findByText("Site contact: Example Person");
  assert.equal(calls.filter((c) => c.url.endsWith("/speak")).length, 0);
  const button = ui.getByRole("button", { name: /Prepare speech —/ });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() =>
    assert.equal(calls.filter((c) => c.url.endsWith("/speak")).length, 1),
  );
  assert.ok(window.localStorage.getItem(pendingKey));
  resolveSpeech();
  await ui.findByLabelText("Prepared speech");
  assert.equal(window.localStorage.getItem(pendingKey), null);
  fireEvent.play(ui.getByLabelText("Prepared speech"));
  assert.equal(calls.filter((c) => c.url.endsWith("/speak")).length, 1);
  assert(!calls.some((c) => c.url.includes("/api/ai/")));
});

test("changed answer invalidates the reviewed quote before purchase", async (t) => {
  const calls = mock(t);
  const ui = render(<Harness />);
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Review speech-only price" }).disabled,
      false,
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: "Review speech-only price" }));
  await ui.findByText("Site contact: Example Person");
  ui.rerender(
    <Harness lookup={{ projectId: "other", question: "deliverables" }} />,
  );
  assert.equal(ui.queryByRole("button", { name: /Prepare speech —/ }), null);
  assert.equal(calls.filter((c) => c.url.endsWith("/speak")).length, 0);
});

test("uncertain responses persist a recovery reference and do not automatically retry or charge again", async (t) => {
  const calls = mock(t, {
      speak: async () => {
        throw Error("connection lost");
      },
    }),
    ui = render(<Harness />);
  await waitFor(() =>
    assert.equal(
      ui.getByRole("button", { name: "Review speech-only price" }).disabled,
      false,
    ),
  );
  fireEvent.click(ui.getByRole("button", { name: "Review speech-only price" }));
  await ui.findByRole("button", { name: /Prepare speech —/ });
  fireEvent.click(ui.getByRole("button", { name: /Prepare speech —/ }));
  await ui.findByText(/connection lost/);
  assert.ok(window.localStorage.getItem(pendingKey));
  assert.equal(
    ui.getByRole("button", { name: "Review speech-only price" }).disabled,
    true,
  );
  fireEvent.click(ui.getByRole("button", { name: "Check speech request" }));
  await ui.findByText(/Speech was prepared and charged/);
  assert.equal(calls.filter((c) => c.url.endsWith("/speak")).length, 1);
  assert.equal(window.localStorage.getItem(pendingKey), null);
});

test("lost request before reservation can be cleared only within its original account/workbook scope", async (t) => {
  window.localStorage.setItem(
    pendingKey,
    JSON.stringify({
      id: "original-id",
      scope: "scope-a",
      expiresAt: Date.now() - 300001,
    }),
  );
  t.mock.method(globalThis, "fetch", async (url) =>
    url.includes("/status")
      ? Response.json({ state: "not_found", scope: "scope-a" }, { status: 404 })
      : Response.json({ enabled: false }),
  );
  const ui = render(<Harness />);
  fireEvent.click(ui.getByRole("button", { name: "Check speech request" }));
  await ui.findByText(/request was not reserved/);
  assert.equal(window.localStorage.getItem(pendingKey), null);
});

test("a missing reservation cannot be cleared while the lost POST quote may still be valid", async (t) => {
  window.localStorage.setItem(
    pendingKey,
    JSON.stringify({
      id: "original-id",
      scope: "scope-a",
      expiresAt: Date.now() + 60000,
    }),
  );
  t.mock.method(globalThis, "fetch", async (url) =>
    url.includes("/status")
      ? Response.json({ state: "not_found", scope: "scope-a" }, { status: 404 })
      : Response.json({ enabled: false }),
  );
  const ui = render(<Harness />);
  fireEvent.click(ui.getByRole("button", { name: "Check speech request" }));
  await ui.findByText(/No reservation found yet/);
  assert.ok(window.localStorage.getItem(pendingKey));
  assert.equal(
    ui.getByRole("button", { name: "Review speech-only price" }).disabled,
    true,
  );
});

for (const status of [400, 401, 402, 403, 409, 415, 422]) {
  test(`definitive ${status} validation clears recovery immediately and requires a fresh quote`, async (t) => {
    const calls = mock(t, {
      speak: async () =>
        Response.json(
          { error: "Validation rejected before reservation" },
          { status },
        ),
    });
    const ui = render(<Harness />);
    await waitFor(() =>
      assert.equal(
        ui.getByRole("button", { name: "Review speech-only price" }).disabled,
        false,
      ),
    );
    fireEvent.click(
      ui.getByRole("button", { name: "Review speech-only price" }),
    );
    fireEvent.click(
      await ui.findByRole("button", { name: /Prepare speech —/ }),
    );
    await ui.findByText(/Validation rejected before reservation/);
    assert.equal(window.localStorage.getItem(pendingKey), null);
    assert.equal(
      ui.queryByRole("button", { name: "Check speech request" }),
      null,
    );
    assert.equal(ui.queryByRole("button", { name: /Prepare speech —/ }), null);
    assert.equal(
      ui.getByRole("button", { name: "Review speech-only price" }).disabled,
      false,
    );
    fireEvent.click(
      ui.getByRole("button", { name: "Review speech-only price" }),
    );
    await ui.findByRole("button", { name: /Prepare speech —/ });
    assert.equal(calls.filter((c) => c.url.endsWith("/quote")).length, 2);
    assert.equal(calls.filter((c) => c.url.endsWith("/speak")).length, 1);
  });
}
for (const scenario of [
  {
    name: "existing reservation",
    response: () =>
      Response.json(
        { error: "Request already submitted", state: "reserved" },
        { status: 409 },
      ),
  },
  {
    name: "uncertain server failure",
    response: () =>
      Response.json({ error: "Check the existing request" }, { status: 503 }),
  },
  {
    name: "unreadable validation response",
    response: () => new Response("edge interruption", { status: 409 }),
  },
]) {
  test(`${scenario.name} preserves recovery and blocks another purchase`, async (t) => {
    const calls = mock(t, { speak: async () => scenario.response() });
    const ui = render(<Harness />);
    await waitFor(() =>
      assert.equal(
        ui.getByRole("button", { name: "Review speech-only price" }).disabled,
        false,
      ),
    );
    fireEvent.click(
      ui.getByRole("button", { name: "Review speech-only price" }),
    );
    fireEvent.click(
      await ui.findByRole("button", { name: /Prepare speech —/ }),
    );
    await waitFor(() =>
      assert.ok(
        ui.getByRole("button", { name: "Check speech request" }).disabled ===
          false,
      ),
    );
    assert.ok(window.localStorage.getItem(pendingKey));
    assert.equal(
      ui.getByRole("button", { name: "Review speech-only price" }).disabled,
      true,
    );
    assert.equal(calls.filter((c) => c.url.endsWith("/speak")).length, 1);
  });
}
