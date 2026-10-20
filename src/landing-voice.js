// Static, synthetic answers only. These recordings never contain visitor data.
import { sampleJob } from "./landing-job.js";
import { answerProjectQuestion } from "./project-answers.js";

const project = sampleJob().project;
export const LANDING_VOICE_SAMPLES = Object.freeze({
  contact: {
    question: "Who is the site contact?",
    audio: "/welcome/audio/harbor-house-contact-v1.mp3",
    narration:
      "Your site contact is Alex Morgan. You can reach Alex at plus one, two zero two, five five five, zero one four eight.",
  },
  access: {
    question: "How do I get in?",
    audio: "/welcome/audio/harbor-house-access-v1.mp3",
    narration: "Meet Alex at the front entrance. Call on arrival.",
  },
  outputs: {
    question: "What are the deliverables?",
    audio: "/welcome/audio/harbor-house-outputs-v1.mp3",
    narration:
      "The deliverables are a tour link, site notes, and checked measurements. Send them to the Harbor Property project manager.",
  },
});

export function landingVoiceAnswer(topic) {
  if (!Object.hasOwn(LANDING_VOICE_SAMPLES, topic)) return null;
  return answerProjectQuestion(project, LANDING_VOICE_SAMPLES[topic].question)
    .answers[0];
}

export function initializeLandingVoice(document, window) {
  const readButton = document.querySelector("#voice-demo-read");
  const readLabel = readButton.querySelector("span");
  const status = document.querySelector("#voice-demo-status");
  let topic = "contact";
  let activeAudio = null;

  function stop() {
    const audio = activeAudio;
    activeAudio = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    }
    readLabel.textContent = "Read answer aloud";
    status.textContent = "";
  }

  function showAnswer(nextTopic = topic) {
    const answer = landingVoiceAnswer(nextTopic);
    if (!answer) return;
    stop();
    topic = nextTopic;
    document.querySelector("#voice-demo-question").textContent =
      LANDING_VOICE_SAMPLES[topic].question;
    document.querySelector("#voice-answer-title").textContent = answer.title;
    document.querySelector("#voice-answer-text").textContent = answer.text;
    document.querySelector("#voice-answer-source").textContent =
      `Source: ${answer.sources.join("; ")}`;
    document.querySelectorAll("[data-question]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.question === topic),
      );
    });
    readButton.disabled =
      typeof window.Audio !== "function" || !LANDING_VOICE_SAMPLES[topic].audio;
    if (!LANDING_VOICE_SAMPLES[topic].audio)
      status.textContent =
        "This sample recording is being updated. The answer is shown above.";
  }

  function unavailable(audio) {
    // A stopped sample's delayed rejection must not change the current sample.
    if (activeAudio !== audio) return;
    stop();
    status.textContent =
      "Audio is unavailable here. The sample answer is still shown.";
  }

  document.querySelectorAll("[data-question]").forEach((button) => {
    button.addEventListener("click", () => showAnswer(button.dataset.question));
  });
  document.querySelector("#voice-demo-ask").addEventListener("click", () => {
    showAnswer();
    status.textContent =
      "Sample answer shown. In the app, tap Ask by voice and speak.";
  });
  readButton.disabled = typeof window.Audio !== "function";
  readButton.addEventListener("click", () => {
    if (activeAudio) {
      stop();
      return;
    }
    if (!LANDING_VOICE_SAMPLES[topic].audio) return;
    let audio = null;
    try {
      audio = new window.Audio(LANDING_VOICE_SAMPLES[topic].audio);
      audio.preload = "none";
      audio.id = "voice-demo-audio";
      audio.hidden = true;
      readButton.after(audio);
      activeAudio = audio;
      readLabel.textContent = "Stop reading";
      status.textContent = "Loading sample audio…";
      audio.onplaying = () => {
        if (activeAudio === audio) status.textContent = "";
      };
      audio.onended = () => {
        if (activeAudio === audio) stop();
      };
      audio.onerror = () => unavailable(audio);
      audio.play().catch(() => unavailable(audio));
    } catch {
      unavailable(audio);
    }
  });
  window.addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  showAnswer();
}
