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
import { readDraft, writeDraft, clearDraft, projectDraftKey } from "./drafts";
import { download } from "./storage";
import { ChatGPTLaunch } from "./ChatGPTPanel";
import { reusableFields } from "./workflow";
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
  draftId,
  onSave,
  onCancel,
  onConnectGoogle,
  onRefreshProjects,
  bookId,
  googleReady = false,
  draftScope = "local",
  savedStep = null,
  savedNotice = "",
  templates = [],
}) {
  const key = projectDraftKey(draftScope, project?.id || draftId || "new");
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
    savedStep ??
    (project || Object.values(cached?.fields || {}).some(Boolean) ? 1 : 0);
  const [step, setStep] = useState(firstStep);
  const [furthest, setFurthest] = useState(
    project ? STEPS.length - 1 : firstStep,
  );
  const [error, setError] = useState("");
  const [saveNotice, setSaveNotice] = useState(savedNotice);
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
    setSaveNotice("");
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

  async function save(asReviewed) {
    if (stale) {
      setError(
        "This project changed in Google. Download your draft, then load the current record before saving.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const savedFields = validateFields(fields);
      await onSave(savedFields, project, asReviewed, draftId, draftScope, step);
      clearDraft(key);
      if (!asReviewed) {
        setDraftBase(JSON.stringify(savedFields));
        setSaveNotice(
          bookId
            ? "Draft saved in Google. Keep editing, or return to Projects when ready."
            : "Draft saved on this device. Keep editing, or return to Projects when ready.",
        );
      }
    } catch (exception) {
      setError(exception.message);
      if (!fields.title.trim()) goTo(1);
      else window.scrollTo?.({ top: 0, behavior: "smooth" });
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
    <section
      className={`project-editor wizard ${step === 0 && !fields.title.trim() ? "wizard-starting" : ""}`}
    >
      <header className="page-head">
        <div>
          <h1 title="Create a project from a brief or enter the details yourself.">
            {project ? "Edit project" : "Create project"}
          </h1>
          <p>One step at a time. You can leave unknown details blank.</p>
        </div>
        <div className="editor-header-actions">
          {bookId && !googleReady && (
            <button type="button" disabled={busy} onClick={onConnectGoogle}>
              Reconnect Google
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={
              busy || stale || !fields.title.trim() || (bookId && !googleReady)
            }
            onClick={() => save(false)}
            title={
              bookId
                ? "Save this draft to your selected Google workbook."
                : "Save this draft on this device."
            }
          >
            {busy
              ? "Saving…"
              : bookId
                ? "Save draft to Google"
                : "Save draft on device"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            title="Return to your project list. Your changes stay on this device."
          >
            Back to projects
          </button>
        </div>
      </header>
      {!bookId && step > 0 && (
        <p className="hint editor-save-location" role="status">
          No Google workbook is selected. Saving a draft here keeps it on this
          device. Connect Google to save it in your workbook.
        </p>
      )}
      {bookId && !googleReady && (
        <p className="hint editor-save-location" role="status">
          Your Google workbook is selected, but your connection needs to be
          renewed before you can save to it. Your edits remain on this device.
        </p>
      )}
      {error && (
        <p role="alert" className="error editor-save-error">
          {error}
        </p>
      )}
      {saveNotice && (
        <p role="status" className="hint editor-save-location">
          {saveNotice}
        </p>
      )}

      <nav
        ref={progressRef}
        className={`wizard-progress ${step === 0 ? "at-start" : ""}`}
        aria-label="Project creation steps"
      >
        <ol>
          {STEPS.map((item, index) => (
            <li key={item.label}>
              <button
                type="button"
                className={
                  index === step
                    ? "current"
                    : index <= furthest
                      ? "visited"
                      : ""
                }
                disabled={busy}
                onClick={() => goTo(index)}
                aria-current={index === step ? "step" : undefined}
                aria-label={`Step ${index + 1}: ${item.title}`}
                title={`Step ${index + 1}: ${item.title}`}
              >
                <span className="step-number">{index + 1}</span>
                <span className="step-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step > 0 && (
        <label className="mobile-section-picker">
          Go to section
          <select
            value={step}
            disabled={busy}
            onChange={(event) => goTo(Number(event.target.value))}
          >
            {STEPS.map((item, index) => (
              <option key={item.label} value={index}>
                {index + 1}. {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <form onSubmit={(event) => event.preventDefault()}>
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
                    : "Choose a brief or start with the basics. You can add the other details later."
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
                Start from a brief or enter only what you know. You can save as
                soon as the project has a name.
              </p>
              <div className="intake-choices">
                <section>
                  <MessageCircle size={28} aria-hidden="true" />
                  <h3>I have a brief</h3>
                  <p>
                    Use your own ChatGPT to read the PDF or messages. Bring its
                    project file back here to review.
                  </p>
                  <ChatGPTLaunch mode="create" />
                </section>
                <section>
                  <FileText size={28} aria-hidden="true" />
                  <h3>I'll add the basics</h3>
                  <p>
                    Start with a name, site, and visit. The other sections can
                    wait until you need them.
                  </p>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => goTo(1)}
                    title="Start filling in the project details yourself."
                  >
                    Enter details myself
                  </button>
                </section>
              </div>
              {templates.length > 0 && (
                <label>
                  Start with an approved client checklist
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "") return;
                      const index = Number(value);
                      if (!Number.isInteger(index) || index < 0) return;
                      const template = templates[index];
                      if (template) {
                        update({
                          ...fields,
                          ...reusableFields(template.project, true),
                          ...(template.plan?.requirements.length
                            ? {
                                deliverables: template.plan.requirements
                                  .map((item) => item.label)
                                  .join("\n"),
                              }
                            : {}),
                          sourceNotes: `Provider-approved client defaults from ${template.project.title}. Review against the current brief.`,
                        });
                        goTo(1);
                      }
                    }}
                  >
                    <option value="">Choose a client (optional)</option>
                    {templates.map((template, index) => (
                      <option key={template.project.id} value={index}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <section
                className="workbook-guide"
                aria-label="Where this project is saved"
              >
                <h3>Save destination</h3>
                {bookId && googleReady ? (
                  <p>
                    Your Google workbook is connected.{" "}
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${bookId}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open workbook ↗
                    </a>
                  </p>
                ) : bookId ? (
                  <p>
                    Your workbook is selected on this device, but Google is not
                    connected right now.{" "}
                    <button type="button" onClick={onConnectGoogle}>
                      Reconnect Google to save
                    </button>
                  </p>
                ) : (
                  <p>
                    This draft stays on this device.{" "}
                    <button type="button" onClick={onConnectGoogle}>
                      Connect Google and choose a workbook
                    </button>
                  </p>
                )}
                <p className="hint">
                  ChatGPT prepares a file. You review it here, then StreamLion
                  saves it to the destination above.
                </p>
              </section>
              <details className="quiet-details import-details">
                <summary title="Use this if the chat gives you project details to paste or download.">
                  Bring back the ChatGPT project file
                </summary>
                <p>
                  Attach your brief in the ChatGPT conversation opened above.
                  Ask for the project file, then choose it here. Review the
                  imported details before saving.
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
                type="button"
                className="primary"
                disabled={
                  busy || stale || !reviewed || (bookId && !googleReady)
                }
                onClick={() => save(true)}
                title="Save the project after checking its details against the source documents."
              >
                {busy ? "Saving…" : "Save reviewed project"}
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
