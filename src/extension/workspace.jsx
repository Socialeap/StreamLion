import React, { useEffect, useMemo, useRef, useState } from "react";
import { PROJECT_FIELDS, FIELD_KEYS } from "../project-schema.js";
import {
  measurementText,
  parseMeasurements,
  measurementNeedsReview,
  isMeasurementRecord,
  readMeasurement,
} from "../measurements.js";
import {
  readWorkflow,
  workflowNote,
  beforeLeaving,
  WORKFLOW_AREA,
  validateWorkflow,
} from "../workflow.js";
import { suggestTasks, appendReviewedTasks } from "../brief-tasks.js";
import { handoverModel, handoverMarkup } from "../handover.js";
import {
  extensionContext,
  extensionDeepLink,
  unpackExtensionResult,
} from "./context.js";
import { sampleProject } from "./sample.js";
const PWA = "https://streamlion.transcendencemedia.com/";
const groups = [...new Set(PROJECT_FIELDS.map((f) => f.group))];
const tabs = ["Overview", "Work", "Field notes", "Measurements", "Handover"];

export function ExtensionWorkspace({ bridge }) {
  const [host, setHost] = useState(null),
    [data, setData] = useState(null),
    [draft, setDraft] = useState(null),
    [tab, setTab] = useState("Overview");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [sharing, setSharing] = useState(false),
    [editing, setEditing] = useState(false),
    [search, setSearch] = useState("");
  const [editCopy, setEditCopy] = useState(null),
    [incoming, setIncoming] = useState(null),
    [sectionDirty, setSectionDirty] = useState(false),
    [leaveAction, setLeaveAction] = useState(null);
  const generation = useRef(0),
    bridgeReady = useRef(false),
    contextQueue = useRef(Promise.resolve());
  const staged = useRef(null),
    opened = useRef(false);
  const dirty = !!draft || editing || sectionDirty;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  function accept(next) {
    generation.current++;
    setError("");
    setNotice("");
    setLeaveAction(null);
    setDraft(next.kind === "draft" ? next : null);
    setSharing(false);
    setEditCopy(null);
    setSectionDirty(false);
    if (next.kind !== "draft") {
      setData(next);
      setEditing(false);
      setTab("Overview");
    } else
      setData(
        (current) =>
          current || { kind: "review", destination: next.destination },
      );
  }
  const queueContext = (value) => {
    // Serialize context replacement/clearing. A slow prior update cannot leave
    // the previous job attached after navigation or a connection failure.
    contextQueue.current = contextQueue.current
      .catch(() => {})
      .then(async () => {
        const response = await bridge.updateModelContext(value);
        if (response.isError)
          throw new Error(
            "ChatGPT could not attach the project. Please retry.",
          );
      });
    return contextQueue.current;
  };
  useEffect(() => {
    let mounted = true;
    bridge.ontoolresult = (result) => {
      if (!mounted) return;
      try {
        const next = unpackExtensionResult(result);
        if (next.kind === "workspace" && opened.current) return; // Don't reset a resumed workspace with a late opener.
        if (dirtyRef.current) {
          setIncoming(next);
          return;
        }
        opened.current = true;
        accept(next.kind === "example" ? sampleProject() : next);
      } catch (e) {
        setError(e.message);
      }
    };
    bridge.onhostcontextchanged = (ctx) => {
      const recordId = extensionDeepLink(ctx);
      if (recordId) staged.current = recordId;
      if (recordId && bridgeReady.current && !dirtyRef.current)
        loadProject(recordId);
    };
    bridge.onteardown = async () => {
      if (bridge.getHostCapabilities()?.updateModelContext)
        await queueContext({ content: [] });
      return {};
    };
    bridge
      .connect()
      .then(() => {
        if (!mounted) return;
        bridgeReady.current = true;
        setHost(bridge.getHostCapabilities());
        const selected =
          staged.current || extensionDeepLink(bridge.getHostContext());
        if (selected) loadProject(selected);
      })
      .catch(() => {
        if (mounted)
          setError(
            "This view needs a ChatGPT host. Your browser workspace is available below.",
          );
      });
    return () => {
      mounted = false;
      bridgeReady.current = false;
    };
  }, [bridge]);
  const context = useMemo(
    () => (sharing && !data?.sample ? extensionContext(data) : { content: [] }),
    [sharing, data],
  );
  useEffect(() => {
    if (host?.updateModelContext)
      queueContext(context).catch((e) => setError(e.message));
  }, [context, host]);
  async function call(name, args = {}) {
    return unpackExtensionResult(
      await bridge.callServerTool({ name, arguments: args }),
    );
  }
  async function act(task) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(e.message);
      if (e.safeToEdit)
        setDraft((current) =>
          current ? { ...current, safeToEdit: true } : current,
        );
      if (e.reconnect) {
        setSharing(false);
        if (host?.updateModelContext)
          await queueContext({ content: [] }).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }
  async function loadProject(recordId) {
    const current = ++generation.current;
    setSharing(false);
    if (bridge.getHostCapabilities()?.updateModelContext)
      await queueContext({ content: [] }).catch(() => {});
    await act(async () => {
      const next = await call("get_streamlion_project", { recordId });
      if (current === generation.current) accept(next);
    });
  }
  function requestLeave(action) {
    if (dirty) setLeaveAction(() => action);
    else return action();
  }
  function list() {
    return requestLeave(loadList);
  }
  async function loadList() {
    setSharing(false);
    if (host?.updateModelContext)
      await queueContext({ content: [] }).catch(() => {});
    await act(async () => accept(await call("list_streamlion_projects")));
  }
  async function prepare(name, args) {
    await act(async () => {
      const next = await call(name, args);
      setDraft(next);
      setEditing(false);
      setNotice("Review the details and destination, then choose how to save.");
    });
  }
  async function ask(text, content) {
    if (!host?.message) {
      setError(
        "Ask in the conversation beside this view, or use Ask in your browser workspace.",
      );
      return;
    }
    await act(async () => {
      if (!content && sharing && data?.project && host.updateModelContext)
        await queueContext(extensionContext(data));
      const response = await bridge.sendMessage({
        role: "user",
        content: [
          { type: "text", text: content ? `${text}\n\n${content}` : text },
        ],
        _meta: { "openai/message": { target: "active", send: true } },
      });
      if (response.isError)
        throw new Error(
          "ChatGPT could not send this question. Please try in the conversation.",
        );
      setNotice("Sent to this conversation.");
    });
  }
  async function openPWA() {
    try {
      const result = await bridge.openLink({ url: PWA });
      if (result.isError) throw new Error();
    } catch {
      window.open(PWA, "_blank", "noopener,noreferrer");
    }
  }
  async function save(reviewed) {
    await act(async () => {
      setDraft((current) => ({ ...current, safeToEdit: false }));
      const receipt = await call("save_streamlion_review", {
        draftId: draft.draftId,
        confirmation: draft.confirmation,
        reviewed,
      });
      // Keep the review until Google has verified the exact revision. Never
      // discard an uncertain save or regenerate its identity on Retry.
      setDraft(null);
      setNotice(`Saved to ${receipt.destination.title}.`);
      const savedProject = draft.recordType === "project";
      setEditCopy(
        savedProject
          ? {
              fields: draft.revision,
              base: {
                ...draft.revision,
                id: receipt.projectId,
                revisionId: receipt.revisionId,
              },
            }
          : null,
      );
      setEditing(savedProject);
      try {
        const next = await call("get_streamlion_project", {
          recordId: receipt.projectId,
        });
        setData(next);
        setSectionDirty(false);
        setEditCopy(null);
        setTab("Overview");
      } catch {
        setNotice(
          `Google confirmed the save to ${receipt.destination.title}. Refresh to load the saved job.`,
        );
      }
    });
  }
  const project = data?.project;
  return (
    <main className="extension">
      <header className="extension-header">
        <div>
          <span className="lion" aria-hidden="true">
            🦁
          </span>
          <strong>StreamLion</strong>
          <small>In this conversation</small>
        </div>
        <button
          className="quiet"
          onClick={openPWA}
          title="Open the full browser workspace, including offline work and audio recording."
        >
          Browser workspace ↗
        </button>
      </header>
      {leaveAction && (
        <section className="card" role="alert">
          <h2>Keep your unsaved changes?</h2>
          <p>Stay here to review and save them, or discard them to continue.</p>
          <div className="actions">
            <button onClick={() => setLeaveAction(null)}>Keep editing</button>
            <button
              className="secondary"
              onClick={() => {
                const action = leaveAction;
                setLeaveAction(null);
                action();
              }}
            >
              Discard these changes
            </button>
          </div>
        </section>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
          {!draft && (
            <button
              className="quiet"
              disabled={busy || !host?.serverTools}
              onClick={() =>
                data?.project && !data.sample
                  ? requestLeave(() => loadProject(data.project.id))
                  : list()
              }
            >
              Retry connection / refresh
            </button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {incoming && (
        <div className="notice">
          ChatGPT has a new view ready. Finish or close this review first.
          <button
            className="quiet"
            disabled={dirty || busy}
            onClick={() => {
              accept(incoming);
              setIncoming(null);
            }}
          >
            Open new view
          </button>
        </div>
      )}
      {!draft && !editing && (!data || data.kind === "workspace") ? (
        <section className="welcome card">
          <p className="eyebrow">YOUR JOB, WITH YOU</p>
          <h1>
            Open a job.
            <br />
            Ask. Review. Keep moving.
          </h1>
          <p>Use your Google projects here, alongside the conversation.</p>
          <button disabled={!host?.serverTools || busy} onClick={list}>
            Connect my workbook
          </button>
          <button className="secondary" onClick={() => accept(sampleProject())}>
            Try a sample job
          </button>
          <ol className="short-steps">
            <li>
              <strong>Choose once</strong>
              <span>Connect the workbook you use in StreamLion.</span>
            </li>
            <li>
              <strong>Work in one place</strong>
              <span>Ask about the selected job and review changes here.</span>
            </li>
          </ol>
        </section>
      ) : (
        <>
          {data?.destination && (
            <div className="destination">
              <span>{data.sample ? "SAMPLE JOB" : "GOOGLE WORKBOOK"}</span>
              <strong>{data.destination.title}</strong>
              {data.destination.workbookUrl && (
                <a
                  href={data.destination.workbookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View sheet ↗
                </a>
              )}
              <small>
                {data.sample
                  ? "Nothing is saved to Google."
                  : `Read ${new Date(data.destination.asOf).toLocaleString()}`}
              </small>
            </div>
          )}
          {draft ? (
            <ReviewDraft
              key={draft.draftId}
              draft={draft}
              busy={busy}
              onSave={save}
              onReload={() =>
                requestLeave(() =>
                  loadProject(
                    draft.recordType === "project"
                      ? draft.revision.recordId
                      : draft.revision.projectId,
                  ),
                )
              }
              onCancel={async () => {
                if (
                  draft.recordType !== "project" &&
                  draft.revision.projectId !== project?.id
                ) {
                  await act(async () => {
                    const next = await call("get_streamlion_project", {
                      recordId: draft.revision.projectId,
                    });
                    setData(next);
                    setEditCopy(draft);
                    setTab(
                      draft.recordType === "measurement"
                        ? "Measurements"
                        : draft.recordType === "workflow"
                          ? "Work"
                          : "Field notes",
                    );
                    setDraft(null);
                  });
                  return;
                }
                if (draft.recordType === "project") {
                  setEditCopy({
                    fields: draft.revision,
                    base: draft.expectedRevisionId
                      ? {
                          ...draft.revision,
                          id: draft.revision.recordId,
                          revisionId: draft.expectedRevisionId,
                        }
                      : null,
                  });
                  setEditing(true);
                } else {
                  setEditCopy(draft);
                  setTab(
                    draft.recordType === "measurement"
                      ? "Measurements"
                      : draft.recordType === "workflow"
                        ? "Work"
                        : "Field notes",
                  );
                }
                setDraft(null);
                setNotice("Review closed. No new save was requested.");
              }}
            />
          ) : editing ? (
            <ProjectForm
              key={editCopy ? "retained-edit" : project?.id || "new"}
              project={editCopy ? editCopy.base : project}
              initialFields={editCopy?.fields}
              busy={busy}
              onCancel={() =>
                requestLeave(() => {
                  setEditing(false);
                  setEditCopy(null);
                  setSectionDirty(false);
                })
              }
              onReview={(fields) => {
                const base = editCopy ? editCopy.base : project;
                prepare("prepare_streamlion_project", {
                  fields,
                  ...(base
                    ? { recordId: base.id, expectedRevisionId: base.revisionId }
                    : {}),
                });
              }}
            />
          ) : project ? (
            <>
              <div className="project-heading">
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    data.sample ? accept({ kind: "workspace" }) : list()
                  }
                >
                  ← Projects
                </button>
                <h1>{project.title}</h1>
                {!data.sample && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setEditCopy(null);
                      setEditing(true);
                    }}
                  >
                    Edit project
                  </button>
                )}
              </div>
              <div className="chat-strip">
                <label>
                  <input
                    type="checkbox"
                    checked={sharing}
                    disabled={!host?.updateModelContext || data.sample || busy}
                    onChange={(e) => setSharing(e.target.checked)}
                  />
                  Share this job with this conversation
                </label>
                <small>
                  {data.sample
                    ? "Sample details only."
                    : sharing
                      ? "Selected job and field notes attached. Changing jobs clears this attachment."
                      : "You choose when job details are attached to the conversation."}
                </small>
                <button
                  className="secondary"
                  disabled={
                    busy || !host?.message || (!sharing && !data.sample)
                  }
                  onClick={() =>
                    ask(
                      "What still needs attention before I leave this job site? Cite the project field or observation that supports each answer.",
                      data.sample
                        ? JSON.stringify({
                            sample: true,
                            project,
                            notes: data.notes,
                          })
                        : null,
                    )
                  }
                >
                  Ask what’s next
                </button>
              </div>
              <nav className="view-tabs" aria-label="Project sections">
                {tabs.map((t) => (
                  <button
                    key={t}
                    aria-current={tab === t ? "page" : undefined}
                    onClick={() => setTab(t)}
                    disabled={busy}
                  >
                    {t}
                  </button>
                ))}
              </nav>
              <ProjectSection
                key={`${project.id}:${project.revisionId}:${data.destination.asOf}:${editCopy?.draftId || ""}`}
                initialDraft={editCopy?.recordType ? editCopy : null}
                tab={tab}
                data={data}
                busy={busy}
                host={host}
                onAsk={ask}
                onPrepare={prepare}
                onTabChange={setTab}
                onDirty={setSectionDirty}
              />
            </>
          ) : data.kind === "projects" ? (
            <section className="card">
              <div className="section-heading">
                <h1>
                  Your projects <small>{data.projects.length}</small>
                </h1>
                <button
                  disabled={busy}
                  onClick={() => {
                    setData({ ...data, project: null });
                    setEditing(true);
                  }}
                >
                  New project
                </button>
              </div>
              <label className="search">
                Find a job
                <input
                  placeholder="Project name or city"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="projects-list">
                {data.projects
                  .filter((p) =>
                    `${p.title} ${p.city}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <button
                      className="project-row"
                      key={p.recordId}
                      disabled={busy}
                      onClick={() => loadProject(p.recordId)}
                    >
                      <strong>{p.title}</strong>
                      <span>{p.city || "City not recorded"}</span>
                      <span>
                        {p.date?.replace("T", " · ") || "Visit to confirm"}
                      </span>
                      <small>
                        {p.reviewState === "reviewed" ? "Reviewed" : "Draft"} →
                      </small>
                    </button>
                  ))}
              </div>
              {!data.projects.length && (
                <p>
                  No projects yet. Create one here or ask ChatGPT to prepare a
                  draft from your brief.
                </p>
              )}
            </section>
          ) : null}
        </>
      )}
      <footer>
        Google owns your records. Changes save only after your review.
      </footer>
    </main>
  );
}

function ProjectForm({ project, initialFields, busy, onReview, onCancel }) {
  const [fields, setFields] = useState(() =>
      Object.fromEntries(
        FIELD_KEYS.map((k) => [k, initialFields?.[k] ?? project?.[k] ?? ""]),
      ),
    ),
    [group, setGroup] = useState(groups[0]);
  return (
    <section className="card">
      <div className="section-heading">
        <h1>{project ? "Edit project" : "Create project"}</h1>
        <button className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p>Fill what you know. Review the destination before saving.</p>
      <nav className="view-tabs" aria-label="Project fields">
        {groups.map((g) => (
          <button
            key={g}
            aria-current={group === g ? "page" : undefined}
            onClick={() => setGroup(g)}
          >
            {g}
          </button>
        ))}
      </nav>
      <div className="field-grid">
        {PROJECT_FIELDS.filter((f) => f.group === group).map((f) => (
          <label key={f.key}>
            {f.label}
            {f.type === "textarea" ? (
              <textarea
                value={fields[f.key]}
                onChange={(e) =>
                  setFields({ ...fields, [f.key]: e.target.value })
                }
              />
            ) : f.type === "appointment" ? (
              <select
                value={fields[f.key]}
                onChange={(e) =>
                  setFields({ ...fields, [f.key]: e.target.value })
                }
              >
                {["", "proposed", "confirmed"].map((s) => (
                  <option key={s} value={s}>
                    {s || "Unknown"}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  ["email", "url", "date", "datetime-local"].includes(f.type)
                    ? f.type
                    : "text"
                }
                value={fields[f.key]}
                onChange={(e) =>
                  setFields({ ...fields, [f.key]: e.target.value })
                }
              />
            )}
          </label>
        ))}
      </div>
      <button
        disabled={busy || !fields.title.trim()}
        onClick={() => onReview(fields)}
      >
        Review changes
      </button>
    </section>
  );
}

function ReviewDraft({ draft, busy, onSave, onCancel, onReload }) {
  const [reviewed, setReviewed] = useState(false),
    [attempt, setAttempt] = useState(null);
  useEffect(() => {
    if (draft.safeToEdit) setAttempt(null);
  }, [draft.safeToEdit]);
  const r = draft.revision,
    ambiguous =
      draft.recordType === "measurement" &&
      measurementNeedsReview({ text: r.text });
  return (
    <section className="card review">
      <p className="eyebrow">REVIEW BEFORE SAVING</p>
      <h1>{draft.recordType === "project" ? r.title : r.area}</h1>
      <p>
        Save to <strong>{draft.destination.title}</strong>. This adds a new
        version and keeps earlier versions.
      </p>
      {draft.recordType === "project" ? (
        groups.map((g) => (
          <details key={g} open={g === groups[0]}>
            <summary>{g}</summary>
            <dl>
              {PROJECT_FIELDS.filter((f) => f.group === g && r[f.key]).map(
                (f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{r[f.key]}</dd>
                  </div>
                ),
              )}
            </dl>
          </details>
        ))
      ) : draft.recordType === "workflow" ? (
        <div>
          <p>Delivery: {JSON.parse(r.text).delivery}</p>
          <ul>
            {JSON.parse(r.text).requirements.map((item) => (
              <li key={item.id}>
                {item.label} · {item.state}
                {item.source?.quote && (
                  <small>Source: {item.source.quote}</small>
                )}
                {item.reason && <small>Reason: {item.reason}</small>}
                {!!item.evidence.length && (
                  <small>Linked records: {item.evidence.join(", ")}</small>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <pre>{measurementText({ text: r.text })}</pre>
      )}
      {ambiguous && (
        <p className="alert">
          Some wording needs clarification. Save as a draft, or close this
          review and correct the original readings.
        </p>
      )}
      <label className="check">
        <input
          type="checkbox"
          disabled={ambiguous || busy || attempt !== null}
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        {draft.recordType === "measurement"
          ? "I checked every reading against the tape"
          : "I checked these details against the source"}
      </label>
      <div className="actions">
        <button
          disabled={busy || !draft.confirmation}
          onClick={() => {
            const value = attempt ?? reviewed;
            setAttempt(value);
            onSave(value);
          }}
        >
          {attempt !== null
            ? "Retry / confirm this save"
            : reviewed
              ? "Save reviewed record"
              : "Save draft"}
        </button>
        <button
          className="secondary"
          disabled={busy || attempt !== null}
          onClick={onCancel}
        >
          Keep editing instead
        </button>
        {draft.safeToEdit && (
          <button className="secondary" disabled={busy} onClick={onReload}>
            Load latest project
          </button>
        )}
      </div>
      <small>
        Review copy expires in 24 hours. A save stays here until Google confirms
        it.
      </small>
    </section>
  );
}

function ProjectSection({
  tab,
  data,
  initialDraft,
  busy,
  host,
  onAsk,
  onPrepare,
  onTabChange,
  onDirty,
}) {
  const { project: p, notes, sample } = data;
  const retained = initialDraft?.revision;
  const [editingNote, setEditingNote] = useState(
    initialDraft?.recordType === "note" && initialDraft.expectedRevisionId
      ? { id: retained.recordId, revisionId: initialDraft.expectedRevisionId }
      : null,
  );
  const [editingReading, setEditingReading] = useState(
    initialDraft?.recordType === "measurement" &&
      initialDraft.expectedRevisionId
      ? { id: retained.recordId, revisionId: initialDraft.expectedRevisionId }
      : null,
  );
  const measurementDraft =
    initialDraft?.recordType === "measurement"
      ? JSON.parse(retained.text)
      : null;
  const [area, setArea] = useState(
      initialDraft?.recordType === "note" ? retained.area : "",
    ),
    [text, setText] = useState(
      initialDraft?.recordType === "note" ? retained.text : "",
    ),
    [room, setRoom] = useState(measurementDraft?.room || ""),
    [raw, setRaw] = useState(measurementDraft?.raw || ""),
    [localError, setLocalError] = useState("");
  const [floor, setFloor] = useState(measurementDraft?.floor || ""),
    [side, setSide] = useState(measurementDraft?.side || "Interior");
  const savedPlan = useMemo(() => {
    try {
      return readWorkflow(notes, p);
    } catch {
      return null;
    }
  }, [notes, p]);
  const [plan, setPlan] = useState(() => {
      try {
        return initialDraft?.recordType === "workflow"
          ? JSON.parse(retained.text)
          : savedPlan;
      } catch (e) {
        return null;
      }
    }),
    [suggestions, setSuggestions] = useState(null),
    [sourcesReviewed, setSourcesReviewed] = useState(false);
  const [includePayment, setIncludePayment] = useState(false),
    [includeUnreviewed, setIncludeUnreviewed] = useState(false);
  const parsed = useMemo(() => parseMeasurements(raw), [raw]);
  const planChanged = JSON.stringify(plan) !== JSON.stringify(savedPlan);
  const unsaved = !!(area || text || room || raw || planChanged || suggestions);
  useEffect(() => {
    onDirty(!sample && unsaved);
    return () => onDirty(false);
  }, [unsaved, sample, onDirty]);
  const fieldNotes = notes.filter((n) => n.area !== WORKFLOW_AREA);
  const tryLocal = (task) => {
    setLocalError("");
    try {
      task();
    } catch (e) {
      setLocalError(e.message);
    }
  };
  if (tab === "Overview")
    return (
      <section className="card">
        <div className="facts">
          <div>
            <small>Site</small>
            <strong>
              {[p.address, p.city, p.region].filter(Boolean).join(", ") ||
                "Not recorded"}
            </strong>
          </div>
          <div>
            <small>Visit</small>
            <strong>{p.startLocal?.replace("T", " · ") || "To confirm"}</strong>
          </div>
          <div>
            <small>Client</small>
            <strong>{p.companyName || "Not recorded"}</strong>
          </div>
        </div>
        <h2>Requested work</h2>
        <p className="wording">{p.scope || "Not recorded"}</p>
        <h2>Deliverables</h2>
        <p className="wording">{p.deliverables || "Not recorded"}</p>
        <h2>Access</h2>
        <p className="wording">{p.accessInstructions || "Not recorded"}</p>
        {plan && (
          <div className="next-actions">
            <h2>Before leaving job-site</h2>
            {beforeLeaving(p, plan, notes).length ? (
              <ul>
                {beforeLeaving(p, plan, notes).map((item, i) => (
                  <li key={i}>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No outstanding checks in the recorded checklist.</p>
            )}
          </div>
        )}
      </section>
    );
  if (tab === "Field notes")
    return (
      <section className="card">
        <h2>Record what happened</h2>
        <p>
          Tap the microphone on your device keyboard to dictate into the note.
        </p>
        {localError && (
          <p className="alert" role="alert">
            {localError}
          </p>
        )}
        {editingNote && (
          <div className="actions">
            <small>
              Correcting a saved note. Its original wording is retained.
            </small>
            <button
              className="secondary"
              onClick={() => {
                setEditingNote(null);
                setArea("");
                setText("");
              }}
            >
              Start a new note
            </button>
          </div>
        )}
        <div className="field-grid">
          <label>
            Space or area
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Kitchen"
              maxLength={1000}
            />
          </label>
          <label>
            Observation
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Keep the wording as you observed it."
              maxLength={12000}
            />
          </label>
        </div>
        <button
          disabled={sample || busy || !area.trim() || !text.trim()}
          onClick={() =>
            onPrepare("prepare_streamlion_note", {
              projectId: p.id,
              area,
              text,
              sourceText: text,
              ...(editingNote
                ? {
                    recordId: editingNote.id,
                    expectedRevisionId: editingNote.revisionId,
                  }
                : {}),
            })
          }
        >
          Review note
        </button>
        {sample && (
          <small>
            Try typing here. Saving real notes requires your connected workbook.
          </small>
        )}
        <h2>Recorded evidence</h2>
        {fieldNotes.length ? (
          fieldNotes.map((n) => (
            <details key={n.id}>
              <summary>
                {n.area} · {n.reviewed ? "Reviewed" : "Draft"}
              </summary>
              <pre>{measurementText(n)}</pre>
              <small>Record {n.id}</small>
              <button
                className="secondary"
                disabled={sample || busy}
                onClick={() =>
                  tryLocal(() => {
                    if (isMeasurementRecord(n)) {
                      const reading = readMeasurement(n);
                      setRoom(reading.room);
                      setRaw(reading.raw);
                      setFloor(reading.floor);
                      setSide(reading.side);
                      setEditingReading({ id: n.id, revisionId: n.revisionId });
                      onTabChange("Measurements");
                    } else {
                      setArea(n.area);
                      setText(n.text);
                      setEditingNote({ id: n.id, revisionId: n.revisionId });
                    }
                  })
                }
              >
                Correct this record
              </button>
            </details>
          ))
        ) : (
          <p>No field records yet.</p>
        )}
      </section>
    );
  if (tab === "Measurements")
    return (
      <section className="card">
        <h2>Say the room. Then the readings.</h2>
        <p>
          Use your keyboard’s microphone. StreamLion organizes named readings
          and exact units. Check them against your tape before marking them
          reviewed.
        </p>
        {editingReading && (
          <div className="actions">
            <small>
              Correcting saved readings. Their original dictation is retained.
            </small>
            <button
              className="secondary"
              onClick={() => {
                setEditingReading(null);
                setRoom("");
                setRaw("");
                setFloor("");
                setSide("Interior");
              }}
            >
              Start a new room
            </button>
          </div>
        )}
        <div className="field-grid">
          <label>
            Room or space
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Kitchen"
              maxLength={100}
            />
          </label>
          <label>
            Level or floor (optional)
            <input
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="Ground floor"
              maxLength={100}
            />
          </label>
          <label>
            Position
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option>Interior</option>
              <option>Exterior</option>
            </select>
          </label>
          <label>
            Readings
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="Length twelve feet six inches. Width ten feet."
              maxLength={3000}
            />
          </label>
        </div>
        <div className="measurement-preview" aria-live="polite">
          <h3>{room || "Name the room above"}</h3>
          {parsed.entries.map((e) => (
            <p key={e.id}>
              <strong>{e.label}</strong> {e.display}
              {e.detail && ` · ${e.detail}`}
            </p>
          ))}
          {parsed.issues.map((i, index) => (
            <p className="alert" key={index}>
              {i.raw}: {i.message}
            </p>
          ))}
          {!raw.trim() && <p>Your organized readings will appear here.</p>}
        </div>
        <button
          disabled={sample || busy || !room.trim() || !raw.trim()}
          onClick={() =>
            onPrepare("prepare_streamlion_measurements", {
              projectId: p.id,
              room,
              raw,
              floor,
              side,
              ...(editingReading
                ? {
                    recordId: editingReading.id,
                    expectedRevisionId: editingReading.revisionId,
                  }
                : {}),
            })
          }
        >
          Review room readings
        </button>
        {sample && (
          <small>
            Parsing works in this example. Connect a workbook to save real
            readings.
          </small>
        )}
      </section>
    );
  if (tab === "Work") {
    if (!plan)
      return (
        <section className="card alert">
          This checklist needs a workbook history review. Open the browser
          workspace to inspect it.
        </section>
      );
    const previous = workflowNote(notes, p.id);
    return (
      <section className="card">
        <h2>Make the brief actionable</h2>
        <p>
          Organize the recorded scope into specific tasks. Check the source
          wording before adding them.
        </p>
        {localError && (
          <p className="alert" role="alert">
            {localError}
          </p>
        )}
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            tryLocal(() => {
              setSuggestions(suggestTasks({ project: p }));
              setSourcesReviewed(false);
            })
          }
        >
          Suggest tasks from this brief
        </button>
        {suggestions && (
          <section className="task-review">
            <h3>Check the proposed tasks</h3>
            {suggestions.map((s, i) => (
              <label className="check" key={s.id}>
                <input
                  type="checkbox"
                  checked={s.selected}
                  onChange={(e) =>
                    setSuggestions(
                      suggestions.map((item, j) =>
                        i === j
                          ? { ...item, selected: e.target.checked }
                          : item,
                      ),
                    )
                  }
                />
                <span>
                  {s.label}
                  <small>{s.source?.quote}</small>
                </span>
              </label>
            ))}
            <label className="check">
              <input
                type="checkbox"
                checked={sourcesReviewed}
                onChange={(e) => setSourcesReviewed(e.target.checked)}
              />
              I checked the tasks against the source
            </label>
            <button
              disabled={!sourcesReviewed}
              onClick={() =>
                tryLocal(() => {
                  const requirements = appendReviewedTasks(plan.requirements, {
                    text: "",
                    sourceName: "Project brief",
                    suggestions,
                    reviewed: true,
                  });
                  const next = { ...plan, requirements };
                  validateWorkflow(next);
                  setPlan(next);
                  setSuggestions(null);
                })
              }
            >
              Add selected tasks to review
            </button>
          </section>
        )}
        <ul className="task-list">
          {plan.requirements.map((item, i) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              <small>
                {item.area}
                {item.source ? ` · ${item.source.name}` : ""}
              </small>
              <select
                aria-label={`Status for ${item.label}`}
                value={item.state}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    requirements: plan.requirements.map((r, j) =>
                      i === j ? { ...r, state: e.target.value } : r,
                    ),
                  })
                }
              >
                {["todo", "done", "blocked", "not-needed"].map((s) => (
                  <option key={s} value={s}>
                    {
                      {
                        todo: "To check",
                        done: "Checked",
                        blocked: "Blocked",
                        "not-needed": "Not needed",
                      }[s]
                    }
                  </option>
                ))}
              </select>
              {["blocked", "not-needed"].includes(item.state) && (
                <label>
                  Reason
                  <input
                    value={item.reason}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        requirements: plan.requirements.map((r, j) =>
                          i === j ? { ...r, reason: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
        <label>
          Delivery
          <select
            value={plan.delivery}
            onChange={(e) => {
              const state = e.target.value,
                now = new Date().toISOString();
              setPlan({
                ...plan,
                delivery: state,
                deliveredAt:
                  state === "not-sent" ? "" : plan.deliveredAt || now,
                acceptedAt: state === "accepted" ? now : "",
                requirements: plan.requirements.map((r) =>
                  r.kind === "delivery"
                    ? { ...r, state: state === "not-sent" ? "todo" : "done" }
                    : r,
                ),
              });
            }}
          >
            <option value="not-sent">Not sent</option>
            <option value="sent">Sent</option>
            <option value="accepted">Client accepted</option>
          </select>
        </label>
        <button
          disabled={sample || busy}
          onClick={() =>
            onPrepare("prepare_streamlion_checklist", {
              projectId: p.id,
              plan,
              ...(previous
                ? {
                    recordId: previous.id,
                    expectedRevisionId: previous.revisionId,
                  }
                : {}),
            })
          }
        >
          Review checklist changes
        </button>
        {sample && (
          <small>
            Try the controls. This example never changes Google records.
          </small>
        )}
      </section>
    );
  }
  if (tab === "Handover") {
    if (!plan)
      return (
        <section className="card alert">
          Review the workbook checklist before preparing a handover.
        </section>
      );
    const model = handoverModel(p, plan, notes, {
      includePayment,
      includeUnreviewed,
      origin: sample
        ? "Synthetic example"
        : planChanged
          ? "Working copy · checklist changes not saved to Google"
          : "Google workbook",
      asOf: data.destination.asOf,
    });
    const markup = handoverMarkup(model);
    return (
      <section className="card">
        <h2>Review what the client will see</h2>
        {planChanged && !sample && (
          <p className="alert">
            This preview includes checklist changes that have not been saved.
            Review and save them in Work to make this a saved workbook report.
          </p>
        )}
        <div className="report-options">
          <label className="check">
            <input
              type="checkbox"
              checked={includePayment}
              onChange={(e) => setIncludePayment(e.target.checked)}
            />
            Include payment details
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={includeUnreviewed}
              onChange={(e) => setIncludeUnreviewed(e.target.checked)}
            />
            Include unchecked field records
          </label>
        </div>
        <button
          className="secondary"
          disabled={busy || !host?.message}
          onClick={() => {
            const plain = new DOMParser().parseFromString(markup, "text/html")
              .body.textContent;
            onAsk(
              "Format this provider handover from the supplied content only. Do not add omitted private fields from conversation history. Preserve outstanding work and source limitations. Do not email or publish it.",
              plain,
            );
          }}
        >
          Send this handover to the conversation
        </button>
        <div
          className="handover-preview"
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      </section>
    );
  }
  return null;
}
