import test from "node:test";
import assert from "node:assert/strict";
import { readVoicePreference, applyDeviceVoice } from "./device-voice.js";
test("voice choice validates storage, applies available voice/speed and safely falls back", () => {
  const voice = { voiceURI: "preferred", lang: "en-GB" },
    synth = { getVoices: () => [voice] };
  const settings = readVoicePreference({
    getItem: () => JSON.stringify({ voiceURI: "preferred", rate: 1.2 }),
  });
  assert.deepEqual(applyDeviceVoice({}, settings, synth), {
    voice,
    lang: "en-GB",
    rate: 1.2,
  });
  assert.deepEqual(
    applyDeviceVoice({}, { voiceURI: "missing", rate: 1 }, synth),
    { lang: "en-US", rate: 1 },
  );
  for (const value of [
    "broken",
    JSON.stringify({ rate: 99 }),
    JSON.stringify({ rate: 0 }),
  ])
    assert.equal(readVoicePreference({ getItem: () => value }).rate, 1);
  assert.deepEqual(
    readVoicePreference({
      getItem() {
        throw Error("blocked");
      },
    }),
    { voiceURI: "", rate: 1 },
  );
});
