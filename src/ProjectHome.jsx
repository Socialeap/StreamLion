import ProjectFolderButton from "./ProjectFolderButton.jsx";
import ProjectVoiceAnswers from "./ProjectVoiceAnswers.jsx";
import BriefTaskBuilder from "./BriefTaskBuilder.jsx";
import SiteException from "./SiteException.jsx";
import { useEffect, useRef, useState } from "react";
import {
  MapPin,
  Phone,
  Check,
  ArrowRight,
  CalendarDays,
  KeyRound,
  ClipboardCheck,
  LogOut,
  Send,
  WifiOff,
} from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import { readDraft, writeDraft, clearDraft } from "./drafts";
import { download } from "./storage";
import {
  readWorkflow,
  workflowNote,
  WORKFLOW_AREA,
  validateWorkflow,
  beforeLeaving,
  paymentSummary,
  deliverySummary,
  scopeSignature,
  progressLabel,
  measurementEvidence,
} from "./workflow";
import { measurementText } from "./measurements.js";

const PANELS = ["Prepare", "On site", "Before leaving", "Delivery"];
const PANEL_HELP = [
  "Know where to go, how to enter, and what is required.",
  "Record evidence against the requested work.",
  "Check omissions and access problems before you leave.",
  "Prepare the handover and track delivery, acceptance, and payment separately.",
];
function visitLabel(value) {
  if (!value) return "Appointment not set";
  // Format the recorded wall time without converting it into the device zone.
  const date = new Date(`${value}:00Z`);
  if (!Number.isFinite(date.getTime())) return value.replace("T", " at ");
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function ProjectHome(props) {
  try {
    const initial = readWorkflow(props.notes, props.project);
    return <ProjectHomeContent {...props} initial={initial} />;
  } catch (e) {
    return (
      <section className="editor">
        <h1>{props.project.title}</h1>
        <p role="alert" className="error">
          {e.message}
        </p>
        <button onClick={props.onEdit}>Edit project details</button>
        <button onClick={() => props.onNotes("")}>Open field notes</button>
      </section>
    );
  }
}

function ProjectHomeContent({
  project,
  notes,
  initial,
  onEdit,
  onAsk,
  onMeasurements,
  onBack,
  onNotes,
  onSave,
  onRepeat,
  onFolderBusy,
  onVoiceBusy,
  onOperationBusy,
  onFieldRecord,
  answerSource,
  answerAsOf,
  scope,
  connected,
  siteCopy,
  onSiteCopy,
}) {
  const key = `${scope}:checklist:${project.id}`;
  const savedText = workflowNote(notes, project.id)?.text || "";
  const cached = readDraft(key);
  const [plan, setPlan] = useState(cached?.plan || initial);
  const [base, setBase] = useState(cached?.base ?? savedText);
  const [dirty, setDirty] = useState(!!cached);
  const [panel, setPanel] = useState(() => {
    const currentPlan = cached?.plan || initial;
    return currentPlan.delivery !== "not-sent" ||
      currentPlan.visit === "captured"
      ? 3
      : currentPlan.visit === "in-progress"
        ? 1
        : 0;
  });
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [Report, setReport] = useState(null);
  const reportTrigger = useRef(null);
  const busyFlags = useRef({ work: false, voice: false });
  function markBusy(kind, value) {
    busyFlags.current[kind] = value;
    const active = Object.values(busyFlags.current).some(Boolean);
    setBusy(active);
    (onOperationBusy || onVoiceBusy)?.(active);
  }
  useEffect(() => {
    if (dirty && savedText && savedText === JSON.stringify(plan)) {
      setBase(savedText);
      setDirty(false);
      clearDraft(key);
      setNotice("Checklist save verified.");
    } else if (!dirty && savedText !== base) {
      setPlan(initial);
      setBase(savedText);
    }
  }, [savedText, base, dirty, initial, plan, key]);
  const fieldNotes = notes.filter(
    (note) => note.jobId === project.id && note.area !== WORKFLOW_AREA,
  );
  const stale = savedText !== base && dirty;
  const address = [
    project.address,
    project.address2,
    project.city,
    project.region,
    project.postal,
  ]
    .filter(Boolean)
    .join(", ");
  const checks = beforeLeaving(project, plan, notes);
  const followUpRecorded =
    checks.length > 0 &&
    checks.every(
      (item) => item.state === "blocked" && /\bNext:\s+\S/.test(item.detail),
    );
  const payment = paymentSummary(project);
  const shownRequirements = plan.requirements.filter((item) =>
    panel === 3
      ? item.kind === "delivery"
      : panel === 1
        ? item.kind !== "delivery"
        : true,
  );
  function update(next) {
    setPlan(next);
    setDirty(true);
    setNotice("");
    setAcknowledged(false);
    try {
      writeDraft(key, { plan: next, base });
      setError("");
      return true;
    } catch {
      setError(
        "This device cannot keep your checklist draft. Download a backup before leaving.",
      );
      return false;
    }
  }
  function changeItem(id, values) {
    update({
      ...plan,
      requirements: plan.requirements.map((item) =>
        item.id === id ? { ...item, ...values } : item,
      ),
    });
  }
  async function openReport() {
    markBusy("work", true);
    try {
      const { default: Component } = await import("./HandoverReport.jsx");
      setReport(() => Component);
      setReportOpen(true);
    } catch {
      setError(
        "The handover preview could not load. Try again, or download the text summary.",
      );
    } finally {
      markBusy("work", false);
    }
  }
  async function save() {
    markBusy("work", true);
    setError("");
    try {
      if (stale)
        throw new Error(
          "The checklist changed in Google. Download your draft, then reload the project before saving.",
        );
      const validated = validateWorkflow(plan);
      await onSave(validated, base);
      setBase(JSON.stringify(validated));
      setDirty(false);
      clearDraft(key);
      setNotice(
        project.deviceOnly
          ? "Checklist saved on this device."
          : "Checklist saved and verified in Google.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      markBusy("work", false);
    }
  }
  const checklist = (
    <>
      <div className="section-heading">
        <h3>{panel === 3 ? "Delivery tasks" : "Work checklist"}</h3>
        <span>
          {
            shownRequirements.filter(
              (item) =>
                item.state === "done" &&
                (item.kind !== "measurement" ||
                  !measurementEvidence(item, notes, project.id).issue),
            ).length
          }{" "}
          / {shownRequirements.length} checked
        </span>
      </div>
      {!plan.requirements.length && (
        <p className="empty-inline">
          Build tasks from the brief in Prepare, or add a specific requirement
          below.
        </p>
      )}
      {plan.scopeSignature !== scopeSignature(project) && (
        <div className="error">
          <p>
            The brief changed. Compare the checklist with the requested work
            above.
          </p>
          <button
            onClick={() =>
              update({ ...plan, scopeSignature: scopeSignature(project) })
            }
          >
            I reviewed the changed brief
          </button>
        </div>
      )}
      <div className="requirements">
        {shownRequirements.map((item) => (
          <article key={item.id} className={`requirement ${item.state}`}>
            <div className="requirement-head">
              <strong>{item.label}</strong>
              <select
                aria-label={`Status: ${item.label}`}
                value={item.state}
                onChange={(e) => changeItem(item.id, { state: e.target.value })}
              >
                <option value="todo">To check</option>
                <option value="done">Checked</option>
                <option value="blocked">Blocked</option>
                <option value="not-needed">Not needed</option>
              </select>
            </div>
            {item.source && (
              <details className="requirement-source">
                <summary>Source request</summary>
                <blockquote>
                  <small>
                    {item.source.name}
                    {item.source.page && ` · page ${item.source.page}`}
                  </small>
                  {item.source.quote}
                </blockquote>
              </details>
            )}
            {item.kind === "measurement" &&
              item.state === "done" &&
              measurementEvidence(item, notes, project.id).issue && (
                <p className="waiting-label">
                  {measurementEvidence(item, notes, project.id).issue}
                </p>
              )}
            <details>
              <summary>
                Area, explanation, and evidence
                {item.evidence.length ? ` (${item.evidence.length})` : ""}
              </summary>
              <label>
                Site area
                <input
                  value={item.area}
                  maxLength={200}
                  onChange={(e) =>
                    changeItem(item.id, { area: e.target.value })
                  }
                  placeholder="e.g. Ground floor / plant room"
                />
              </label>
              <label>
                {["blocked", "not-needed"].includes(item.state)
                  ? "Explain why (required)"
                  : "Explanation (optional)"}
                <textarea
                  value={item.reason}
                  maxLength={1000}
                  onChange={(e) =>
                    changeItem(item.id, { reason: e.target.value })
                  }
                />
              </label>
              <fieldset className="evidence-picker">
                <legend>Attach field evidence</legend>
                {!fieldNotes.length && (
                  <p>No field records yet. Add a note, photo, or voice memo.</p>
                )}
                {fieldNotes.map((note) => (
                  <label className="check-label" key={note.id}>
                    <input
                      type="checkbox"
                      checked={item.evidence.includes(note.id)}
                      onChange={(e) =>
                        changeItem(item.id, {
                          evidence: e.target.checked
                            ? [...item.evidence, note.id]
                            : item.evidence.filter((id) => id !== note.id),
                        })
                      }
                    />
                    {note.area} ·{" "}
                    {(measurementText(note) || "Voice memo").slice(0, 80)}
                  </label>
                ))}
              </fieldset>
              <button onClick={() => onNotes(item.area)}>
                Add evidence for this area
              </button>
              <button
                className="text-action"
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove this requirement from the working checklist? Its field records stay in the project.",
                    )
                  )
                    update({
                      ...plan,
                      requirements: plan.requirements.filter(
                        (row) => row.id !== item.id,
                      ),
                    });
                }}
              >
                Remove requirement
              </button>
            </details>
          </article>
        ))}
      </div>
      <div className="requirement-add">
        <label>
          Add a requirement
          <input
            value={newLabel}
            maxLength={500}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. Measure the rear door opening"
          />
        </label>
        <button
          disabled={!newLabel.trim() || plan.requirements.length >= 40}
          onClick={() => {
            update({
              ...plan,
              requirements: [
                ...plan.requirements,
                {
                  id: crypto.randomUUID(),
                  label: newLabel.trim(),
                  ...(panel === 3 ? { kind: "delivery" } : {}),
                  area: "",
                  state: "todo",
                  reason: "",
                  evidence: [],
                },
              ],
            });
            setNewLabel("");
          }}
        >
          Add
        </button>
      </div>
      <p className="hint">
        Checked means you accounted for the request. Check scan alignment and
        platform quality separately.
      </p>
    </>
  );
  return (
    <section className="project-home">
      <header className="page-head">
        <div>
          <p className="wizard-eyebrow">
            {progressLabel(plan)} ·{" "}
            {project.reviewState === "reviewed"
              ? "Details reviewed"
              : "Details need review"}
          </p>
          <h1>{project.title}</h1>
          <p>
            {project.reference || "No customer reference"}{" "}
            {project.companyName && `· ${project.companyName}`}
          </p>
        </div>
        <div className="actions">
          <button onClick={onEdit} disabled={busy}>
            Edit details
          </button>
          {!project.deviceOnly && scope && (
            <ProjectFolderButton
              onBusy={onFolderBusy}
              bookId={scope}
              project={project}
              disabled={!connected || busy}
            />
          )}
          <button onClick={onBack} disabled={busy}>
            All projects
          </button>
        </div>
      </header>
      <fieldset
        className="voice-shell"
        disabled={busy && !busyFlags.current.voice}
      >
        <ProjectVoiceAnswers
          project={project}
          scope={scope}
          source={answerSource}
          asOf={answerAsOf}
          onBusy={(value) => markBusy("voice", value)}
        />
      </fieldset>
      <nav className="project-stages" aria-label="Project workflow">
        {PANELS.map((name, i) => (
          <button
            key={name}
            aria-current={panel === i ? "page" : undefined}
            title={PANEL_HELP[i]}
            onClick={() => setPanel(i)}
            disabled={busy}
          >
            {i + 1}. {name}
          </button>
        ))}
      </nav>
      <fieldset
        className="home-section"
        aria-label={PANELS[panel]}
        disabled={busy}
      >
        {panel === 0 && (
          <>
            <div className="site-overview">
              <section>
                <SectionHeading icon={CalendarDays} tone="blue">
                  Your next visit
                </SectionHeading>
                <p className="visit-time">{visitLabel(project.startLocal)}</p>
                <p>
                  {project.timeZone || ""}{" "}
                  {project.appointmentStatus &&
                    `· ${project.appointmentStatus}`}
                </p>
                <p>{address || "Site address not set"}</p>
                <div className="actions">
                  {address && (
                    <a
                      className="button-link"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <MapPin size={16} />
                      Directions
                    </a>
                  )}
                  {[1, 2].map(
                    (i) =>
                      project[`contact${i}Phone`] && (
                        <a
                          className="button-link"
                          key={i}
                          href={`tel:${project[`contact${i}Phone`].replace(/[^+\d]/g, "")}`}
                        >
                          <Phone size={16} />
                          {project[`contact${i}Name`] || `Contact ${i}`}
                        </a>
                      ),
                  )}
                </div>
              </section>
              <section className="access-card">
                <SectionHeading icon={KeyRound} tone="amber">
                  Getting inside
                </SectionHeading>
                <p className="note-text">
                  {project.accessInstructions ||
                    "Confirm access with the site contact before travelling."}
                </p>
              </section>
            </div>
            <details className="brief-summary">
              <summary>Requested work and exclusions</summary>
              <h3>Scope</h3>
              <p className="note-text">{project.scope || "Not recorded"}</p>
              <h3>Requested outputs</h3>
              <p className="note-text">
                {project.deliverables || "Not recorded"}
              </p>
              <h3>Excluded work</h3>
              <p className="note-text">
                {project.exclusions || "Not recorded"}
              </p>
            </details>
            <BriefTaskBuilder
              project={project}
              plan={plan}
              onChange={(briefDraft) => update({ ...plan, briefDraft })}
              onAdd={(requirements) => {
                const next = { ...plan, requirements, briefDraft: undefined };
                // Validate the entire saved payload before replacing the review.
                validateWorkflow(next);
                update(next);
              }}
              onBusy={(value) => markBusy("work", value)}
            />
            {!project.deviceOnly && (
              <section className="site-copy-control">
                <SectionHeading icon={WifiOff} tone="blue" level={3}>
                  Prepare for a weak connection
                </SectionHeading>
                <p>
                  {siteCopy
                    ? `A read-only copy is kept on this device, checked ${new Date(siteCopy.verifiedAt).toLocaleString()}.`
                    : "Keep a dated copy of this workbook on this device for site visits. New field records can wait safely here until you reconnect."}
                </p>
                <button
                  disabled={!connected || busy}
                  onClick={() => onSiteCopy(!siteCopy)}
                >
                  {siteCopy
                    ? "Remove workbook copy from this device"
                    : "Keep workbook on this device"}
                </button>
                <small>
                  Use your own device. Existing Drive files are not downloaded;
                  files captured here remain on this device.
                </small>
              </section>
            )}
            {checklist}
            <details className="quiet-details">
              <summary>Use this client's checklist again</summary>
              <p>
                Approve these work requirements for reuse. Future jobs still
                need a source review; dates, customer references, and amounts
                are never copied.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!plan.templateName}
                  onChange={(e) =>
                    update({
                      ...plan,
                      templateName: e.target.checked
                        ? project.companyName || "My approved checklist"
                        : "",
                    })
                  }
                />
                Offer this client's work details when starting another project
              </label>
              {plan.templateName && (
                <label>
                  Checklist name
                  <input
                    value={plan.templateName}
                    maxLength={200}
                    onChange={(e) =>
                      update({ ...plan, templateName: e.target.value })
                    }
                  />
                </label>
              )}
            </details>
            <button
              className="primary"
              onClick={() => {
                update({ ...plan, visit: "in-progress" });
                setPanel(1);
              }}
            >
              Start site visit <ArrowRight size={16} />
            </button>
          </>
        )}
        {panel === 1 && (
          <>
            <SectionHeading icon={ClipboardCheck}>
              Account for the requested work
            </SectionHeading>
            <p>
              Add measurements, photos, voice memos, and access problems to the
              right site area.
            </p>
            <div className="actions">
              <button className="primary" onClick={() => onNotes("")}>
                Add a field record
              </button>
              {onMeasurements && (
                <button onClick={onMeasurements}>Measurements</button>
              )}
              <button onClick={onAsk}>Ask about this project</button>
            </div>
            {onFieldRecord && (
              <SiteException
                project={project}
                plan={plan}
                disabled={stale}
                onChange={(exceptionDraft) =>
                  update({ ...plan, exceptionDraft })
                }
                onRecorded={update}
                onSaveRecord={onFieldRecord}
                onNotes={onNotes}
                onBusy={(value) => markBusy("work", value)}
              />
            )}
            {checklist}
            <button className="primary" onClick={() => setPanel(2)}>
              Check before leaving <ArrowRight size={16} />
            </button>
          </>
        )}
        {panel === 2 && (
          <>
            <SectionHeading icon={LogOut} tone="amber">
              Before leaving job-site
            </SectionHeading>
            <p>
              Check the areas and evidence now, while you can still resolve gaps
              on site.
            </p>
            {checks.length ? (
              <ul className="leave-checks">
                {checks.map((item, i) => (
                  <li key={i}>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="success">
                <Check size={18} />
                No outstanding items in this checklist.
              </p>
            )}
            {onFieldRecord && (
              <SiteException
                project={project}
                plan={plan}
                disabled={stale}
                onChange={(exceptionDraft) =>
                  update({ ...plan, exceptionDraft })
                }
                onRecorded={update}
                onSaveRecord={onFieldRecord}
                onNotes={onNotes}
                onBusy={(value) => markBusy("work", value)}
              />
            )}
            <label>
              Site lessons / customer-agreed exceptions
              <textarea
                value={plan.siteLessons}
                maxLength={2000}
                onChange={(e) =>
                  update({ ...plan, siteLessons: e.target.value })
                }
                placeholder="Record limitations, follow-up work, or anything to remember for the next visit."
              />
            </label>
            {followUpRecorded && (
              <p className="hint">
                A next action is already recorded for each blocked requirement.
                Add any extra visit notes above.
              </p>
            )}
            {checks.length > 0 && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                I reviewed the outstanding items and the follow-up recorded in
                this project.
              </label>
            )}
            <div className="actions">
              <button onClick={() => setPanel(1)}>Return to checklist</button>
              <button
                className="primary"
                disabled={
                  checks.length > 0 &&
                  (!acknowledged ||
                    (!plan.siteLessons.trim() && !followUpRecorded))
                }
                onClick={() => {
                  update({ ...plan, visit: "captured" });
                  setPanel(3);
                }}
              >
                Record capture finished
              </button>
            </div>
            <p className="hint">
              This records your decision. It does not certify the capture or
              approve unresolved customer requests.
            </p>
          </>
        )}
        {panel === 3 && (
          <>
            <SectionHeading icon={Send} tone="violet">
              Hand over with a clear record
            </SectionHeading>
            <p>
              Delivery, customer acceptance, and money received are separate.
            </p>
            <p className="note-text">
              <strong>Send to:</strong>{" "}
              {project.deliveryDestination || "Confirm with the customer"}
              <br />
              <strong>Deadline:</strong>{" "}
              {project.deliveryDeadline || "Not recorded"}
            </p>
            <div className="actions">
              <button
                ref={reportTrigger}
                className="primary"
                onClick={openReport}
              >
                Preview job handover
              </button>
              <button
                onClick={() =>
                  download(
                    new Blob([deliverySummary(project, plan, notes)], {
                      type: "text/plain",
                    }),
                    "streamlion-delivery-summary.txt",
                  )
                }
              >
                Download delivery summary
              </button>
              <button onClick={onEdit}>
                Add delivery links / payment details
              </button>
            </div>
            {plan.requirements.some((item) => item.kind === "delivery") &&
              checklist}
            <label>
              Delivery status
              <select
                value={plan.delivery}
                onChange={(e) => {
                  const next = e.target.value,
                    now = new Date().toISOString();
                  update({
                    ...plan,
                    delivery: next,
                    deliveredAt:
                      next === "not-sent" ? "" : plan.deliveredAt || now,
                    acceptedAt:
                      next === "accepted" ? plan.acceptedAt || now : "",
                  });
                }}
              >
                <option value="not-sent">Not recorded as sent</option>
                <option value="sent">Sent to customer</option>
                <option value="accepted">Accepted by customer</option>
              </select>
            </label>
            {plan.deliveredAt && (
              <p className="hint">
                Delivery recorded: {new Date(plan.deliveredAt).toLocaleString()}
              </p>
            )}
            {plan.acceptedAt && (
              <p className="hint">
                Acceptance recorded:{" "}
                {new Date(plan.acceptedAt).toLocaleString()}
              </p>
            )}
            <dl className="payment-facts">
              {Object.entries(payment)
                .filter(([name]) => name !== "overpaid")
                .map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
            {payment.overpaid && (
              <p className="hint">
                Received exceeds the invoice amount. Check the amounts before
                treating the account as settled.
              </p>
            )}
            <button onClick={onRepeat}>Start a repeat visit</button>
          </>
        )}
      </fieldset>
      {reportOpen && Report && (
        <Report
          project={project}
          plan={plan}
          notes={notes}
          origin={
            dirty
              ? "Working copy · checklist changes not yet confirmed"
              : answerSource === "google"
                ? "Google workbook record"
                : answerSource === "copy"
                  ? "Saved workbook copy"
                  : "Device record"
          }
          asOf={answerAsOf}
          connected={connected}
          returnFocusElement={reportTrigger.current}
          onBusy={(value) => markBusy("work", value)}
          onClose={() => setReportOpen(false)}
        />
      )}
      {(dirty || notice || error) && (
        <footer className={`checklist-save${dirty || error ? "" : " saved"}`}>
          <span>
            {dirty
              ? "Checklist changes kept on this device; save to confirm."
              : notice}
          </span>
          <div className="actions">
            {dirty && (
              <button
                className="primary"
                disabled={busy || stale || (!project.deviceOnly && !connected)}
                onClick={save}
              >
                {busy ? "Saving…" : "Save checklist"}
              </button>
            )}
            <button
              onClick={() =>
                download(
                  new Blob([JSON.stringify(plan, null, 2)], {
                    type: "application/json",
                  }),
                  "streamlion-checklist-backup.json",
                )
              }
            >
              Download checklist backup
            </button>
          </div>
          {stale && (
            <p role="alert" className="error">
              This checklist changed elsewhere. Keep a backup and reload before
              saving.
            </p>
          )}
          {!project.deviceOnly && !connected && dirty && (
            <p>Reconnect Google in Connections to save this checklist.</p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </footer>
      )}
    </section>
  );
}
