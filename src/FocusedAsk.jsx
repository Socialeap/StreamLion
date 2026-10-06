import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  Mic,
  MessageCircle,
  Settings2,
  Square,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import { aiAvailabilityMessage } from "./managed-ai.js";
import ThemeSwitch from "./ThemeSwitch.jsx";

const cents = (micros) =>
  `${(micros / 10000).toFixed(2).replace(/\.?0+$/, "")}¢`;

// Presentation changes never replace the conversation owner or its media lifecycle.
export default function FocusedAsk({
  project,
  projectPanel,
  contextPanel,
  toolsPanel,
  stage,
  onStageChange,
  inputId,
  inputRef,
  question,
  onQuestionChange,
  onAsk,
  onVoice,
  onStop,
  onReadResult,
  canListen,
  canSpeak,
  listening,
  speaking,
  hearing,
  readAloud,
  onReadAloud,
  ai,
  source,
  onAIChange,
  onAISetup,
  message,
  result,
  answerRef,
}) {
  const [panel, setPanel] = useState(null);
  const dialog = useRef(null);
  const panelId = useId();
  const audio = speaking || ai.audioPlaying;
  const running = listening || audio || ai.busy;
  const phase = listening
    ? "listening"
    : audio
      ? "speaking"
      : ai.busy
        ? "preparing"
        : "ready";
  const stateText = listening
    ? hearing
      ? "Hearing your question"
      : "Listening…"
    : audio
      ? "Speaking answer"
      : ai.busy
        ? "Preparing answer"
        : result
          ? "Answer ready"
          : "Ready to listen";
  const VoiceIcon = audio ? Volume2 : Mic;
  const primaryLabel = listening
    ? "Cancel listening"
    : audio
      ? "Stop voice"
      : ai.busy
        ? "Stop AI answer"
        : "Ask by voice";
  useEffect(() => {
    const element = dialog.current;
    if (panel && !element.open) element.showModal();
    if (!panel && element.open) element.close();
  }, [panel]);
  const closePanel = () => setPanel(null);
  return (
    <section
      className="focused-ask"
      data-phase={phase}
      aria-label={`Ask about ${project.title}`}
    >
      <header className="ask-project-bar">
        <button
          className="ask-project-name"
          onClick={() => onStageChange("project")}
          title={project.title}
        >
          <FileText size={20} aria-hidden="true" />
          <span>{project.title}</span>
        </button>
        <button
          className="ask-icon-button"
          aria-label="Voice and AI settings"
          onClick={() => setPanel("settings")}
        >
          <Settings2 size={21} aria-hidden="true" />
        </button>
      </header>
      <div className="ask-stage-layout">
        <nav className="ask-stages" aria-label="Ask stages">
          {[
            ["project", FileText, "Project"],
            ["ask", MessageCircle, "Ask"],
            ["answer", Volume2, "Answer"],
          ].map(([value, Icon, label]) => (
            <button
              key={value}
              aria-current={stage === value ? "step" : undefined}
              disabled={
                value === "answer" && !result && !ai.busy && stage !== "answer"
              }
              onClick={() => onStageChange(value)}
            >
              <span>
                <Icon size={22} aria-hidden="true" />
              </span>
              {label}
            </button>
          ))}
        </nav>
        <div className="ask-stage-content">
          <header className="ask-task-head">
            <h1>
              {stage === "project"
                ? "Choose your project"
                : stage === "answer"
                  ? "Your answer"
                  : "Ask this project"}
            </h1>
            <div className="ask-credit-note">
              {ai.available && !ai.demo ? (
                <>
                  <span>{cents(ai.config.priceMicros)} / answer</span>
                  <span>{cents(ai.config.balanceMicros)} available</span>
                </>
              ) : (
                <span>{ai.demo ? "Demo · no charge" : "Free lookup"}</span>
              )}
            </div>
          </header>
          <div className="ask-mode-row">
            {ai.available ? (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={ai.active}
                  disabled={running}
                  onChange={(event) => onAIChange(event.target.checked)}
                />
                {ai.demo ? "Simulated AI" : "Use AI credits"}
              </label>
            ) : (
              <button
                className="ask-text-button"
                onClick={() => setPanel("settings")}
              >
                Free lookup · AI setup
              </button>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={readAloud}
                onChange={(event) => onReadAloud(event.target.checked)}
              />
              <Volume2 size={16} aria-hidden="true" />
              Read aloud
            </label>
          </div>
          {ai.active && !ai.demo && (
            <p className="ask-data-note">
              AI uses this project's records.{" "}
              <button onClick={() => setPanel("settings")}>Details</button>
            </p>
          )}
          <div
            hidden={stage !== "project"}
            className="ask-project-stage ask-scroll-region"
          >
            {projectPanel}
            <p className="hint">Questions use this project's saved records.</p>
            <button
              className="primary ask-submit"
              onClick={() => onStageChange("ask")}
            >
              Continue to Ask <ArrowRight size={22} aria-hidden="true" />
            </button>
          </div>
          <div hidden={stage !== "ask"} className="ask-question-stage">
            <div className="ask-voice-center">
              <button
                type="button"
                className="ask-mic-button"
                aria-label={primaryLabel}
                disabled={!canListen && !running}
                onClick={running ? onStop : onVoice}
              >
                {running ? (
                  <Square size={35} aria-hidden="true" />
                ) : (
                  <VoiceIcon size={44} aria-hidden="true" />
                )}
              </button>
              <strong>{primaryLabel}</strong>
              <div
                className={`ask-activity ${hearing || audio ? "is-active" : ""}`}
                aria-hidden="true"
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} style={{ "--bar": i }} />
                ))}
              </div>
              <span className="ask-state" role="status">
                {stateText}
              </span>
            </div>
            <form
              className="ask-compose"
              onSubmit={(event) => {
                event.preventDefault();
                if (question.trim() && !ai.busy) onAsk();
              }}
            >
              <label htmlFor={inputId}>Your question</label>
              <textarea
                id={inputId}
                ref={inputRef}
                value={question}
                maxLength={500}
                rows={2}
                placeholder="Ask about this project…"
                onChange={(event) => onQuestionChange(event.target.value)}
              />
              <button
                className="primary ask-submit"
                disabled={!question.trim() || ai.busy}
                type="submit"
              >
                <ArrowRight size={25} aria-hidden="true" />
                {ai.busy ? "Getting answer…" : "Get answer"}
              </button>
            </form>
            {!canListen && (
              <p className="hint">
                Type your question, or use your phone keyboard's microphone.
              </p>
            )}
          </div>
          <div hidden={stage !== "answer"} className="ask-answer-stage">
            <div className="ask-answer-state">
              <VoiceIcon size={25} aria-hidden="true" />
              <span role="status">{stateText}</span>
              <div
                className={`ask-activity ${audio ? "is-active" : ""}`}
                aria-hidden="true"
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} style={{ "--bar": i }} />
                ))}
              </div>
            </div>
            <div
              ref={answerRef}
              className="ask-answer-body ask-scroll-region"
              role="status"
              aria-atomic="true"
            >
              {result ? (
                <>
                  {result.message && <p>{result.message}</p>}
                  {result.answers.map((item) => (
                    <div key={item.topic}>
                      <h2>{item.title}</h2>
                      <p className="note-text">{item.text}</p>
                      <small>
                        Source: {item.sources.join("; ") || "No saved value"}
                      </small>
                    </div>
                  ))}
                  <p className="hint">{result.sourceLabel}</p>
                </>
              ) : (
                <p>
                  {ai.busy
                    ? "Your answer will appear here."
                    : "No answer was received. Return to Ask to try again."}
                </p>
              )}
            </div>
            <div className="ask-answer-actions">
              <button
                className="primary"
                disabled={running}
                onClick={() => onStageChange("ask")}
              >
                <Mic size={20} aria-hidden="true" />
                Ask another
              </button>
              {canSpeak &&
                result &&
                ["answer", "unsupported"].includes(result.kind) &&
                !running && (
                  <button onClick={onReadResult}>
                    <Volume2 size={20} aria-hidden="true" />
                    Read answer aloud
                  </button>
                )}
            </div>
          </div>
          {message && (
            <p className="ask-feedback" role="status">
              {message}
            </p>
          )}
          <footer className="ask-tools">
            <button onClick={() => setPanel("context")}>
              <BookOpen size={19} aria-hidden="true" />
              Context
            </button>
            <button onClick={() => setPanel("tools")}>
              <Wrench size={19} aria-hidden="true" />
              Tools
            </button>
            {running && (
              <button className="ask-stop" onClick={onStop}>
                <Square size={17} aria-hidden="true" />
                Stop
              </button>
            )}
          </footer>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="ask-dialog"
        aria-labelledby={panelId}
        onCancel={closePanel}
        onClose={closePanel}
      >
        <header>
          <h2 id={panelId}>
            {panel === "settings"
              ? "Voice and AI settings"
              : panel === "context"
                ? "Project context"
                : "Optional tools"}
          </h2>
          <button aria-label="Close panel" onClick={closePanel}>
            <X size={22} aria-hidden="true" />
          </button>
        </header>
        <div className="ask-dialog-body">
          {panel === "context" && contextPanel}
          {panel === "tools" && toolsPanel}
          {panel === "settings" && (
            <>
              <ThemeSwitch
                initialTheme={document.documentElement.dataset.theme}
              />
              <p>
                {ai.demo
                  ? "Simulated AI is available for this local demo."
                  : aiAvailabilityMessage(source, ai.config)}
              </p>
              {ai.available && (
                <p>
                  {ai.demo
                    ? "This demo uses simulated answers and device speech, with no provider spending."
                    : `${cents(ai.config.priceMicros)} per completed answer; ${cents(ai.config.balanceMicros)} credits remaining.`}
                </p>
              )}
              {source === "google" && !ai.demo && (
                <button disabled={running} onClick={ai.refresh}>
                  Check AI availability
                </button>
              )}
              {(source !== "google" ||
                ["connect_google", "select_workbook"].includes(
                  ai.config?.reason,
                )) &&
                onAISetup && (
                  <button disabled={running} onClick={onAISetup}>
                    Open Connections
                  </button>
                )}
              {!ai.active && (
                <details className="quiet-details">
                  <summary>Try a free project detail</summary>
                  <p>
                    Ask for the location name, address, site contact, access,
                    visit, requested work, deliverables, or payment.
                  </p>
                </details>
              )}
              <p className="hint">
                Free lookup uses saved project details. With AI credits enabled,
                your question and Google project records go to OpenAI; answer
                text goes to DeepInfra for voice. Browser dictation may use its
                speech service. StreamLion does not store question audio.
              </p>
            </>
          )}
        </div>
        <footer>
          {running && (
            <button onClick={onStop}>
              <Square size={18} aria-hidden="true" />
              Stop voice
            </button>
          )}
          <button className="primary" onClick={closePanel}>
            <Check size={18} aria-hidden="true" />
            Done
          </button>
        </footer>
      </dialog>
    </section>
  );
}
