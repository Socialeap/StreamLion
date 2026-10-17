// Presentational pieces shared by the provider setup assistant and the client
// request assistant. Steps come from a chat flow (chat-flow.js).
import { CircleCheck, Pencil } from "lucide-react";

export function ChatAvatar({ branding }) {
  return (
    <span className="setup-avatar" aria-hidden="true">
      {branding?.logo ? (
        <img
          src={branding.logo}
          alt=""
          className={`setup-avatar-logo provider-logo--${branding.shape || "rounded"}`}
        />
      ) : (
        <span className="workspace-lion" />
      )}
    </span>
  );
}
export function AssistantMessage({
  text,
  lead,
  hint,
  link,
  fresh,
  branding,
  children,
}) {
  return (
    <li className={`setup-message setup-assistant${fresh ? " is-new" : ""}`}>
      <ChatAvatar branding={branding} />
      <div className="setup-bubble">
        {lead && <p className="setup-lead">{lead}</p>}
        {text && <p>{text}</p>}
        {(hint || link) && (
          <p className="setup-hint">
            {hint}
            {hint && link && " "}
            {link && (
              <a href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label} ↗
              </a>
            )}
          </p>
        )}
        {children}
      </div>
    </li>
  );
}
export function AnswerText({ value }) {
  return Array.isArray(value) ? (
    <span className="setup-answer-lines">
      {value.map((line, i) => (
        <span key={i}>{line}</span>
      ))}
    </span>
  ) : (
    <span>{value}</span>
  );
}
function LogoAnswer({ value, alt = "" }) {
  return (
    <img
      src={value.logo}
      alt={alt}
      className={`provider-logo provider-logo--${value.shape}`}
    />
  );
}
export function UserMessage({
  step,
  value,
  answers,
  automatic,
  fresh,
  onEdit,
}) {
  return (
    <li
      className={`setup-message setup-user${automatic ? " is-automatic" : ""}${fresh ? " is-new" : ""}`}
    >
      <div className="setup-bubble">
        {automatic && <CircleCheck size={16} aria-hidden="true" />}
        {step.kind === "logo" && value?.logo ? (
          <span className="setup-answer-logo">
            <LogoAnswer value={value} />
            Logo added
          </span>
        ) : (
          <AnswerText value={step.summary(value, answers)} />
        )}
      </div>
      {onEdit && (
        <button
          type="button"
          className="setup-edit"
          aria-label={`Edit ${step.title.toLowerCase()}`}
          onClick={onEdit}
        >
          <Pencil size={13} aria-hidden="true" />
          Edit
        </button>
      )}
    </li>
  );
}
// Every confirmed answer, grouped by stage, each with its own Edit button.
export function ReviewCard({
  stages,
  history,
  answers,
  disabled,
  onEdit,
  finalStep = "review",
}) {
  return (
    <div className="setup-review">
      {stages.map((title, stage) => {
        const rows = history.filter(
          ({ step }) =>
            step.stage === stage &&
            step.id !== finalStep &&
            step.review !== false,
        );
        if (!rows.length) return null;
        return (
          <section key={title} aria-label={title}>
            <h3>{title}</h3>
            <dl>
              {rows.map(({ step, value }) => (
                <div key={step.id}>
                  <dt>{step.title}</dt>
                  <dd>
                    {step.kind === "logo" && value?.logo ? (
                      <LogoAnswer value={value} alt="Your logo" />
                    ) : (
                      <AnswerText value={step.summary(value, answers)} />
                    )}
                  </dd>
                  {step.editable !== false && (
                    <button
                      type="button"
                      className="setup-edit"
                      disabled={disabled}
                      aria-label={`Edit ${step.title.toLowerCase()}`}
                      onClick={() => onEdit(step.id)}
                    >
                      <Pencil size={13} aria-hidden="true" />
                      Edit
                    </button>
                  )}
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
export function ChatHeader({
  title,
  status,
  percent,
  label,
  branding,
  children,
}) {
  return (
    <header className="setup-header">
      <div className="setup-heading">
        <ChatAvatar branding={branding} />
        <div>
          <h1 id="setup-title">{title}</h1>
          <p>{status}</p>
        </div>
      </div>
      <div className="setup-header-actions">{children}</div>
      <div
        className="setup-progress"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
    </header>
  );
}
// Keep the newest message in view and move focus to the active answer.
export function scrollToLatest(element) {
  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  )?.matches;
  element?.scrollTo?.({
    top: element.scrollHeight,
    behavior: reduced ? "auto" : "smooth",
  });
}
export function focusAnswer(dock) {
  dock
    ?.querySelector("[data-setup-focus]:not(:disabled)")
    ?.focus({ preventScroll: true });
}
