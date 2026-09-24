import { readDraft, writeDraft, clearDraft, clearSavedDraft } from "./drafts";
import Building2 from "./BuildingIcon";
import { useEffect, useRef, useState } from "react";
import { FileText, NotebookPen, Link, MessageCircle } from "lucide-react";
import Jobs from "./Jobs";
import Notes from "./Notes";
import ProjectEditor from "./ProjectEditor";
import Connections from "./Connections";
import ChatGPTPanel from "./ChatGPTPanel";
import { emptyWorkspace, reviseNote, exportWorkspace } from "./model";
import {
  loadWorkspace,
  saveWorkspace,
  saveAudioNote,
  download,
} from "./storage";
import { readWorkbook, appendRevision, hasGoogleSession } from "./google";
import {
  makeRevision,
  toLocalProject,
  toLocalNote,
  validateNote,
} from "./workbook";
export default function App() {
  const [local, setLocal] = useState(emptyWorkspace),
    current = useRef(null),
    writing = useRef(false);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Opening device records…");
  const [page, setPage] = useState("Projects"),
    [selected, setSelected] = useState(""),
    [editing, setEditing] = useState(null),
    [captureBusy, setCaptureBusy] = useState(false),
    [syncBusy, setSyncBusy] = useState(false);
  const [bookId, setBookId] = useState(""),
    [remote, setRemote] = useState(null);
  const pending = useRef(null);
  const [hasPending, setHasPending] = useState(false);
  const [noteEpoch, setNoteEpoch] = useState(0);
  useEffect(() => {
    loadWorkspace()
      .then((w) => {
        current.current = w;
        setLocal(w);
        setReady(true);
        setStatus("Device workspace");
      })
      .catch((e) => setError(e.message));
  }, []);
  const workspace = remote
    ? {
        jobs: remote.Projects.map(toLocalProject),
        notes: remote.Observations.map(toLocalNote),
      }
    : local;
  const active = workspace.jobs.find((j) => j.id === selected);
  async function commit(change, audio) {
    if (writing.current) throw new Error("Another save is in progress. Retry.");
    writing.current = true;
    try {
      const next = {
        ...change(current.current),
        revision: (current.current.revision || 0) + 1,
      };
      if (audio) await saveAudioNote(next, audio.id, audio.blob);
      else await saveWorkspace(next);
      current.current = next;
      setLocal(next);
      setStatus("Saved on this device");
    } finally {
      writing.current = false;
    }
  }
  function connectBook(id, data) {
    pending.current = readDraft(`${id}:pending-write`);
    setHasPending(!!pending.current);
    setBookId(id);
    setRemote(data);
    setSelected("");
    setEditing(null);
    setStatus("Google records refreshed");
  }
  function disconnect() {
    pending.current = null;
    setHasPending(false);
    setBookId("");
    setRemote(null);
    setSelected("");
    setEditing(null);
    setStatus("Device workspace");
  }
  async function refresh() {
    setSyncBusy(true);
    setError("");
    try {
      const data = await readWorkbook(bookId);
      setRemote(data);
      setStatus("Google records refreshed " + new Date().toLocaleTimeString());
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncBusy(false);
    }
  }
  async function showProjectsFromGoogle() {
    setSyncBusy(true);
    setError("");
    try {
      const data = await readWorkbook(bookId);
      setRemote(data);
      setStatus("Google records refreshed " + new Date().toLocaleTimeString());
      setEditing(null);
      setPage("Projects");
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncBusy(false);
    }
  }
  async function cloudSave(tab, fields, recordId, reviewState) {
    if (!hasGoogleSession())
      throw new Error("Reconnect Google in Connections before saving.");
    const previous = remote[tab].find((r) => r.recordId === recordId);
    const signature = JSON.stringify({
      bookId,
      tab,
      fields,
      recordId,
      reviewState,
    });
    if (pending.current && pending.current.signature !== signature)
      throw new Error(
        "A previous Google write has an uncertain outcome. Use Retry pending save above before starting a different save.",
      );
    const revision =
      pending.current?.revision ||
      makeRevision(fields, previous, recordId, reviewState);
    const operation = pending.current || {
      signature,
      revision,
      tab,
      expected: previous ?? null,
    };
    writeDraft(`${bookId}:pending-write`, operation);
    pending.current = operation;
    setHasPending(true);
    setSyncBusy(true);
    try {
      const after = await appendRevision(
        bookId,
        tab,
        revision,
        operation.expected,
      );
      setRemote(after);
      clearDraft(`${bookId}:pending-write`);
      pending.current = null;
      setHasPending(false);
      setStatus("Saved and verified in Google");
      return revision.recordId;
    } finally {
      setSyncBusy(false);
    }
  }
  async function retryPending() {
    const op = pending.current;
    if (!op) return;
    setSyncBusy(true);
    setError("");
    try {
      const after = await appendRevision(
        bookId,
        op.tab,
        op.revision,
        op.expected,
      );
      setRemote(after);
      clearDraft(`${bookId}:pending-write`);
      pending.current = null;
      setHasPending(false);
      clearSavedDraft(bookId, op);
      if (op.tab === "Projects") {
        setSelected(op.revision.recordId);
        setEditing(null);
        setPage("Field notes");
      } else {
        setNoteEpoch((x) => x + 1);
      }
      setStatus("Pending save verified in Google");
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncBusy(false);
    }
  }
  async function saveProject(fields, project, reviewed) {
    let id = project?.id || crypto.randomUUID();
    if (remote) {
      if (pending.current?.revision && !project)
        id = pending.current.revision.recordId;
      id = await cloudSave(
        "Projects",
        fields,
        id,
        reviewed ? "reviewed" : "draft",
      );
    } else
      await commit((w) => ({
        ...w,
        jobs: project
          ? w.jobs.map((j) =>
              j.id === id
                ? {
                    ...j,
                    ...fields,
                    reviewState: reviewed ? "reviewed" : "draft",
                    offeredCents: fields.offeredFee
                      ? Math.round(+fields.offeredFee * 100)
                      : null,
                  }
                : j,
            )
          : [
              ...w.jobs,
              {
                ...fields,
                id,
                createdAt: new Date().toISOString(),
                reviewState: reviewed ? "reviewed" : "draft",
                status: "Draft",
                offeredCents: fields.offeredFee
                  ? Math.round(+fields.offeredFee * 100)
                  : null,
              },
            ],
      }));
    setSelected(id);
    setEditing(null);
    setPage("Field notes");
  }
  async function addNote(note) {
    if (remote) {
      const fields = validateNote({
        projectId: note.jobId,
        area: note.area,
        text: note.text,
        sourceText: note.text,
        audioUrl: "",
      });
      await cloudSave(
        "Observations",
        fields,
        pending.current?.revision.recordId || crypto.randomUUID(),
        "draft",
      );
    } else
      await commit((w) => ({
        ...w,
        notes: [
          ...w.notes,
          {
            ...note,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            reviewed: false,
            revisions: [],
          },
        ],
      }));
  }
  async function updateNote(id, text, review) {
    const n = workspace.notes.find((n) => n.id === id);
    if (remote)
      await cloudSave(
        "Observations",
        validateNote({
          projectId: n.jobId,
          area: n.area,
          text: text ?? n.text,
          sourceText: n.sourceText || n.text,
          audioUrl: n.audioUrl || "",
        }),
        id,
        review ? "reviewed" : "draft",
      );
    else
      await commit((w) => ({
        ...w,
        notes: w.notes.map((n) =>
          n.id === id
            ? review
              ? { ...n, reviewed: true }
              : reviseNote(n, text, new Date().toISOString())
            : n,
        ),
      }));
  }
  async function addAudio(context, blob) {
    const id = crypto.randomUUID();
    await commit(
      (w) => ({
        ...w,
        notes: [
          ...w.notes,
          {
            ...context,
            id,
            audioId: id,
            text: "",
            reviewed: false,
            revisions: [],
          },
        ],
      }),
      { id, blob },
    );
  }
  const disabled = captureBusy || syncBusy;
  const navigate = (p) => {
    setEditing(null);
    setPage(p);
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Building2 size={30} />
          <span>StreamLion</span>
        </div>
        <nav aria-label="Main">
          {[
            [FileText, "Projects"],
            [NotebookPen, "Field notes"],
            [MessageCircle, "Ask"],
            [Link, "Connections"],
          ].map(([Icon, label]) => (
            <button
              key={label}
              disabled={disabled}
              className={page === label ? "active" : ""}
              onClick={() => navigate(label)}
              title={
                {
                  Projects: "Find, review, or create a project.",
                  "Field notes": "Record what happened at a site.",
                  Ask: "Talk with StreamLion about a project in ChatGPT.",
                  Connections:
                    "Connect your Google account and choose a workbook.",
                }[label]
              }
            >
              <Icon size={20} />
              {label}
            </button>
          ))}
        </nav>
        <div className="workspace-status">
          <span>
            {bookId ? "Google workbook" : "Local device"}
            <br />
            <span role="status">{status}</span>
          </span>
        </div>
      </aside>
      <main>
        {hasPending && (
          <section className="intake-panel">
            <h2>Google save awaiting verification</h2>
            <p>
              Your operation is kept on this device with its original ID.
              Reconnect if needed, then retry to verify it without duplicating
              it.
            </p>
            <div className="actions">
              <button disabled={disabled} onClick={retryPending}>
                Retry pending save
              </button>
              <button
                onClick={() =>
                  download(
                    new Blob([JSON.stringify(pending.current, null, 2)], {
                      type: "application/json",
                    }),
                    "streamlion-pending-save.json",
                  )
                }
              >
                Download pending operation
              </button>
              <button
                disabled={disabled}
                onClick={() => {
                  if (
                    window.confirm(
                      "Check the workbook first: this operation may already be saved. Release its retry record while retaining your editable draft?",
                    )
                  ) {
                    clearDraft(`${bookId}:pending-write`);
                    pending.current = null;
                    setHasPending(false);
                  }
                }}
              >
                I checked Google — release retry
              </button>
            </div>
          </section>
        )}

        {bookId && (
          <div className="sync-bar">
            <span>
              Google-owned records ·{" "}
              {hasGoogleSession() ? "connected" : "reconnect needed"}
            </span>
            <button
              disabled={disabled || !!editing}
              onClick={async () => {
                await refresh(); /* Keep unresolved writes until the same operation is retried. */
              }}
            >
              Refresh from Google
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!ready ? (
          <p>Opening local workspace…</p>
        ) : editing ? (
          <ProjectEditor
            key={(bookId || "local") + ":" + (editing.id || "new")}
            project={editing.id ? editing : null}
            draftScope={bookId || "local"}
            bookId={bookId}
            onSave={saveProject}
            onCancel={() => setEditing(null)}
            onRefreshProjects={showProjectsFromGoogle}
          />
        ) : page === "Projects" ? (
          <Jobs
            workspace={workspace}
            onCreate={() => setEditing({})}
            onOpen={(id) => {
              setSelected(id);
              setPage("Field notes");
            }}
            onAsk={() => setPage("Ask")}
          />
        ) : page === "Field notes" ? (
          <>
            {active && (
              <div className="actions project-toolbar">
                <button disabled={disabled} onClick={() => setEditing(active)}>
                  Edit project details
                </button>
                <button disabled={disabled} onClick={() => setPage("Ask")}>
                  Ask about this project
                </button>
              </div>
            )}
            <Notes
              key={`${bookId || "local"}:${selected}:${noteEpoch}`}
              workspace={workspace}
              selected={selected}
              onSelect={setSelected}
              onAdd={addNote}
              onAudio={addAudio}
              onRevise={(id, text) => updateNote(id, text, false)}
              onReview={(id) => updateNote(id, null, true)}
              captureBusy={disabled}
              onCaptureBusy={setCaptureBusy}
              draftScope={bookId || "local"}
              allowAudio={!remote}
            />
          </>
        ) : page === "Ask" ? (
          <>
            <header className="page-head">
              <div>
                <h1 title="Open a conversation about a project or a site note.">
                  Ask StreamLion
                </h1>
                <p>Choose a project, then open the chat.</p>
              </div>
            </header>
            <label>
              Project to discuss
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                title="Choose a project, or leave All projects selected to ask a general question."
              >
                <option value="">All projects</option>
                {workspace.jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
            </label>
            <ChatGPTPanel project={active} bookId={bookId} />
          </>
        ) : (
          <Connections
            bookId={bookId}
            onWorkbook={connectBook}
            onDisconnect={disconnect}
            busyCapture={disabled}
            onExport={() =>
              download(
                new Blob([exportWorkspace(local)], {
                  type: "application/json",
                }),
                "streamlion-workspace.json",
              )
            }
          />
        )}
      </main>
    </div>
  );
}
