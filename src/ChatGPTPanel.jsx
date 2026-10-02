import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { PROJECT_FIELDS, intakeFor } from "./project-schema";
import { projectContext, readWorkflow } from "./workflow";
import ProjectVoiceAnswers from "./ProjectVoiceAnswers.jsx";
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

export function ChatGPTLaunch({ mode = "ask", className = "primary", label }) {
  return (
    <a
      className={`button-link ${className}`}
      href={chatUrl({ mode })}
      target="_blank"
      rel="noopener noreferrer"
      title="Open your ChatGPT account. This does not paste or send your project details."
      onClick={(event) => {
        // If the popup is blocked, preserve normal anchor navigation.
        if (openChat(chatUrl({ mode }))) event.preventDefault();
      }}
    >
      {label ||
        (mode === "create"
          ? "Prepare my brief in ChatGPT"
          : "Open ChatGPT")}{" "}
      <ExternalLink size={16} aria-hidden="true" />
    </a>
  );
}

function ProjectChatHandoff({ snapshot }) {
  const [status, setStatus] = useState("");
  const [copying, setCopying] = useState(false);
  async function copyProject() {
    setCopying(true);
    setStatus("");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(snapshot);
      setStatus(
        "Project details copied. Next, open ChatGPT and paste them into the message box.",
      );
    } catch {
      setStatus(
        "Could not copy. Try Copy project details again, or download the project snapshot below and attach it in ChatGPT.",
      );
    } finally {
      setCopying(false);
    }
  }
  return (
    <>
      <p>
        First copy your project details, then open your own ChatGPT account.
      </p>
      <div className="actions">
        <button
          className="primary"
          onClick={copyProject}
          disabled={copying}
          title="Copy this project's saved details and field notes to your clipboard."
        >
          {copying ? "Copying project details…" : "1. Copy project details"}
        </button>
        <ChatGPTLaunch className="" label="2. Open ChatGPT" />
      </div>
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}
      <div className="fact-answer">
        <strong>In ChatGPT: paste, ask, send</strong>
        <p>
          Click or tap the message box, paste your copied project details, add
          your question, then send the message.
        </p>
        <p className="hint">
          Computer: press ⌘V on Mac or Ctrl+V on Windows, or right-click and
          choose Paste. Phone or tablet: touch and hold the message box, then
          choose Paste.
        </p>
      </div>
    </>
  );
}

export default function ChatGPTPanel({
  project,
  notes = [],
  asOf = "Current device records",
  source = "device",
  scope,
  onBusy,
}) {
  let snapshot = "",
    handoffKey = "",
    plan,
    error = "";
  try {
    if (project) {
      plan = readWorkflow(notes, project);
      const context = projectContext(project, plan, notes, asOf);
      snapshot = JSON.stringify(context, null, 2);
      // A render-time timestamp is not a change to the selected records.
      // Keep in-flight copying and its confirmation until the content changes.
      handoffKey = JSON.stringify([
        project.id,
        { ...context, contextAsOf: undefined },
      ]);
    }
  } catch (e) {
    error = e.message;
  }
  return (
    <section className="intake-panel chat-panel">
      <h2>
        {project ? `Ask about ${project.title}` : "Choose a project above"}
      </h2>
      {project && (
        <>
          <ProjectVoiceAnswers
            project={project}
            source={source}
            scope={scope}
            asOf={asOf}
            onBusy={onBusy}
          />
          <h3>Need help thinking it through?</h3>
        </>
      )}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : (
        project && <ProjectChatHandoff key={handoffKey} snapshot={snapshot} />
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
