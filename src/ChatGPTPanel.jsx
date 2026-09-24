import { ExternalLink } from "lucide-react";

const PLUGIN_ID = "plugin_ab4b9732e6e48191946b488302b897ce";

export function chatPrompt({ mode = "ask", project, bookId }) {
  if (mode === "create")
    return bookId
      ? `Create a spatial capture project from the specifications I will upload. My StreamLion Google workbook is https://docs.google.com/spreadsheets/d/${bookId}/edit. Show me the details and any missing information before saving.`
      : "Prepare a spatial capture project from the specifications I will upload. Show me the details and any missing information, then give me a StreamLion project JSON file to import in the app. Do not save to Google yet; I will connect a workbook first.";
  if (project && bookId)
    return `Open project record ${project.id} in my Google workbook: https://docs.google.com/spreadsheets/d/${bookId}/edit. Confirm its name before answering my question.`;
  if (bookId)
    return `Help me find or ask about projects in my Google workbook: https://docs.google.com/spreadsheets/d/${bookId}/edit.`;
  return project
    ? "I have a project saved on this device. Ask me to share its details before answering."
    : "Help me with a project. Ask me to share its details before answering.";
}

export function chatUrl(options) {
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("surface", "work");
  url.searchParams.set("hints", `plugin:${PLUGIN_ID}`);
  url.searchParams.set("prompt", chatPrompt(options));
  return url.toString();
}

export function ChatGPTLaunch({
  mode = "ask",
  project,
  bookId,
  className = "primary",
}) {
  const href = chatUrl({ mode, project, bookId });
  function launch(event) {
    if (window.matchMedia?.("(max-width: 760px)").matches) return;
    const width = Math.min(620, window.screen.availWidth - 40);
    const height = Math.min(820, window.screen.availHeight - 60);
    const left = Math.max(
      0,
      window.screenX + Math.round((window.outerWidth - width) / 2),
    );
    const top = Math.max(
      0,
      window.screenY + Math.round((window.outerHeight - height) / 2),
    );
    const popup = window.open(
      href,
      "streamlion-chat",
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (popup) {
      event.preventDefault();
      try {
        popup.opener = null;
        popup.focus();
      } catch {
        // Browser controls whether this is a window or a tab.
      }
    }
  }
  return (
    <a
      className={`button-link ${className}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={launch}
      title="Open a ChatGPT conversation with StreamLion ready to help. Your message is drafted but not sent."
    >
      Open StreamLion chat <ExternalLink size={16} aria-hidden="true" />
    </a>
  );
}

export default function ChatGPTPanel({ project, bookId }) {
  const prompt = chatPrompt({ project, bookId });
  return (
    <section className="intake-panel chat-panel">
      <h2 title="Ask about your projects or dictate a site observation in ChatGPT.">
        Talk with StreamLion
      </h2>
      <p>
        Open the chat and ask your question or speak a site note. StreamLion
        will already be selected and your starting message will be ready to
        edit.
      </p>
      <ChatGPTLaunch project={project} bookId={bookId} />
      <details className="quiet-details">
        <summary title="See the message prepared for ChatGPT.">
          What will be in the message?
        </summary>
        <p>{prompt}</p>
      </details>
      <p className="hint">
        {bookId
          ? "Your ChatGPT account connects to Google separately. Check the project details before saving changes."
          : "Projects saved only on this device are not visible in ChatGPT until you share their details."}
      </p>
    </section>
  );
}
