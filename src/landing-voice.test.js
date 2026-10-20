import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import {
  initializeLandingVoice,
  LANDING_VOICE_SAMPLES,
  landingVoiceAnswer,
} from "./landing-voice.js";

function setup(t, play = () => Promise.resolve()) {
  const dom = new JSDOM(
    readFileSync(new URL("../api/welcome.html", import.meta.url), "utf8"),
    { url: "https://streamlion.example/api/welcome" },
  );
  const { window } = dom;
  const played = [];
  window.HTMLMediaElement.prototype.play = function () {
    played.push(this);
    return play(this);
  };
  window.HTMLMediaElement.prototype.pause = function () {
    this.stopped = true;
  };
  window.HTMLMediaElement.prototype.load = function () {};
  initializeLandingVoice(window.document, window);
  t.after(() => window.close());
  const document = window.document;
  return {
    window,
    document,
    played,
    read: document.querySelector("#voice-demo-read"),
    choose: (topic) =>
      document.querySelector(`[data-question="${topic}"]`).click(),
    status: () => document.querySelector("#voice-demo-status").textContent,
  };
}

test("each available answer plays its own local recording only after a click", (t) => {
  const ui = setup(t);
  assert.equal(ui.played.length, 0);
  for (const [topic, sample] of Object.entries(LANDING_VOICE_SAMPLES)) {
    ui.choose(topic);
    assert.equal(
      ui.document.querySelector("#voice-answer-text").textContent,
      landingVoiceAnswer(topic).text,
    );
    if (!sample.audio) {
      assert.equal(ui.read.disabled, true);
      assert.match(ui.status(), /being updated/);
      continue;
    }
    ui.read.click();
    const audio = ui.played.at(-1);
    assert.equal(audio.getAttribute("src"), sample.audio);
    assert.equal(ui.read.textContent.trim(), "Stop reading");
    assert.equal(audio.preload, "none");
    audio.onplaying();
    assert.equal(ui.status(), "");
    audio.onended();
    assert.equal(audio.stopped, true);
    assert.equal(audio.isConnected, false);
    assert.equal(ui.read.textContent.trim(), "Read answer aloud");
  }
});

test("switching answers and Stop reading cancel the old audio without overlap", (t) => {
  const ui = setup(t);
  ui.read.click();
  const contact = ui.played.at(-1);
  ui.choose("access");
  assert.equal(contact.stopped, true);
  assert.equal(contact.isConnected, false);
  assert.equal(contact.getAttribute("src"), null);
  ui.read.click();
  const access = ui.played.at(-1);
  assert.notEqual(access, contact);
  ui.read.click();
  assert.equal(access.stopped, true);
  assert.equal(ui.played.length, 2);
});

test("a delayed rejection from a stopped recording cannot stop its replacement", async (t) => {
  let rejectOld;
  const ui = setup(
    t,
    () =>
      new Promise((_, reject) => {
        rejectOld = reject;
      }),
  );
  ui.read.click();
  const rejectContact = rejectOld;
  ui.choose("access");
  ui.read.click();
  const access = ui.played.at(-1);
  rejectContact(new Error("Old playback aborted"));
  await Promise.resolve();
  assert.notEqual(access.stopped, true);
  assert.equal(ui.read.textContent.trim(), "Stop reading");
});

test("playback failures retain readable answers and permit retry", async (t) => {
  const ui = setup(t, () => Promise.reject(new Error("Blocked playback")));
  ui.read.click();
  await Promise.resolve();
  assert.match(ui.status(), /Audio is unavailable/);
  assert.match(
    ui.document.querySelector("#voice-answer-text").textContent,
    /Alex Morgan/,
  );
  assert.equal(ui.read.disabled, false);
  assert.equal(ui.read.textContent.trim(), "Read answer aloud");
  ui.read.click();
  assert.equal(ui.played.length, 2);
  await Promise.resolve();
});

test("leaving or hiding the page stops the owned recording", (t) => {
  const ui = setup(t);
  ui.read.click();
  ui.window.dispatchEvent(new ui.window.Event("pagehide"));
  assert.equal(ui.played.at(-1).stopped, true);
  ui.read.click();
  Object.defineProperty(ui.document, "hidden", { value: true });
  ui.document.dispatchEvent(new ui.window.Event("visibilitychange"));
  assert.equal(ui.played.at(-1).stopped, true);
});

test("published recordings exist and no two answers accidentally share identical audio", () => {
  const hashes = new Set();
  for (const sample of Object.values(LANDING_VOICE_SAMPLES)) {
    if (!sample.audio) continue;
    const audio = readFileSync(
      new URL(`../public${sample.audio}`, import.meta.url),
    );
    assert.ok(audio.length > 1000);
    const hash = createHash("sha256").update(audio).digest("hex");
    assert.equal(
      hashes.has(hash),
      false,
      "Different answers must not share the same recording",
    );
    hashes.add(hash);
  }
  assert.ok(hashes.size >= 2);
});
