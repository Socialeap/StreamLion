import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { PROJECT_FIELDS, intakeFor } from "./project-schema";
import { paymentSummary, projectContext, readWorkflow } from "./workflow";
import { download } from "./storage";

export function chatPrompt({ mode = "ask" } = {}) {
  if (mode === "create")
    return `Help me prepare a spatial capture project from a brief I will upload. Ask for the brief first. Use only facts from it; leave unknown details blank and preserve exact references, measurements and payment terms. Keep offered, agreed, invoiced and received amounts separate. Estimated hours do not establish an appointment end. Show missing or conflicting facts for review. Then give me a downloadable JSON project file using exactly this structure and field names, all values as strings: ${JSON.stringify(intakeFor(Object.fromEntries(PROJECT_FIELDS.map((field) => [field.key, ""]))))}. Do not add keys or save anything to Google. I will import and review the file in StreamLion.`;
  return "I will paste a StreamLion project snapshot and ask a question. Answer from that snapshot, cite the relevant field or observation, and ask if information is missing. It is a dated copy, not live Google access. Do not invent details or claim to save changes.";
}

export function chatUrl(options = {}) {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("prompt", chatPrompt(options));
  return url.toString();
}

function openChat(href) {
  const mobile = window.matchMedia?.("(max-width: 760px)").matches;
  const width = Math.min(620, Math.max(360, window.screen.availWidth - 40));
  const height = Math.min(820, Math.max(480, window.screen.availHeight - 60));
  const popup = window.open(
    href,
    mobile ? "_blank" : "streamlion-chat",
    mobile
      ? undefined
      : `popup=yes,width=${width},height=${height},left=${Math.max(0, window.screenX + (window.outerWidth - width) / 2)},top=${Math.max(0, window.screenY + (window.outerHeight - height) / 2)},resizable=yes,scrollbars=yes`,
  );
  if (popup) {
    try {
      popup.opener = null;
      popup.focus();
    } catch {
      /* Browser owns window behavior. */
    }
  }
  return popup;
}

export function ChatGPTLaunch({
  mode = "ask",
  context = "",
  className = "primary",
  onCopied,
}) {
  const [notice, setNotice] = useState("");
  return (
    <>
      <a
        className={`button-link ${className}`}
        href={chatUrl({ mode })}
        target="_blank"
        rel="noopener noreferrer"
        title={
          context
            ? "Copy this project's details and open your ChatGPT account. Paste them into the conversation."
            : "Open your ChatGPT account with a message ready to send."
        }
        onClick={(event) => {
          // Start copying while this document is focused. Open the window in
          // the same click, without waiting and losing browser user activation.
          const copy = context && navigator.clipboard?.writeText(context);
          // If the popup is blocked, preserve normal anchor navigation.
          if (openChat(chatUrl({ mode }))) event.preventDefault();
          if (context) {
            if (!copy) {
              setNotice(
                "Download the project snapshot below and attach it in ChatGPT.",
              );
              return;
            }
            copy
              .then(() => {
                setNotice(
                  "Project copied. Paste it into ChatGPT, then ask your question.",
                );
                onCopied?.();
              })
              .catch(() =>
                setNotice(
                  "Copy was blocked. Download the project snapshot below and attach it in ChatGPT.",
                ),
              );
          }
        }}
      >
        {context
          ? "Copy project & open ChatGPT"
          : mode === "create"
            ? "Prepare my brief in ChatGPT"
            : "Open ChatGPT"}{" "}
        <ExternalLink size={16} aria-hidden="true" />
      </a>
      {notice && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}
    </>
  );
}

export default function ChatGPTPanel({
  project,
  notes = [],
  asOf = "Current device records",
}) {
  const [fact, setFact] = useState("");
  let snapshot = "",
    plan,
    error = "";
  try {
    if (project) {
      plan = readWorkflow(notes, project);
      snapshot = JSON.stringify(
        projectContext(project, plan, notes, asOf),
        null,
        2,
      );
    }
  } catch (e) {
    error = e.message;
  }
  const facts = project
    ? {
        Visit: [
          project.startLocal
            ? `${project.startLocal.replace("T", " ")} (${project.timeZone || "time zone not recorded"})`
            : "Appointment not recorded",
          project.appointmentStatus || "Status not recorded",
        ].join(" · "),
        Access:
          project.accessInstructions || "Access instructions not recorded.",
        "Requested work":
          [
            project.scope,
            project.deliverables &&
              `Requested outputs: ${project.deliverables}`,
          ]
            .filter(Boolean)
            .join("\n\n") || "Work has not been recorded.",
        Payment: (() => {
          const pay = paymentSummary(project);
          return `Agreed: ${pay.agreed}\nInvoiced: ${pay.invoiced}\nReceived: ${pay.received}\nOutstanding: ${pay.outstanding}`;
        })(),
      }
    : {};
  return (
    <section className="intake-panel chat-panel">
      <h2>
        {project ? `Ask about ${project.title}` : "Choose a project above"}
      </h2>
      {project && (
        <>
          <p>Quick answers from your saved details. No chat setup needed.</p>
          <div className="actions">
            {Object.keys(facts).map((name) => (
              <button
                key={name}
                onClick={() => setFact(name)}
                aria-pressed={fact === name}
              >
                {name}
              </button>
            ))}
          </div>
          {fact && (
            <div className="fact-answer" role="status">
              <strong>{fact}</strong>
              <p className="note-text">{facts[fact]}</p>
              <small>From project details · {asOf}</small>
            </div>
          )}
          <h3>Need help thinking it through?</h3>
          <p>
            Use your own ChatGPT account. The project is copied for you; paste
            it once and ask your question.
          </p>
        </>
      )}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : (
        project && <ChatGPTLaunch context={snapshot} />
      )}
      {snapshot && (
        <details className="quiet-details">
          <summary>Project snapshot and backup</summary>
          <p>
            This dated copy includes the project details and field notes. It
            does not give ChatGPT a live Google connection.
          </p>
          <button
            onClick={() =>
              download(
                new Blob([snapshot], { type: "application/json" }),
                "streamlion-chat-snapshot.json",
              )
            }
          >
            Download project snapshot
          </button>
          <pre className="context-preview">{snapshot}</pre>
        </details>
      )}
      <p className="hint">
        Review proposed changes here before saving. ChatGPT account limits
        apply; StreamLion does not charge for questions.
      </p>
    </section>
  );
}
