import React, { useEffect, useId, useRef, useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import {
  ANSWER_TOPICS,
  answerProjectQuestion,
  answerSourceLabel,
} from "./project-answers.js";

const preferenceKey = "streamlion-read-answers-v1";
const speechErrors = {
  "not-allowed":
    "Microphone access was blocked. Allow it in your browser settings, or type your question.",
  "service-not-allowed":
    "Voice questions are unavailable in this browser. Type, or use the microphone on your phone's keyboard.",
  "audio-capture":
    "The microphone is unavailable. Close other recordings and try again, or type your question.",
  network:
    "Voice dictation could not connect. Type your question, or try again when you have internet.",
  "no-speech": "No clear question was heard. Try again, or type your question.",
};

export default function ProjectVoiceAnswers(props) {
  // A changed record or owner invalidates in-flight media and prior answers.
  // Freshness timestamps alone must not reset an active voice session.
  const key = JSON.stringify([props.scope, props.project, props.source]);
  return <VoiceAnswers key={key} {...props} />;
}

function VoiceAnswers({ project, source = "device", asOf, onBusy }) {
  const inputId = useId();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [readAloud, setReadAloud] = useState(() => {
    try {
      return window.localStorage.getItem(preferenceKey) === "true";
    } catch {
      return false;
    }
  });
  const readAloudRef = useRef(readAloud);
  const session = useRef(null);
  const utterance = useRef(null);
  const timer = useRef(null);
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const canSpeak =
    !!window.speechSynthesis && !!window.SpeechSynthesisUtterance;
  const canListen = !!Recognition && window.isSecureContext !== false;

  function cancelMedia() {
    clearTimeout(timer.current);
    const previous = session.current;
    session.current = null;
    // Invalidate before abort: some implementations synchronously fire end.
    if (previous) {
      previous.onresult = previous.onerror = previous.onend = null;
      try {
        previous.abort();
      } catch {
        /* Already ended. */
      }
    }
    if (utterance.current) {
      utterance.current.onend = utterance.current.onerror = null;
      utterance.current = null;
      window.speechSynthesis?.cancel();
    }
    busyCallback.current?.(false);
  }

  useEffect(() => {
    const suspend = () => {
      if (!session.current && !utterance.current) return;
      cancelMedia();
      setListening(false);
      setSpeaking(false);
      setMessage(
        "Voice stopped when the app left the screen. Your project details are unchanged.",
      );
    };
    const hide = () => {
      if (document.hidden) suspend();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", suspend);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", suspend);
      cancelMedia();
    };
  }, []);

  function stopVoice() {
    cancelMedia();
    setListening(false);
    setSpeaking(false);
    setMessage("Voice stopped. You can type or ask again.");
  }

  function speak(answer) {
    if (!canSpeak || document.hidden || answer.kind !== "answer") return;
    cancelMedia();
    setListening(false);
    const fullText = answer.answers.map((item) => item.text).join(". ");
    const text =
      fullText.length > 1200
        ? `${fullText.slice(0, 1200)}. More saved details are shown on screen.`
        : fullText;
    const spoken = new window.SpeechSynthesisUtterance(
      `${project.title}. ${source === "copy" ? "From a saved Google copy. " : ""}${text}`,
    );
    spoken.lang = "en-US";
    utterance.current = spoken;
    const end = (failed) => {
      if (utterance.current !== spoken) return;
      clearTimeout(timer.current);
      utterance.current = null;
      setSpeaking(false);
      busyCallback.current?.(false);
      if (failed)
        setMessage("Audio could not play. Your answer is shown below.");
    };
    spoken.onend = () => end(false);
    spoken.onerror = () => end(true);
    setSpeaking(true);
    busyCallback.current?.(true);
    try {
      window.speechSynthesis.speak(spoken);
      if (utterance.current === spoken)
        timer.current = setTimeout(() => {
          if (utterance.current === spoken) stopVoice();
        }, 60000);
    } catch {
      end(true);
    }
  }

  // Recognition callbacks outlive their render; use the latest user preference.
  function ask(text, topicId, automaticSpeech = readAloudRef.current) {
    cancelMedia();
    setListening(false);
    setSpeaking(false);
    setMessage("");
    const answer = {
      ...answerProjectQuestion(project, text, topicId),
      sourceLabel: answerSourceLabel(source, asOf),
    };
    setResult(answer);
    if (automaticSpeech) speak(answer);
  }

  function startVoice() {
    if (!canListen) return;
    cancelMedia();
    setSpeaking(false);
    setResult(null);
    setQuestion("");
    setMessage("Listening… ask one question about this project.");
    setListening(true);
    busyCallback.current?.(true);
    try {
      const recognition = new Recognition();
      session.current = recognition;
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        if (session.current !== recognition || document.hidden) return;
        const readings = Array.from(event.results);
        const text = readings
          .map((item) => item[0].transcript)
          .join(" ")
          .trim();
        setQuestion(text);
        if (!text || readings.some((item) => !item.isFinal)) return;
        // Some engines report zero for unavailable confidence. Only defer
        // known low-confidence results, retaining wording for user correction.
        if (
          readings.some(
            (item) => item[0].confidence > 0 && item[0].confidence < 0.55,
          )
        ) {
          cancelMedia();
          setListening(false);
          setMessage("Please check the words I heard, then tap Get answer.");
          return;
        }
        ask(text);
      };
      recognition.onerror = (event) => {
        if (session.current !== recognition) return;
        cancelMedia();
        setListening(false);
        setMessage(
          speechErrors[event.error] ||
            "Voice was interrupted. Try again, or type your question.",
        );
      };
      recognition.onend = () => {
        if (session.current !== recognition) return;
        cancelMedia();
        setListening(false);
        setMessage(
          "No complete question was heard. Check the words above, then tap Get answer, or try again.",
        );
      };
      // Start in the click handler, preserving the browser's user gesture.
      recognition.start();
      if (session.current === recognition)
        timer.current = setTimeout(() => {
          if (session.current === recognition) stopVoice();
        }, 20000);
    } catch {
      cancelMedia();
      setListening(false);
      setMessage(
        "Voice could not start. Type your question, or use your phone keyboard's microphone.",
      );
    }
  }

  return (
    <section
      className="project-voice"
      aria-label={`Quick answers for ${project.title}`}
    >
      <div className="voice-heading">
        <div>
          <SectionHeading icon={Mic} tone="violet">
            Ask this project
          </SectionHeading>
          <p>Tap the microphone and ask, or type a short question.</p>
        </div>
        <button
          className={listening || speaking ? "" : "primary"}
          onClick={listening || speaking ? stopVoice : startVoice}
          disabled={!canListen && !speaking}
          title="Ask about saved project details. Allow microphone access when your browser asks."
        >
          {listening || speaking ? (
            <Square size={20} aria-hidden="true" />
          ) : (
            <Mic size={20} aria-hidden="true" />
          )}
          {listening
            ? "Cancel listening"
            : speaking
              ? "Stop voice"
              : "Ask by voice"}
        </button>
      </div>
      {!canListen && (
        <p className="hint">
          Voice is unavailable here. Type below, or tap the microphone on your
          phone's keyboard.
        </p>
      )}
      <form
        className="voice-question"
        onSubmit={(event) => {
          event.preventDefault();
          if (question.trim()) ask(question);
        }}
      >
        <label htmlFor={inputId}>Your question about {project.title}</label>
        <div>
          <input
            id={inputId}
            value={question}
            disabled={listening}
            maxLength={500}
            placeholder="Who is the site contact?"
            onChange={(event) => {
              cancelMedia();
              setSpeaking(false);
              setQuestion(event.target.value);
              setResult(null);
            }}
          />
          <button type="submit" disabled={listening || !question.trim()}>
            Get answer
          </button>
        </div>
      </form>
      {canSpeak && (
        <label className="check-label voice-preference">
          <input
            type="checkbox"
            checked={readAloud}
            onChange={(event) => {
              readAloudRef.current = event.target.checked;
              setReadAloud(event.target.checked);
              try {
                window.localStorage.setItem(
                  preferenceKey,
                  String(event.target.checked),
                );
              } catch {
                /* Preference is optional. */
              }
              if (!event.target.checked && speaking) stopVoice();
            }}
          />
          Read answers aloud
        </label>
      )}
      {message && (
        <p role="status" className="hint">
          {message}
        </p>
      )}
      {result && (
        <div className="fact-answer voice-answer" role="status">
          {result.message && <p>{result.message}</p>}
          {result.answers.map((item) => (
            <div key={item.topic}>
              <h3>{item.title}</h3>
              <p className="note-text">{item.text}</p>
              <small>
                Source: {item.sources.join("; ") || "No saved value"}
              </small>
            </div>
          ))}
          <p className="hint">{result.sourceLabel}</p>
          {canSpeak && result.kind === "answer" && !speaking && (
            <button onClick={() => speak(result)}>
              <Volume2 size={18} aria-hidden="true" />
              Read answer aloud
            </button>
          )}
        </div>
      )}
      <details className="quiet-details">
        <summary>Try a project detail</summary>
        <div className="actions">
          {ANSWER_TOPICS.map((topic) => (
            <button
              key={topic.id}
              onClick={() => {
                setQuestion(topic.label);
                ask(topic.label, topic.id);
              }}
            >
              {topic.label}
            </button>
          ))}
        </div>
      </details>
      <p className="hint voice-privacy">
        Answers use saved project fields. Browser dictation may send audio to
        its speech service and need internet. StreamLion does not store question
        audio or use a paid AI service.
      </p>
    </section>
  );
}
