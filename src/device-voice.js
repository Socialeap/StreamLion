import { useEffect, useState } from "react";
const key = "streamlion-device-voice-v1";
export function readVoicePreference(storage) {
  try {
    const v = JSON.parse(storage?.getItem(key) || "null");
    return {
      voiceURI: typeof v?.voiceURI === "string" ? v.voiceURI : "",
      rate:
        Number.isFinite(v?.rate) && v.rate >= 0.5 && v.rate <= 1.5 ? v.rate : 1,
    };
  } catch {
    return { voiceURI: "", rate: 1 };
  }
}
export function applyDeviceVoice(utterance, preference, synth) {
  const voice = (synth?.getVoices?.() || []).find(
    (v) => v.voiceURI === preference.voiceURI,
  );
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || "en-US";
  utterance.rate = preference.rate;
  return utterance;
}
export function useDeviceVoice() {
  const [preference, setPreference] = useState(() =>
    (() => {
      try {
        return readVoicePreference(window.localStorage);
      } catch {
        return { voiceURI: "", rate: 1 };
      }
    })(),
  );
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth?.getVoices?.() || []);
    update();
    synth?.addEventListener?.("voiceschanged", update);
    return () => synth?.removeEventListener?.("voiceschanged", update);
  }, []);
  function change(patch) {
    const next = { ...preference, ...patch };
    setPreference(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Session preference still works. */
    }
  }
  return {
    preference,
    voices,
    change,
    apply: (utterance) =>
      applyDeviceVoice(utterance, preference, window.speechSynthesis),
  };
}
