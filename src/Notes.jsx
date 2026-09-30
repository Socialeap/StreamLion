import { useEffect, useState } from "react";
import { readDraft, writeDraft, clearDraft } from "./drafts";
import { Check, NotebookPen } from "lucide-react";
import Recorder from "./Recorder";
import FieldMedia from "./FieldMedia";
import { WORKFLOW_AREA, readWorkflow } from "./workflow";
function Note({ note, onRevise, onReview, captureBusy }) {
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
      {note.pendingBookId && (
        <p className="waiting-label">On this device · waiting for Google</p>
      )}
      {(note.audioId || note.audioUrl) && <FieldMedia note={note} />}
      {editing ? (
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
              disabled={busy || captureBusy}
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
              maxLength={10000}
            />
          </label>
          <div className="actions">
            <button disabled={busy || captureBusy} className="primary">
              Save correction
            </button>
            <button
              type="button"
              disabled={busy || captureBusy}
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
            <button
              disabled={busy || captureBusy}
              onClick={() => {
                setText(note.text);
                setEditing(true);
              }}
            >
              {note.text ? "Correct" : "Add written note"}
            </button>
            <button
              disabled={busy || captureBusy || note.reviewed}
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
      {note.sourceText && note.sourceText !== note.text && (
        <details>
          <summary>Original wording</summary>
          <p className="note-text">{note.sourceText}</p>
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
  draftScope = "local",
  allowAudio = true,
  onPhoto,
  initialArea = null,
}) {
  const draftKey = `${draftScope}:note:${selected}`;
  const savedDraft = readDraft(draftKey);
  const hintArea =
    initialArea?.projectId === selected && initialArea?.scope === draftScope
      ? initialArea.area
      : "";
  const [area, setArea] = useState(hintArea || savedDraft?.area || "");
  const [text, setText] = useState(savedDraft?.text || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = readDraft(draftKey);
    setArea(hintArea || d?.area || "");
    setText(d?.text || "");
  }, [draftKey, hintArea]);
  function updateDraft(a, t) {
    setArea(a);
    setText(t);
    try {
      writeDraft(draftKey, { area: a, text: t });
      setError("");
    } catch {
      setError(
        "Draft cannot be saved on this device. Copy your text before leaving.",
      );
    }
  }
  const job = workspace.jobs.find((j) => j.id === selected);
  const notes = workspace.notes.filter(
    (n) => n.jobId === selected && n.area !== WORKFLOW_AREA,
  );
  let requirementAreas = [];
  try {
    if (job)
      requirementAreas = readWorkflow(workspace.notes, job).requirements.map(
        (item) => item.area,
      );
  } catch {
    /* Project home reports invalid checklist records. */
  }
  const areas = [
    ...new Set(
      [...notes.map((note) => note.area), ...requirementAreas].filter(Boolean),
    ),
  ];
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (
        !selected ||
        !workspace.jobs.some((j) => j.id === selected) ||
        !area.trim() ||
        !text.trim()
      )
        throw new Error("Choose a project and enter an area and note.");
      await onAdd({ jobId: selected, area: area.trim(), text });
      clearDraft(draftKey);
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
              <option value="">Choose a project</option>
              {workspace.jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
          </label>
          {job && (
            <details className="scope">
              <summary>Scope and access instructions</summary>
              <h3>Access</h3>
              <p className="note-text">
                {job.accessInstructions || "Not recorded"}
              </p>
              <h3>Scope</h3>
              <p className="note-text">{job.scope || "Not recorded"}</p>
              <h3>Requested outputs</h3>
              <p className="note-text">{job.deliverables || "Not recorded"}</p>
              <h3>Excluded work</h3>
              <p className="note-text">{job.exclusions || "Not recorded"}</p>
            </details>
          )}
          <div className="field-layout">
            <section className="editor">
              <form onSubmit={submit}>
                <label>
                  Area
                  <input
                    value={area}
                    onChange={(e) => updateDraft(e.target.value, text)}
                    disabled={captureBusy || busy}
                    placeholder="Level 1 / Office 3 / Survey wall"
                    required
                    maxLength={200}
                    list="known-site-areas"
                  />
                  <datalist id="known-site-areas">
                    {areas.map((known) => (
                      <option key={known} value={known} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Note
                  <textarea
                    value={text}
                    onChange={(e) => updateDraft(area, e.target.value)}
                    placeholder="Record measurements with their exact units, observations, or access issues…"
                    rows={6}
                    maxLength={10000}
                    required
                    disabled={busy}
                  />
                </label>
                <p className="hint">
                  Original wording and fractions are preserved. Notes are not
                  automatically parsed into measurements. You can use your phone
                  keyboard's dictation button to speak a written note.
                </p>
                <button
                  className="primary full"
                  disabled={busy || captureBusy || !selected}
                >
                  {busy ? "Saving…" : "Save note"}
                </button>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
              </form>
              {onPhoto && (
                <label className="field-photo-input">
                  Add a field photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={busy || captureBusy || !selected || !area.trim()}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setBusy(true);
                      setError("");
                      onCaptureBusy(true);
                      try {
                        await onPhoto(
                          {
                            jobId: selected,
                            area: area.trim(),
                            fileName: file.name,
                          },
                          file,
                        );
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                        onCaptureBusy(false);
                        event.target.value = "";
                      }
                    }}
                  />
                  <small>
                    Choose the area first. Photos and recordings up to 5 MB are
                    kept here before sending to Google.
                  </small>
                </label>
              )}
              {allowAudio ? (
                <Recorder
                  jobId={selected}
                  area={area}
                  onSave={onAudio}
                  onBusy={onCaptureBusy}
                />
              ) : null}
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
                      captureBusy={captureBusy}
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
