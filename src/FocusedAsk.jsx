import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  Mic,
  Settings2,
  Square,
  Volume2,
  Wrench,
  X,
} from "lucide-react";
import { aiAvailabilityMessage, creditLabel } from "./managed-ai.js";
import ThemeSwitch from "./ThemeSwitch.jsx";

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
  decision,
  onConfirmAI,
  onChooseFree,
  onDismissDecision,
  source,
  onAIChange,
  onAISetup,
  message,
  result,
  answerRef,
}) {
  const [panel, setPanel] = useState(null);
  const dialog = useRef(null);
  const [readAloudHost, setReadAloudHost] = useState(null);
  const openPanel = decision ? "request" : panel;
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
    setReadAloudHost(document.getElementById("ask-read-aloud-controls"));
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (openPanel && !element.open) element.showModal();
    if (!openPanel && element.open) element.close();
  }, [openPanel]);
  const closePanel = () => {
    if (decision) onDismissDecision();
    setPanel(null);
  };
  const readAloudControl = (
    <label className="check-label ask-read-aloud">
      <input
        type="checkbox"
        checked={readAloud}
        onChange={(event) => onReadAloud(event.target.checked)}
      />
      <Volume2 size={16} aria-hidden="true" />
      Read aloud
    </label>
  );
  return (
    <section
      className="focused-ask"
      data-phase={phase}
      aria-label={`Ask about ${project.title}`}
    >
      {readAloudHost ? (
        createPortal(readAloudControl, readAloudHost)
      ) : (
        <div className="ask-read-aloud-fallback">{readAloudControl}</div>
      )}
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
        <div className="ask-stage-content">
          <h1 className="sr-only">Ask {project.title}</h1>
          <div
            hidden={stage !== "project"}
            className="ask-project-stage ask-scroll-region"
          >
            {projectPanel}
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
                hidden={!running}
                className={`ask-activity ${hearing || audio ? "is-active" : ""}`}
                aria-hidden="true"
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <span key={i} style={{ "--bar": i }} />
                ))}
              </div>
              <span
                className={`ask-state ${running ? "" : "sr-only"}`}
                role="status"
              >
                {stateText}
              </span>
            </div>
            <form
              className="ask-compose"
              onSubmit={(event) => {
                event.preventDefault();
                if (question.trim() && !ai.busy && !ai.checking) onAsk();
              }}
            >
              <label className="sr-only" htmlFor={inputId}>
                Your question
              </label>
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
                disabled={!question.trim() || ai.busy || ai.checking}
                type="submit"
              >
                <ArrowRight size={25} aria-hidden="true" />
                {ai.checking
                  ? "Checking AI…"
                  : ai.busy
                    ? "Getting answer…"
                    : "Get answer"}
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
                hidden={!audio}
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
                      <p className="note-text">{item.text}</p>
                    </div>
                  ))}
                  <details className="quiet-details">
                    <summary>Sources</summary>
                    {result.answers.map((item) => (
                      <p className="hint" key={item.topic}>
                        {item.title}:{" "}
                        {item.sources.join("; ") || "No saved value"}
                      </p>
                    ))}
                    <p className="hint">{result.sourceLabel}</p>
                  </details>
                </>
              ) : null}
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
            {decision
              ? ai.available
                ? "Use AI for this workbook?"
                : "AI unavailable"
              : panel === "settings"
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
          {decision ? (
            ai.available ? (
              <>
                <p>
                  {ai.demo
                    ? "Simulated answer · no charge"
                    : `${creditLabel(ai.config.priceMicros)} per completed answer; ${creditLabel(ai.config.balanceMicros)} remaining.`}
                </p>
                <p>
                  {ai.demo
                    ? "This demo uses synthetic records and device speech. No providers are contacted."
                    : "Your question and this project's Google records go to OpenAI. DeepInfra provides voice."}
                </p>
                <p className="hint">
                  Remember this choice for this Google account and workbook. You
                  can switch to free lookup in Settings.
                </p>
              </>
            ) : (
              <p role="alert">{aiAvailabilityMessage(source, ai.config)}</p>
            )
          ) : null}
          {decision && !ai.available && source === "google" && (
            <button disabled={ai.checking} onClick={() => ai.refresh(true)}>
              {ai.checking
                ? "Checking AI availability…"
                : "Check AI availability"}
            </button>
          )}
          {(decision || panel === "settings") && ai.configCheck?.message && (
            <p
              className="hint"
              role={ai.configCheck.error ? "alert" : "status"}
            >
              {ai.configCheck.message}
            </p>
          )}
          {decision &&
            !ai.available &&
            onAISetup &&
            (source !== "google" ||
              ["connect_google", "select_workbook"].includes(
                ai.config?.reason,
              )) && <button onClick={onAISetup}>Open Connections</button>}
          {!decision && panel === "context" && contextPanel}
          {!decision && panel === "tools" && (
            <>
              {result && stage !== "answer" && (
                <button
                  onClick={() => {
                    closePanel();
                    onStageChange("answer");
                  }}
                >
                  Last answer
                </button>
              )}
              {toolsPanel}
            </>
          )}
          {!decision && panel === "settings" && (
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
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={ai.active}
                    disabled={running || ai.checking}
                    onChange={(event) => onAIChange(event.target.checked)}
                  />
                  {ai.demo ? "Simulated AI" : "Use AI credits"}
                </label>
              )}
              {ai.available && (
                <p>
                  {ai.demo
                    ? "This demo uses simulated answers and device speech, with no provider spending."
                    : `${creditLabel(ai.config.priceMicros)} per completed answer; ${creditLabel(ai.config.balanceMicros)} remaining.`}
                </p>
              )}
              {source === "google" && !ai.demo && (
                <button
                  disabled={running || ai.checking}
                  onClick={() => ai.refresh(true)}
                >
                  {ai.checking
                    ? "Checking AI availability…"
                    : "Check AI availability"}
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
                {ai.config?.billing === "credits"
                  ? "Purchased credits are separate from your one-time app purchase. The displayed charge is checked before each AI request."
                  : "Pilot credits are internal test allowances, separate from purchased credits."}
              </p>
              {!ai.demo && (
                <p>
                  <a href="/api/credits">Manage AI credits</a>
                </p>
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
          {decision ? (
            <>
              <button onClick={closePanel}>Cancel</button>
              <button onClick={onChooseFree}>Use free lookup</button>
              {ai.available && (
                <button
                  className="primary"
                  disabled={running || ai.checking}
                  onClick={onConfirmAI}
                >
                  Use AI and get answer
                </button>
              )}
            </>
          ) : (
            <button className="primary" onClick={closePanel}>
              <Check size={18} aria-hidden="true" />
              Done
            </button>
          )}
        </footer>
      </dialog>
    </section>
  );
}
