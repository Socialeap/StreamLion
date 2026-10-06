import React, { useEffect, useId, useRef, useState } from "react";
import { Mic, Square, Volume2 } from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import {
  ANSWER_TOPICS,
  answerProjectQuestion,
  answerSourceLabel,
} from "./project-answers.js";

import useManagedAnswers from "./useManagedAnswers.js";
import { creditDollars, aiAvailabilityMessage } from "./managed-ai.js";
import FocusedAsk from "./FocusedAsk.jsx";

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

function VoiceAnswers({
  project,
  source = "device",
  asOf,
  onBusy,
  onAISetup,
  layout,
  projectPanel,
  contextPanel,
  toolsPanel,
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const answerRef = useRef(null);
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
  const [stage, setStage] = useState("ask");
  const [hearing, setHearing] = useState(false);
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

  useEffect(() => {
    if (result && layout !== "workspace")
      answerRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [result, layout]);

  const ai = useManagedAnswers({
    project,
    source,
    onBusy,
    onResult: setResult,
    onMessage: setMessage,
  });
  const aiRef = useRef(ai);
  aiRef.current = ai;

  function cancelMedia() {
    aiRef.current?.cancel();
    clearTimeout(timer.current);
    const previous = session.current;
    session.current = null;
    setHearing(false);
    // Invalidate before abort: some implementations synchronously fire end.
    if (previous) {
      previous.onresult =
        previous.onerror =
        previous.onend =
        previous.onspeechstart =
        previous.onspeechend =
          null;
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
    if (
      !canSpeak ||
      document.hidden ||
      !["answer", "unsupported"].includes(answer.kind)
    )
      return;
    cancelMedia();
    setListening(false);
    const fullText =
      answer.kind === "unsupported"
        ? "Saved-detail lookup cannot answer this question. For broader questions, enable the AI pilot on an eligible Google project. The setup steps are shown on screen."
        : answer.answers.map((item) => item.text).join(". ");
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
    // Dismiss the phone keyboard so the result is visible after submission.
    inputRef.current?.blur();
    setListening(false);
    setSpeaking(false);
    setMessage("");
    setStage("answer");
    if (aiRef.current.active) {
      aiRef.current.ask(text, automaticSpeech);
      return;
    }
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
    setStage("ask");
    busyCallback.current?.(true);
    try {
      const recognition = new Recognition();
      session.current = recognition;
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onspeechstart = () => {
        if (session.current === recognition) setHearing(true);
      };
      recognition.onspeechend = () => {
        if (session.current === recognition) setHearing(false);
      };
      recognition.onresult = (event) => {
        if (session.current !== recognition || document.hidden) return;
        const readings = Array.from(event.results);
        const text = readings
          .map((item) => item[0].transcript)
          .join(" ")
          .trim();
        setQuestion(text);
        if (text)
          setMessage("Words received. Tap Get answer now, or keep speaking.");
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
        if (layout === "workspace") {
          cancelMedia();
          setListening(false);
          setMessage("Question ready. Tap Get answer when you are ready.");
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

  function changeQuestion(value) {
    cancelMedia();
    setListening(false);
    setSpeaking(false);
    setMessage("");
    setQuestion(value);
    setResult(null);
  }
  function changeReadAloud(value) {
    readAloudRef.current = value;
    setReadAloud(value);
    try {
      window.localStorage.setItem(preferenceKey, String(value));
    } catch {
      /* Optional preference. */
    }
    if (!value && (speaking || ai.busy || ai.audioPlaying)) stopVoice();
  }
  function changeAI(value) {
    cancelMedia();
    setListening(false);
    setSpeaking(false);
    setResult(null);
    setMessage("");
    setStage("ask");
    ai.setActive(value);
  }
  if (layout === "workspace")
    return (
      <FocusedAsk
        project={project}
        projectPanel={projectPanel}
        contextPanel={contextPanel}
        toolsPanel={toolsPanel}
        stage={stage}
        onStageChange={setStage}
        inputId={inputId}
        inputRef={inputRef}
        question={question}
        onQuestionChange={changeQuestion}
        onAsk={() => ask(question)}
        onVoice={startVoice}
        onStop={stopVoice}
        onReadResult={() => speak(result)}
        canListen={canListen}
        canSpeak={canSpeak}
        listening={listening}
        speaking={speaking}
        hearing={hearing}
        readAloud={readAloud}
        onReadAloud={changeReadAloud}
        ai={ai}
        source={source}
        onAIChange={changeAI}
        onAISetup={onAISetup}
        message={message}
        result={result}
        answerRef={answerRef}
      />
    );

  return (
    <section
      className="project-voice"
      aria-label={`Quick answers for ${project.title}`}
    >
      {!ai.demo && (
        <div className="fact-answer">
          <strong>
            {ai.active
              ? "AI answers · Luna + Kokoro"
              : "Free saved-detail lookup · AI is off"}
          </strong>
          {!ai.active && (
            <>
              <p className="hint">{aiAvailabilityMessage(source, ai.config)}</p>
              {(source !== "google" ||
                ["connect_google", "select_workbook"].includes(
                  ai.config?.reason,
                )) &&
                onAISetup && (
                  <button
                    onClick={onAISetup}
                    disabled={listening || speaking || ai.busy}
                  >
                    Open Connections
                  </button>
                )}
              {source === "google" && !ai.available && (
                <button onClick={ai.refresh} disabled={ai.busy}>
                  Check AI availability
                </button>
              )}
            </>
          )}
        </div>
      )}
      {ai.available && (
        <div className="fact-answer">
          <label className="check-label">
            <input
              type="checkbox"
              checked={ai.active}
              onChange={(event) => {
                cancelMedia();
                setListening(false);
                setSpeaking(false);
                setResult(null);
                setMessage("");
                ai.setActive(event.target.checked);
              }}
            />
            {ai.demo
              ? "AI demo · simulated, no charge"
              : "Use AI pilot · Luna + Kokoro"}
          </label>
          <p className="hint">
            {ai.demo
              ? "Local fixture and device speech. Live model quality and hosted voice latency still need testing."
              : `${creditDollars(ai.config.priceMicros)} per completed answer · ${creditDollars(ai.config.balanceMicros)} pilot credits remaining. Your question and Google project records go to OpenAI; answer text goes to DeepInfra for voice. No question audio is stored by StreamLion.`}
          </p>
          {!ai.demo && (
            <button onClick={ai.refresh} disabled={ai.busy}>
              Refresh credits
            </button>
          )}
          {ai.busy && (
            <button onClick={stopVoice}>
              <Square size={18} aria-hidden="true" />
              Stop AI answer
            </button>
          )}
        </div>
      )}
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
            ref={inputRef}
            id={inputId}
            value={question}
            maxLength={500}
            placeholder="Who is the site contact?"
            onChange={(event) => {
              cancelMedia();
              setListening(false);
              setSpeaking(false);
              setMessage("");
              setQuestion(event.target.value);
              setResult(null);
            }}
          />
          <button type="submit" disabled={!question.trim() || ai.busy}>
            {ai.busy ? "Getting AI answer…" : "Get answer"}
          </button>
        </div>
      </form>
      {(canSpeak || ai.available) && (
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
              if (!event.target.checked && (speaking || ai.busy)) stopVoice();
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
        <div
          ref={answerRef}
          className="fact-answer voice-answer"
          role="status"
          aria-atomic="true"
        >
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
          {canSpeak &&
            ["answer", "unsupported"].includes(result.kind) &&
            !speaking &&
            !ai.busy && (
              <button onClick={() => speak(result)}>
                <Volume2 size={18} aria-hidden="true" />
                {result.kind === "unsupported"
                  ? "Read explanation aloud"
                  : "Read answer aloud"}
              </button>
            )}
        </div>
      )}
      {!ai.active && (
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
      )}
      <p className="hint voice-privacy">
        Answers use saved project fields. Browser dictation may send audio to
        its speech service and need internet. StreamLion does not store question
        audio. Saved answers are free; the optional AI pilot uses credits when
        enabled.
      </p>
    </section>
  );
}
