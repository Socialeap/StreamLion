import { useState } from "react";
import { Download, Check, NotebookPen } from "lucide-react";
import Recorder from "./Recorder";
import { download, getAudio } from "./storage";
function Note({ note, onRevise, onReview }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="note">
      <div className="note-meta">
        <strong>{note.area}</strong>
        <span>{new Date(note.createdAt).toLocaleString()}</span>
      </div>
      {note.audioId ? (
        <>
          <p>Voice memo · awaiting transcription</p>
          <button
            onClick={() =>
              action(async () => {
                const blob = await getAudio(note.audioId);
                if (!blob) throw new Error("Audio file is unavailable.");
                download(
                  blob,
                  `streamlion-${note.id}.${blob.type.includes("mp4") ? "m4a" : "webm"}`,
                );
              })
            }
            disabled={busy}
          >
            <Download size={16} />
            Download audio
          </button>
        </>
      ) : editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              await onRevise(note.id, text);
              setEditing(false);
            });
          }}
        >
          <label>
            Corrected note
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              maxLength={10000}
            />
          </label>
          <div className="actions">
            <button disabled={busy} className="primary">
              Save correction
            </button>
            <button
              type="button"
              onClick={() => {
                setText(note.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="note-text">{note.text}</p>
          <div className="actions">
            <button onClick={() => setEditing(true)}>Correct</button>
            <button
              disabled={busy || note.reviewed}
              onClick={() => action(() => onReview(note.id))}
            >
              {note.reviewed ? (
                <>
                  <Check size={16} />
                  Reviewed
                </>
              ) : (
                "Mark reviewed"
              )}
            </button>
          </div>
        </>
      )}
      {note.revisions?.length > 0 && (
        <details>
          <summary>{note.revisions.length} earlier version(s)</summary>
          {note.revisions.map((r, i) => (
            <p key={i} className="note-text">
              {r.text}
            </p>
          ))}
        </details>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </article>
  );
}
export default function Notes({
  workspace,
  selected,
  onSelect,
  onAdd,
  onAudio,
  onRevise,
  onReview,
  onCaptureBusy,
  captureBusy,
}) {
  const [area, setArea] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const job = workspace.jobs.find((j) => j.id === selected);
  const notes = workspace.notes.filter((n) => n.jobId === selected);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!area.trim() || !text.trim())
        throw new Error("Enter an area and note.");
      await onAdd({ jobId: selected, area: area.trim(), text });
      setText("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Field notes</h1>
          <p>Capture details on site.</p>
        </div>
      </header>
      {!workspace.jobs.length ? (
        <section className="empty">
          <NotebookPen size={64} strokeWidth={1} />
          <h2>Create a job first</h2>
          <p>Your notes will stay attached to their job and area.</p>
        </section>
      ) : (
        <>
          <label className="job-select">
            Current job
            <select
              value={selected}
              disabled={captureBusy || busy}
              onChange={(e) => onSelect(e.target.value)}
            >
              {workspace.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </label>
          {job?.scope && (
            <details className="scope">
              <summary>Scope and access instructions</summary>
              <p className="note-text">{job.scope}</p>
            </details>
          )}
          <div className="field-layout">
            <section className="editor">
              <form onSubmit={submit}>
                <label>
                  Area
                  <input
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    disabled={captureBusy || busy}
                    placeholder="Level 1 / Office 3 / Survey wall"
                    required
                    maxLength={200}
                  />
                </label>
                <label>
                  Note
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Record measurements with their exact units, observations, or access issues…"
                    rows={6}
                    maxLength={10000}
                    required
                    disabled={busy}
                  />
                </label>
                <p className="hint">
                  Original wording and fractions are preserved. Notes are not
                  automatically parsed into measurements.
                </p>
                <button className="primary full" disabled={busy || captureBusy}>
                  {busy ? "Saving…" : "Save note"}
                </button>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
              </form>
              <Recorder
                jobId={selected}
                area={area}
                onSave={onAudio}
                onBusy={onCaptureBusy}
              />
            </section>
            <section aria-label="Saved notes" className="note-list">
              <h2>
                Saved notes <span className="count">{notes.length}</span>
              </h2>
              {!notes.length ? (
                <p className="muted">Notes for this job will appear here.</p>
              ) : (
                notes
                  .slice()
                  .reverse()
                  .map((note) => (
                    <Note
                      key={note.id}
                      note={note}
                      onRevise={onRevise}
                      onReview={onReview}
                    />
                  ))
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
