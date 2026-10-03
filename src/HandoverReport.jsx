import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAudio, download } from "./storage.js";
import {
  handoverModel,
  handoverMarkup,
  handoverDocument,
  reportStyles,
} from "./handover.js";

async function thumbnail(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(
      1,
      900 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Photo preview is unavailable on this browser.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export default function HandoverReport({
  project,
  plan,
  notes,
  origin,
  asOf,
  connected,
  returnFocusElement,
  onClose,
  onBusy,
}) {
  const dialog = useRef(null),
    running = useRef(false);
  const [generatedAt] = useState(() => new Date().toISOString());
  const [includePayment, setIncludePayment] = useState(false),
    [includeUnreviewed, setIncludeUnreviewed] = useState(false);
  const [images, setImages] = useState({}),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const model = handoverModel(project, plan, notes, {
    origin,
    asOf,
    generatedAt,
    includePayment,
    includeUnreviewed,
  });
  useEffect(() => {
    // Loading disables the opener briefly, which can move focus to the body.
    const previous = returnFocusElement || document.activeElement;
    if (dialog.current.showModal) dialog.current.showModal();
    else dialog.current.setAttribute("open", "");
    return () => {
      previous?.focus?.();
    };
  }, []);
  async function photos(remote) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    let count = 0,
      unavailable = 0;
    try {
      const files = model.records
        .filter((note) => note.audioId || note.audioUrl)
        .slice(0, 10);
      const next = { ...images };
      for (const note of files) {
        try {
          let blob = await getAudio(note.audioId || note.id);
          if (!blob && remote && note.audioUrl) {
            const { readFieldFile } = await import("./google.js");
            blob = await readFieldFile(note.audioUrl);
          }
          if (!blob) {
            unavailable++;
            continue;
          }
          if (!blob.type.startsWith("image/")) continue;
          next[note.id] = await thumbnail(blob);
          count++;
        } catch {
          unavailable++;
        }
      }
      setImages(next);
      setNotice(
        `${count} photo${count === 1 ? "" : "s"} included. ${unavailable ? `${unavailable} file${unavailable === 1 ? " was" : "s were"} unavailable; original links remain in the report. ` : ""}Up to 10 field files are checked per report; original files stay unchanged.`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      running.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="handover-dialog"
      aria-labelledby="handover-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="handover-controls">
        <div className="section-heading">
          <h2 id="handover-title">Review your job handover</h2>
          <button onClick={onClose} disabled={busy}>
            Close report
          </button>
        </div>
        <p>
          Check the report, then choose Print / save PDF to share a clean copy
          with your client.
        </p>
        <div className="report-options">
          <label className="check-label">
            <input
              type="checkbox"
              checked={includePayment}
              onChange={(e) => setIncludePayment(e.target.checked)}
              disabled={busy}
            />
            Include fees and payment details
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={includeUnreviewed}
              onChange={(e) => setIncludeUnreviewed(e.target.checked)}
              disabled={busy}
            />
            Include unchecked records, clearly marked
          </label>
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => window.print()}
          >
            Print / save PDF
          </button>
          <button
            disabled={busy}
            onClick={() =>
              download(
                new Blob([handoverDocument(model, images)], {
                  type: "text/html",
                }),
                "streamlion-job-handover.html",
              )
            }
          >
            Download shareable report
          </button>
          <button disabled={busy} onClick={() => photos(false)}>
            Include photos from this device
          </button>
          {connected && (
            <button disabled={busy} onClick={() => photos(true)}>
              Load photos from Google
            </button>
          )}
        </div>
        <small>
          Unchecked records and payment fields are left out until you choose to
          include them. Source passages and notes keep their wording; check them
          before sharing. Included photo previews travel with the report.
        </small>
        {(notice || busy) && (
          <p role="status">{busy ? "Preparing photo previews…" : notice}</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <style>{reportStyles}</style>
      {/* Markup is generated by the escaping-only report renderer. It accepts no
        HTML from project fields, notes, URLs, source passages, or filenames. */}
      <div
        className="handover-pages"
        dangerouslySetInnerHTML={{ __html: handoverMarkup(model, images) }}
      />
    </dialog>,
    document.body,
  );
}
