import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  MessageCircle,
  Upload,
} from "lucide-react";
import {
  PROJECT_FIELDS,
  validateFields,
  parseIntake,
  legacyFields,
  intakeFor,
} from "./project-schema";
import { readDraft, writeDraft, clearDraft } from "./drafts";
import { download } from "./storage";
import { ChatGPTLaunch } from "./ChatGPTPanel";
import HelpTip, { FIELD_HELP, GROUP_HELP } from "./FieldHelp";

const STEPS = [
  { label: "Start", group: null, title: "Start with your project brief" },
  { label: "Project", group: "Project", title: "Identify the project" },
  { label: "Location", group: "Location", title: "Where is the site?" },
  { label: "People", group: "Contacts", title: "Who is involved?" },
  { label: "Visit", group: "Schedule", title: "When is the visit?" },
  { label: "Work", group: "Scope", title: "What needs to be captured?" },
  { label: "Payment", group: "Money", title: "What are the payment details?" },
  { label: "Files", group: "Documents", title: "Which files are needed?" },
  { label: "Finish", group: "Review", title: "Review and save" },
];

export default function ProjectEditor({
  project,
  onSave,
  onCancel,
  onRefreshProjects,
  bookId,
  draftScope = "local",
}) {
  const key = `${draftScope}:project:${project?.id || "new"}`;
  const initial = project
    ? legacyFields(project)
    : Object.fromEntries(PROJECT_FIELDS.map((field) => [field.key, ""]));
  const cached = readDraft(key);
  const baseline = JSON.stringify(initial);
  const [draftBase, setDraftBase] = useState(cached?.base || baseline);
  const [stale, setStale] = useState(
    !!cached?.base && cached.base !== baseline,
  );
  const [fields, setFields] = useState(() => cached?.fields || initial);
  const firstStep =
    project || Object.values(cached?.fields || {}).some(Boolean) ? 1 : 0;
  const [step, setStep] = useState(firstStep);
  const [furthest, setFurthest] = useState(
    project ? STEPS.length - 1 : firstStep,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [json, setJson] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const progressRef = useRef(null);
  const current = STEPS[step];

  useEffect(() => {
    const rail = progressRef.current;
    const activeStep = rail?.querySelector('[aria-current="step"]');
    if (!rail || !activeStep || !rail.scrollTo) return;
    const railBox = rail.getBoundingClientRect();
    const buttonBox = activeStep.getBoundingClientRect();
    rail.scrollTo({
      left:
        rail.scrollLeft +
        buttonBox.left -
        railBox.left +
        buttonBox.width / 2 -
        railBox.width / 2,
      behavior: "smooth",
    });
  }, [step]);

  function goTo(next) {
    const target = Math.max(0, Math.min(STEPS.length - 1, next));
    setStep(target);
    setFurthest((value) => Math.max(value, target));
    try {
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch {
      // A browser without smooth scrolling still gets the next step.
    }
  }

  function update(next) {
    setFields(next);
    setReviewed(false);
    try {
      writeDraft(key, { fields: next, base: draftBase });
      setError("");
    } catch {
      setError(
        "This device could not keep the draft. Download a backup before leaving.",
      );
    }
  }

  function importText(text) {
    try {
      update(parseIntake(text));
      setJson("");
      setImportStatus("Details added. Review each step before saving.");
      goTo(1);
    } catch (exception) {
      setError(exception.message);
    }
  }

  async function save(event) {
    event.preventDefault();
    if (stale) {
      setError(
        "This project changed in Google. Download your draft, then load the current record before saving.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave(validateFields(fields), project, reviewed);
      clearDraft(key);
    } catch (exception) {
      setError(exception.message);
      if (!fields.title.trim()) goTo(1);
    } finally {
      setBusy(false);
    }
  }

  function exportDraft() {
    try {
      download(
        new Blob([JSON.stringify(intakeFor(fields), null, 2)], {
          type: "application/json",
        }),
        "streamlion-project.json",
      );
    } catch (exception) {
      setError(exception.message);
    }
  }

  return (
    <section className="project-editor wizard">
      <header className="page-head">
        <div>
          <h1 title="Create a project from a brief or enter the details yourself.">
            {project ? "Edit project" : "Create project"}
          </h1>
          <p>One step at a time. You can leave unknown details blank.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          title="Return to your project list. Your changes stay on this device."
        >
          Back to projects
        </button>
      </header>

      <nav
        ref={progressRef}
        className="wizard-progress"
        aria-label="Project creation steps"
      >
        <ol>
          {STEPS.map((item, index) => (
            <li key={item.label}>
              <button
                type="button"
                className={
                  index === step ? "current" : index < step ? "visited" : ""
                }
                disabled={busy || index > furthest}
                onClick={() => goTo(index)}
                aria-current={index === step ? "step" : undefined}
                title={`Step ${index + 1}: ${item.title}`}
              >
                <span className="step-number">{index + 1}</span>
                <span className="step-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <form onSubmit={save}>
        <div className="wizard-body">
          <div className="wizard-heading">
            <span className="wizard-eyebrow">
              Step {step + 1} of {STEPS.length}
            </span>
            <div className="heading-with-help">
              <h2>{current.title}</h2>
              <HelpTip
                label={current.title}
                text={
                  current.group
                    ? GROUP_HELP[current.group]
                    : "Start in ChatGPT with your brief, emails, or PDF. StreamLion helps prepare the details for review."
                }
              />
            </div>
            {step > 0 && (
              <p>
                {GROUP_HELP[current.group]} Leave anything you do not know
                blank.
              </p>
            )}
          </div>

          {step === 0 ? (
            <div className="wizard-start">
              <p className="wizard-intro">
                Have a PDF, email thread, or written brief? Let StreamLion
                prepare the details first.
              </p>
              <ol className="starter-steps">
                <li>
                  <span className="starter-icon">
                    <MessageCircle size={22} />
                  </span>
                  <span>
                    <strong>Open StreamLion chat</strong>
                    <small>Start with a message ready to edit.</small>
                  </span>
                </li>
                <li>
                  <span className="starter-icon">
                    <Upload size={22} />
                  </span>
                  <span>
                    <strong>Attach a file or paste the text</strong>
                    <small>
                      Add your brief or messages in ChatGPT and check the
                      details it finds.
                    </small>
                  </span>
                </li>
                <li>
                  <span className="starter-icon">
                    <FileText size={22} />
                  </span>
                  <span>
                    <strong>Come back to your project</strong>
                    <small>
                      Open the saved project here, or review the details before
                      saving.
                    </small>
                  </span>
                </li>
              </ol>
              <div className="actions start-actions">
                <ChatGPTLaunch mode="create" bookId={bookId} />
                <button
                  type="button"
                  onClick={() => goTo(1)}
                  title="Start filling in the project details yourself."
                >
                  Enter details myself
                </button>
              </div>
              {bookId && (
                <button
                  type="button"
                  className="text-action"
                  onClick={onRefreshProjects}
                  title="Find projects StreamLion saved to your connected Google workbook."
                >
                  Already saved in Google? Show my projects{" "}
                  <ArrowRight size={16} />
                </button>
              )}
              <details className="quiet-details import-details">
                <summary title="Use this if the chat gives you project details to paste or download.">
                  Have details from chat already?
                </summary>
                <p>
                  If StreamLion could not save directly to Google, ask it for a
                  StreamLion project file. Paste its contents or choose the file
                  here.
                </p>
                <label htmlFor="project-import">Paste project details</label>
                <textarea
                  id="project-import"
                  disabled={busy}
                  value={json}
                  onChange={(event) => setJson(event.target.value)}
                  rows={4}
                />
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy || !json.trim()}
                    onClick={() => importText(json)}
                    title="Fill the project fields from the pasted details."
                  >
                    Use these details
                  </button>
                  <label className="file-label">
                    Choose project file
                    <input
                      type="file"
                      disabled={busy}
                      accept=".json,application/json"
                      onChange={async (event) => {
                        const file = event.target.files[0];
                        if (!file) return;
                        if (file.size > 150000)
                          return setError(
                            "That file is too large. Choose one project file.",
                          );
                        importText(await file.text());
                      }}
                    />
                  </label>
                </div>
              </details>
            </div>
          ) : (
            <fieldset className="wizard-fields" disabled={busy}>
              <legend className="sr-only">{current.group}</legend>
              <div className="form-row">
                {PROJECT_FIELDS.filter(
                  (field) => field.group === current.group,
                ).map((field) => {
                  const id = `project-${field.key}`;
                  return (
                    <div
                      key={field.key}
                      className={`field ${field.type === "textarea" ? "wide" : ""}`}
                    >
                      <div className="field-title">
                        <label htmlFor={id}>{field.label}</label>
                        <HelpTip
                          label={field.label}
                          text={FIELD_HELP[field.key]}
                        />
                      </div>
                      {field.type === "textarea" ? (
                        <textarea
                          id={id}
                          value={fields[field.key]}
                          rows={3}
                          onChange={(event) =>
                            update({
                              ...fields,
                              [field.key]: event.target.value,
                            })
                          }
                        />
                      ) : field.type === "appointment" ? (
                        <select
                          id={id}
                          value={fields[field.key]}
                          onChange={(event) =>
                            update({
                              ...fields,
                              [field.key]: event.target.value,
                            })
                          }
                        >
                          <option value="">Unknown</option>
                          <option value="proposed">Proposed</option>
                          <option value="confirmed">Confirmed</option>
                        </select>
                      ) : (
                        <input
                          id={id}
                          type={
                            ["money", "number"].includes(field.type)
                              ? "text"
                              : field.type
                          }
                          inputMode={
                            ["money", "number"].includes(field.type)
                              ? "decimal"
                              : undefined
                          }
                          value={fields[field.key]}
                          required={field.key === "title"}
                          onChange={(event) =>
                            update({
                              ...fields,
                              [field.key]: event.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {step === STEPS.length - 1 && (
            <div className="finish-review">
              <label className="check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                I checked these details against the source documents
              </label>
              <p className="hint">
                Quoted fees, invoices, and payments are separate. An estimate
                does not confirm an end time.
              </p>
              <details className="quiet-details">
                <summary title="Download a copy of the details entered so far.">
                  Need a backup?
                </summary>
                <button type="button" onClick={exportDraft}>
                  Download project details
                </button>
              </details>
            </div>
          )}

          {stale && (
            <section className="error">
              <p>
                This draft was started from an older record. Download it before
                loading current values.
              </p>
              <button
                type="button"
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
          {importStatus && step > 0 && (
            <p role="status" className="import-status">
              {importStatus}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>

        {step > 0 && (
          <div className="wizard-footer">
            <button
              type="button"
              disabled={busy}
              onClick={() => goTo(step - 1)}
              title="Go to the previous step. Your entries are kept."
            >
              <ArrowLeft size={16} /> Back
            </button>
            <span>
              Step {step + 1} of {STEPS.length}
            </span>
            {step === STEPS.length - 1 ? (
              <button
                className="primary"
                disabled={busy || stale}
                title="Save this project to your current workspace."
              >
                {busy
                  ? "Saving…"
                  : reviewed
                    ? "Save reviewed project"
                    : "Save draft project"}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => goTo(step + 1)}
                title="Go to the next step. Unknown fields may be left blank."
              >
                Continue <ArrowRight size={16} />
              </button>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
