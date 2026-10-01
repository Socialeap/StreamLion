import { useState } from "react";
import { projectFolder } from "./google.js";
import { folderLink } from "./drive-folders.js";

export default function ProjectFolderButton({
  bookId,
  project,
  disabled,
  onBusy,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [href, setHref] = useState("");
  async function open() {
    // Reserve the window during the click, before asynchronous Google requests.
    let popup;
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      popup = window.open("about:blank", "_blank");
      if (popup) popup.opener = null;
      const link = folderLink(
        await projectFolder(bookId, project.id, project.title),
      );
      setHref(link);
      if (popup) popup.location.replace(link);
    } catch (e) {
      popup?.close();
      setError(e.message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <span>
      <button
        disabled={disabled || busy}
        title="Open this project's own folder for field files in Google Drive."
        onClick={open}
      >
        {busy ? "Opening folder…" : "Open project folder"}
      </button>
      {href && (
        <a href={href} target="_blank" rel="noreferrer">
          Folder ready ↗
        </a>
      )}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  );
}
