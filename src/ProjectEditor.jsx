import { useState } from "react";
import {
  PROJECT_FIELDS,
  GROUPS,
  validateFields,
  parseIntake,
  legacyFields,
  intakeFor,
} from "./project-schema";
import { readDraft, writeDraft, clearDraft } from "./drafts";
import { download } from "./storage";
export default function ProjectEditor({
  project,
  onSave,
  onCancel,
  draftScope = "local",
}) {
  const key = `${draftScope}:project:${project?.id || "new"}`;
  const initial = project
    ? legacyFields(project)
    : Object.fromEntries(PROJECT_FIELDS.map((f) => [f.key, ""]));
  const cached = readDraft(key);
  const baseline = JSON.stringify(initial);
  const [draftBase, setDraftBase] = useState(cached?.base || baseline);
  const [stale, setStale] = useState(
    !!cached?.base && cached.base !== baseline,
  );
  const [fields, setFields] = useState(() => cached?.fields || initial);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [json, setJson] = useState(""),
    [reviewed, setReviewed] = useState(false);
  function update(next) {
    setFields(next);
    setReviewed(false);
    try {
      writeDraft(key, { fields: next, base: draftBase });
      setError("");
    } catch {
      setError(
        "Draft could not be saved on this device. Export JSON before leaving.",
      );
    }
  }
  function importText(text) {
    try {
      update(parseIntake(text));
      setJson("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function save(e) {
    e.preventDefault();
    if (stale) {
      setError(
        "Google changed since this draft began. Export your draft, then load current values before applying changes.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(validateFields(fields), project, reviewed);
      clearDraft(key);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="project-editor">
      <header className="page-head">
        <div>
          <h1>{project ? "Edit project" : "Create project"}</h1>
          <p>Review the details once. Keep every visit prepared.</p>
        </div>
        <button disabled={busy} onClick={onCancel}>
          Back to projects
        </button>
      </header>
      <details className="intake-panel" open={!project}>
        <summary>Prefill from ChatGPT</summary>
        <p>
          Upload specifications in ChatGPT with StreamLion. Paste its project
          JSON here, or open the project after the plugin saves it to your
          connected workbook.
        </p>
        <label>
          Project JSON
          <textarea
            disabled={busy}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            placeholder='{"schemaVersion":1,"kind":"streamlion.project","fields":{…}}'
            rows={3}
          />
        </label>
        <div className="actions">
          <button
            type="button"
            disabled={busy || !json.trim()}
            onClick={() => importText(json)}
          >
            Review prefilled details
          </button>
          <label className="file-label">
            Import JSON file
            <input
              type="file"
              disabled={busy}
              accept=".json,application/json"
              onChange={async (e) => {
                const file = e.target.files[0];
                if (file) {
                  if (file.size > 150000) {
                    setError("File is too large.");
                    return;
                  }
                  importText(await file.text());
                }
              }}
            />
          </label>
        </div>
        <p className="hint">
          Import replaces this draft. Existing Google records change only after
          you save.
        </p>
      </details>
      {stale && (
        <section className="error">
          <p>
            This draft was started from an older record. Export it before
            loading current values.
          </p>
          <button
            onClick={() => {
              setFields(initial);
              setStale(false);
              setDraftBase(baseline);
              clearDraft(key);
              setReviewed(false);
            }}
          >
            Load current record
          </button>
        </section>
      )}
      <form onSubmit={save}>
        <div className="project-sections">
          {GROUPS.map((group) => (
            <fieldset key={group} disabled={busy}>
              <legend>{group}</legend>
              <div className="form-row">
                {PROJECT_FIELDS.filter((f) => f.group === group).map((f) => (
                  <label
                    key={f.key}
                    className={f.type === "textarea" ? "wide" : ""}
                  >
                    {f.label}
                    {f.type === "textarea" ? (
                      <textarea
                        value={fields[f.key]}
                        rows={3}
                        onChange={(e) =>
                          update({ ...fields, [f.key]: e.target.value })
                        }
                      />
                    ) : f.type === "appointment" ? (
                      <select
                        value={fields[f.key]}
                        onChange={(e) =>
                          update({ ...fields, [f.key]: e.target.value })
                        }
                      >
                        <option value="">Unknown</option>
                        <option value="proposed">Proposed</option>
                        <option value="confirmed">Confirmed</option>
                      </select>
                    ) : (
                      <input
                        type={
                          ["money", "number"].includes(f.type) ? "text" : f.type
                        }
                        inputMode={
                          ["money", "number"].includes(f.type)
                            ? "decimal"
                            : undefined
                        }
                        value={fields[f.key]}
                        required={f.key === "title"}
                        onChange={(e) =>
                          update({ ...fields, [f.key]: e.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            disabled={busy}
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
          />
          I reviewed these details against the sources
        </label>
        <p className="hint">
          Blank means unknown. Offered fees, invoices and payments are separate.
          Estimated hours do not establish an end appointment.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions sticky-actions">
          <button className="primary" disabled={busy}>
            {busy
              ? "Saving…"
              : reviewed
                ? "Save reviewed project"
                : "Save draft project"}
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                download(
                  new Blob([JSON.stringify(intakeFor(fields), null, 2)], {
                    type: "application/json",
                  }),
                  "streamlion-project.json",
                );
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Export project JSON
          </button>
        </div>
      </form>
    </section>
  );
}
