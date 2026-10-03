import { useRef, useState } from "react";
import {
  EXCEPTION_TYPES,
  emptyException,
  exceptionText,
  attachException,
} from "./site-exceptions.js";

export default function SiteException({
  project,
  plan,
  onChange,
  onRecorded,
  onSaveRecord,
  onNotes,
  onBusy,
  disabled,
}) {
  const draft = plan.exceptionDraft || emptyException;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [savedArea, setSavedArea] = useState("");
  const running = useRef(false);
  function edit(values) {
    onChange({ ...draft, ...values, checked: false, recordId: undefined });
    setSavedArea("");
  }
  async function save() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      const text = exceptionText(draft);
      // Preflight linking before creating a durable note. The original record
      // and the checklist use the same identity, including when Google is offline.
      attachException(plan, draft, "preflight");
      const reserved = draft.recordId || crypto.randomUUID();
      if (onChange({ ...draft, recordId: reserved }) === false)
        throw new Error(
          "This device could not keep the save identity. Copy the wording before retrying.",
        );
      const id = await onSaveRecord(
        { jobId: project.id, area: draft.area.trim(), text, reviewed: true },
        undefined,
        reserved,
      );
      if (typeof id !== "string" || !/^[\w-]{1,100}$/.test(id))
        throw new Error(
          "The field record could not be confirmed. Keep this wording and check Field notes before retrying.",
        );
      onRecorded(attachException(plan, draft, id));
      setSavedArea(draft.area.trim());
    } catch (e) {
      setError(e.message);
    } finally {
      running.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <details
      className="site-exception"
      open={!!plan.exceptionDraft || !!savedArea}
    >
      <summary>Record a site exception</summary>
      <p>
        Keep an access problem or changed request with its area, evidence, and
        next action.
      </p>
      <div className="task-review-fields">
        <label>
          What kind of exception?
          <select
            value={draft.type}
            onChange={(e) => edit({ type: e.target.value })}
          >
            {EXCEPTION_TYPES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Related requirement
          <select
            value={draft.taskId}
            onChange={(e) => {
              const item = plan.requirements.find(
                (row) => row.id === e.target.value,
              );
              edit({ taskId: e.target.value, area: item?.area || draft.area });
            }}
          >
            <option value="">General site record</option>
            {plan.requirements.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Exception area
          <input
            value={draft.area}
            maxLength={200}
            placeholder="e.g. Second floor / locked office"
            onChange={(e) => edit({ area: e.target.value })}
          />
        </label>
      </div>
      <label>
        What happened?
        <textarea
          value={draft.detail}
          maxLength={700}
          placeholder="State the request or condition exactly."
          onChange={(e) => edit({ detail: e.target.value })}
        />
      </label>
      <label>
        Next action
        <input
          value={draft.nextAction}
          maxLength={300}
          placeholder="e.g. Client to arrange access before a return visit"
          onChange={(e) => edit({ nextAction: e.target.value })}
        />
      </label>
      <label>
        Instruction / information from (optional)
        <input
          value={draft.reportedBy}
          maxLength={200}
          placeholder="Name and role, if provided"
          onChange={(e) => edit({ reportedBy: e.target.value })}
        />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.checked}
          onChange={(e) => onChange({ ...draft, checked: e.target.checked })}
        />
        I checked this wording against what happened.
      </label>
      <div className="actions">
        <button
          className="primary"
          disabled={
            busy ||
            disabled ||
            !draft.checked ||
            !draft.area.trim() ||
            !draft.detail.trim() ||
            !draft.nextAction.trim()
          }
          onClick={save}
        >
          {busy ? "Keeping record…" : "Save site exception"}
        </button>
        {plan.exceptionDraft && (
          <button
            className="text-action"
            disabled={busy}
            onClick={() => {
              onChange(undefined);
              setError("");
            }}
          >
            Clear exception draft
          </button>
        )}
      </div>
      {savedArea && (
        <div role="status" className="success">
          <p>
            Field record kept. Save the checklist to confirm its linked
            requirement. Google uploads, if needed, appear in the send queue.
          </p>
          <button onClick={() => onNotes(savedArea)}>
            Add a photo or voice memo in {savedArea}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </details>
  );
}
