import { useState } from "react";
import { Ruler, Mic, Layers } from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import { readDraft, writeDraft, clearDraft } from "./drafts";
import { download } from "./storage";
import {
  MEASUREMENT_KIND,
  parseMeasurements,
  connectedTotals,
  measurementSet,
  readMeasurement,
  measurementText,
} from "./measurements.js";

const empty = () => ({
  room: "",
  floor: "",
  side: "Interior",
  raw: "",
  entries: [],
  issues: [],
  checked: false,
  clarifyingIssue: null,
  enteredAt: new Date().toISOString(),
  editingId: null,
  base: "",
});
export default function Measurements({
  project,
  notes,
  scope,
  disabled = false,
  onSave,
}) {
  const key = `${scope}:measurements:${project.id}`;
  const [draft, setDraft] = useState(() => readDraft(key) || empty());
  const [input, setInput] = useState(() => readDraft(key)?.input || "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = disabled || busy;
  function retain(next, nextInput = input) {
    setDraft(next);
    setInput(nextInput);
    setNotice("");
    try {
      writeDraft(key, { ...next, input: nextInput });
      setError("");
    } catch {
      setError(
        "This device could not retain your draft. Copy the original wording before leaving.",
      );
    }
  }
  let records = [],
    invalid = "";
  for (const note of notes.filter((n) => n.jobId === project.id)) {
    try {
      const data = readMeasurement(note);
      if (data) records.push({ note, data });
    } catch (e) {
      invalid = e.message;
    }
  }
  const dirty = !!(
    input ||
    draft.entries.length ||
    draft.issues.length ||
    draft.editingId
  );
  const rooms = [...new Set(records.map((r) => r.data.room))];
  function organize() {
    try {
      if (!draft.room.trim())
        throw new Error("Choose a room or exterior area first.");
      const clarifying = draft.clarifyingIssue != null;
      if (!clarifying && /^undo last entry[.!]?$/i.test(input.trim())) {
        if (!draft.entries.length)
          throw new Error("There is no unsaved entry to undo.");
        retain(
          { ...draft, entries: draft.entries.slice(0, -1), checked: false },
          "",
        );
        setNotice(
          "Last unsaved entry removed. Saved batches were not changed.",
        );
        return;
      }
      const change =
        /^change (?:the )?(length|width|height|ceiling|depth|segment|diagonal)\s+(?:to\s+)?(.+?)[.!]?$/i.exec(
          input.trim(),
        );
      if (change && !clarifying) {
        const targets = draft.entries.filter(
          (e) => e.label.toLowerCase() === change[1].toLowerCase(),
        );
        if (targets.length !== 1)
          throw new Error(
            "This correction could refer to more than one reading, or none. Use Correct reading on the specific entry below.",
          );
        const replacement = parseMeasurements(`${change[1]} ${change[2]}`);
        if (replacement.issues.length || replacement.entries.length !== 1)
          throw new Error(
            replacement.issues[0]?.message ||
              "Give one exact correction with units.",
          );
        const entries = draft.entries.map((e) =>
          e.id === targets[0].id ? { ...replacement.entries[0], id: e.id } : e,
        );
        const next = {
          ...draft,
          entries,
          checked: false,
          raw: `${draft.raw}\nCorrection: ${input}`,
        };
        measurementSet({ ...next, kind: MEASUREMENT_KIND, version: 1 });
        retain(next, "");
        setNotice(
          "Correction organized. Check the changed reading against the tape.",
        );
        return;
      }
      const parsed = parseMeasurements(input, draft.entries);
      if (clarifying && (parsed.issues.length || !parsed.entries.length))
        throw new Error(
          parsed.issues[0]?.message || "Organize a valid replacement first.",
        );
      if (draft.entries.length + parsed.entries.length > 24)
        throw new Error(
          "Save this batch before adding more measurements (up to 24 per batch).",
        );
      const raw = [draft.raw, input].filter(Boolean).join("\n");
      if (raw.length > 3000)
        throw new Error("Save this batch before adding more dictation.");
      retain(
        {
          ...draft,
          raw,
          entries: [...draft.entries, ...parsed.entries],
          issues: clarifying
            ? draft.issues.filter((_, index) => index !== draft.clarifyingIssue)
            : [...draft.issues, ...parsed.issues],
          clarifyingIssue: null,
          checked: false,
        },
        "",
      );
      setNotice(
        parsed.issues.length
          ? "Organized what was clear. Check the highlighted wording before marking this batch reviewed."
          : "Measurements organized. Check the values against your tape.",
      );
    } catch (e) {
      setError(e.message);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (input.trim())
        throw new Error("Organize the new dictation before saving.");
      if (!draft.entries.length && !draft.issues.length)
        throw new Error("Add measurements first.");
      const value = measurementSet({
        kind: MEASUREMENT_KIND,
        version: 1,
        room: draft.room.trim(),
        floor: draft.floor.trim(),
        side: draft.side,
        enteredAt: draft.enteredAt,
        raw: draft.raw,
        entries: draft.entries,
        issues: draft.issues,
      });
      const text = JSON.stringify(value);
      await onSave(
        {
          jobId: project.id,
          area: `Measurements · ${[value.floor, value.room].filter(Boolean).join(" / ")}`.slice(
            0,
            200,
          ),
          text,
          reviewed: draft.checked && !draft.issues.length,
        },
        draft.editingId,
        draft.base,
      );
      clearDraft(key);
      setDraft({
        ...empty(),
        room: draft.room,
        floor: draft.floor,
        side: draft.side,
      });
      setInput("");
      setNotice(
        "Measurements retained. Check the saved batch's Google/device label below. You can continue in this room or start the next room.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function edit(note, data) {
    if (
      dirty &&
      !window.confirm(
        "Replace the unfinished measurement batch with this saved batch? Download or copy anything you need first.",
      )
    )
      return;
    retain(
      { ...data, checked: false, editingId: note.id, base: note.text },
      "",
    );
  }
  const waitingEdit = records.find((r) => r.note.id === draft.editingId);
  const stale =
    !!draft.editingId && (!waitingEdit || waitingEdit.note.text !== draft.base);
  function exportReport() {
    const text = [
      project.title,
      `Site: ${[project.address, project.city].filter(Boolean).join(", ") || "Not recorded"}`,
      `Exported: ${new Date().toISOString()}`,
      "",
      ...records.flatMap(({ note }) => [
        measurementText(note),
        `${note.reviewed ? "Checked by provider" : "Needs provider review"}${note.pendingBookId ? " · waiting for Google" : ""}`,
        "",
      ]),
    ].join("\n");
    download(
      new Blob([text], { type: "text/plain" }),
      "streamlion-measurements.txt",
    );
  }
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Measurements</h1>
          <p>{project.title} · Record exact readings, one room at a time.</p>
        </div>
      </header>
      <section
        className="intake-panel measurement-guide"
        aria-label="How to dictate measurements"
      >
        <SectionHeading icon={Mic} tone="violet">
          Speak your readings. StreamLion organizes them.
        </SectionHeading>
        <ol>
          <li>Choose the room or exterior area below.</li>
          <li>
            Tap the <strong>Dictate or type measurements</strong> box, then tap
            the <strong>microphone on your device's keyboard</strong>. You can
            also type. On a computer, use your system's dictation shortcut.
          </li>
          <li>
            Say the measurement name and units: “Length twelve feet four and
            three eighths inches. Width ten feet six inches. Ceiling eight feet
            nine inches.”
          </li>
          <li>
            Finish dictating, tap <strong>Organize measurements</strong>, then
            check the cleaned-up readings against your tape.
          </li>
        </ol>
        <p className="hint">
          StreamLion groups and formats your readings when you tap Organize.
          Fractions are kept exactly. Voice typing and its offline support
          depend on your device; typing and organizing work offline.
        </p>
      </section>
      <details className="scope">
        <summary>Job requirements</summary>
        <p>{project.scope || "Scope not recorded."}</p>
        <p>
          Requested outputs:{" "}
          {project.deliverables || "Confirm with the customer."}
        </p>
        <p>
          Exclusions:{" "}
          {project.exclusions ||
            "None recorded. Do not assume a room is excluded."}
        </p>
      </details>
      {invalid && (
        <p className="error" role="alert">
          {invalid} The original remains in Field notes; no record was
          overwritten.
        </p>
      )}
      <section className="editor" aria-label="Measurement batch">
        <SectionHeading icon={Ruler} tone="blue">
          Capture a measurement batch
        </SectionHeading>
        <div className="measurement-room">
          <label>
            Room or exterior area
            <input
              list="measurement-rooms"
              value={draft.room}
              maxLength={100}
              disabled={locked || dirty}
              onChange={(e) => retain({ ...draft, room: e.target.value })}
              placeholder="Office 2 / Front facade"
            />
          </label>
          <datalist id="measurement-rooms">
            {rooms.map((room) => (
              <option key={room} value={room} />
            ))}
          </datalist>
          <label>
            Floor or level (optional)
            <input
              value={draft.floor}
              maxLength={100}
              disabled={locked || dirty}
              onChange={(e) => retain({ ...draft, floor: e.target.value })}
              placeholder="Ground floor"
            />
          </label>
          <label>
            Area type
            <select
              value={draft.side}
              disabled={locked || dirty}
              onChange={(e) => retain({ ...draft, side: e.target.value })}
            >
              <option>Interior</option>
              <option>Exterior</option>
            </select>
          </label>
        </div>
        {dirty && (
          <p className="hint">
            This batch stays attached to {draft.room}. Save it before changing
            rooms.
          </p>
        )}
        <label>
          Dictate or type measurements
          <textarea
            value={input}
            disabled={locked || !draft.room.trim()}
            maxLength={3000}
            rows={4}
            onChange={(e) =>
              retain({ ...draft, checked: false }, e.target.value)
            }
            placeholder="Length 12 feet 4 3/8 inches. Width 10 feet 6 inches. Ceiling 8 feet 9 inches to underside of beam."
          />
        </label>
        {draft.clarifyingIssue != null && (
          <p className="hint">
            The unclear original stays flagged until a valid replacement is
            organized.
          </p>
        )}
        <div className="actions">
          <button
            className="primary"
            disabled={locked || !input.trim() || !draft.room.trim()}
            onClick={organize}
          >
            Organize measurements
          </button>
          <button
            disabled={locked || !draft.entries.length}
            onClick={() =>
              retain({
                ...draft,
                entries: draft.entries.slice(0, -1),
                checked: false,
              })
            }
          >
            Undo last unsaved entry
          </button>
        </div>
        <details className="quiet-details">
          <summary>More ways to describe a reading</summary>
          <p>
            Use Length, Width, Ceiling, Height, Depth, Diagonal, or Segment.
            Include units with every reading: feet/inches, mm, cm, or m. Add
            descriptions after “from”, “to”, “along”, or in parentheses. Say
            “Continuing six feet eight inches” to connect to the previous
            reading in this batch. Connected totals describe a measured run;
            they do not establish floor area or a floor plan.
          </p>
        </details>
        <h2>
          Organized readings{" "}
          <span className="count">{draft.entries.length}</span>
        </h2>
        <ul className="measurement-list">
          {draft.entries.map((entry, i) => (
            <li key={entry.id}>
              <strong>
                {entry.label}: {entry.display}
              </strong>
              {entry.detail && <span>{entry.detail}</span>}
              {entry.continues && <small>Continues previous segment</small>}
              <details>
                <summary>Original / correct this reading</summary>
                <p>{entry.raw}</p>
                <button
                  disabled={locked}
                  onClick={() => {
                    const replacement = window.prompt(
                      "Enter this reading with its name and exact units",
                      entry.raw,
                    );
                    if (replacement === null) return;
                    try {
                      const parsed = parseMeasurements(
                        replacement,
                        draft.entries.slice(0, i),
                      );
                      if (parsed.issues.length || parsed.entries.length !== 1)
                        throw new Error(
                          parsed.issues[0]?.message ||
                            "Enter one measurement at a time.",
                        );
                      const entries = draft.entries.map((e, index) =>
                        index === i
                          ? { ...parsed.entries[0], id: entry.id }
                          : e,
                      );
                      const next = {
                        ...draft,
                        kind: MEASUREMENT_KIND,
                        version: 1,
                        entries,
                        raw: `${draft.raw}\nCorrection: ${replacement}`,
                        checked: false,
                      };
                      measurementSet(next);
                      retain(next);
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  Correct reading
                </button>
              </details>
            </li>
          ))}
        </ul>
        {connectedTotals(draft.entries).map((total) => (
          <p key={total}>{total}</p>
        ))}
        {draft.issues.map((issue, i) => (
          <div className="measurement-issue" key={i}>
            <strong>Needs clarification</strong>
            <p>{issue.raw}</p>
            <p>{issue.message}</p>
            <button
              disabled={locked}
              onClick={() => {
                if (input.trim()) {
                  setError("Organize your current dictation first.");
                  return;
                }
                retain(
                  {
                    ...draft,
                    clarifyingIssue: i,
                    checked: false,
                  },
                  issue.raw,
                );
              }}
            >
              Correct this wording
            </button>
          </div>
        ))}
        <label className="measurement-check">
          <input
            type="checkbox"
            checked={draft.checked}
            disabled={
              locked ||
              !!draft.issues.length ||
              !draft.entries.length ||
              !!input.trim()
            }
            onChange={(e) => retain({ ...draft, checked: e.target.checked })}
          />
          I checked these readings against the tape.
        </label>
        <div className="actions">
          <button
            disabled={locked || stale || !dirty || !!input.trim()}
            className="primary"
            onClick={save}
          >
            {busy
              ? "Saving…"
              : draft.checked
                ? "Save reviewed measurements"
                : "Save unreviewed measurements"}
          </button>
          <button
            disabled={locked || dirty}
            onClick={() =>
              retain({ ...empty(), floor: draft.floor, side: draft.side }, "")
            }
          >
            Start next room
          </button>
        </div>
        {stale && (
          <p className="error" role="alert">
            The saved batch changed. Your draft is kept; reopen the latest batch
            and review before correcting it.
          </p>
        )}
        {draft.editingId && (
          <p className="hint">
            Correcting a saved batch. Earlier wording remains in its history.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="note-list" aria-label="Saved measurement batches">
        <div className="actions">
          <SectionHeading icon={Layers}>
            Saved rooms and measurements
          </SectionHeading>
          <button disabled={!records.length} onClick={exportReport}>
            Download measurement report
          </button>
          <button disabled={!records.length} onClick={() => window.print()}>
            Print / save as PDF
          </button>
        </div>
        <p className="hint">
          Each saved batch shows whether you checked it and where it is stored.
          Save multiple batches for the same room when needed.
        </p>
        {!records.length && (
          <p>Saved measurements for this project will appear here.</p>
        )}
        {records.map(({ note, data }) => (
          <article className="note measurement-saved" key={note.id}>
            <h3>{[data.floor, data.room].filter(Boolean).join(" / ")}</h3>
            <p>
              {data.side} · {new Date(data.enteredAt).toLocaleDateString()} ·{" "}
              {note.reviewed ? "Checked by provider" : "Needs review"}
            </p>
            <p className="waiting-label">
              {note.pendingBookId
                ? "Saved on this device · waiting for Google"
                : project.deviceOnly
                  ? "Saved on this device"
                  : "Saved in Google"}
            </p>
            <pre className="note-text">{measurementText(note)}</pre>
            <button disabled={locked} onClick={() => edit(note, data)}>
              Correct saved batch
            </button>
            {note.revisions?.length > 0 && (
              <details>
                <summary>Earlier wording</summary>
                {note.revisions.map((r, i) => (
                  <pre className="note-text" key={i}>
                    {measurementText({ text: r.text })}
                  </pre>
                ))}
              </details>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
