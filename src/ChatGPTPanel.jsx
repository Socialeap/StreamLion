import { useState } from "react";
export const CHATGPT_URL =
  "https://chatgpt.com/plugins/plugin_ab4b9732e6e48191946b488302b897ce";
export default function ChatGPTPanel({ project, bookId }) {
  const [status, setStatus] = useState("");
  const context = `Use StreamLion with my connected Google Drive. ${bookId ? `Workbook: https://docs.google.com/spreadsheets/d/${bookId}/edit.` : "Ask me to select my StreamLion workbook before reading or writing Google records."} ${project && bookId ? `Open project recordId ${project.id}. Fetch the current record and confirm its name before proceeding. I want to annotate this project or ask questions about it.` : project ? "My project is currently device-only. Ask me to attach its exported StreamLion JSON; do not try to retrieve its local ID from Google. Then help me save it to my selected workbook or discuss the supplied details." : "Help me create a project from the specifications I upload, or find an existing project."} Use the StreamLion v1 workbook contract. Read the latest revision before edits; preserve exact measurements and sources. Confirm a save only after readback. If Google tools are unavailable, return schemaVersion 1 streamlion.project JSON for review in the PWA. Do not claim a Google save.`;
  return (
    <section className="intake-panel">
      <h2>Work with StreamLion in ChatGPT</h2>
      <p>
        Upload specifications, ask about your records, or dictate an on-site
        observation. Copy the project context, then open StreamLion.
      </p>
      <div className="actions">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(context);
              setStatus("Context copied. Paste it into ChatGPT.");
            } catch {
              setStatus("Copy from the context below.");
            }
          }}
        >
          Copy {project ? "project" : "workspace"} context
        </button>
        <a
          className="button-link"
          href={CHATGPT_URL}
          target="_blank"
          rel="noreferrer"
        >
          Open StreamLion in ChatGPT ↗
        </a>
      </div>
      <details>
        <summary>Context to paste</summary>
        <textarea
          aria-label="ChatGPT context"
          readOnly
          value={context}
          rows={5}
        />
      </details>
      {status && <p role="status">{status}</p>}
      <p className="hint">
        ChatGPT uses its own Google connection. Voice availability depends on
        your account and device. This app does not start a hidden ChatGPT
        session.
      </p>
    </section>
  );
}
