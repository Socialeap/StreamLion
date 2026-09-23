import Building2 from "./BuildingIcon";
import { useEffect, useRef, useState } from "react";
import { FileText, NotebookPen, Link, Monitor, Download } from "lucide-react";
import Jobs, { JobForm } from "./Jobs";
import Notes from "./Notes";
import { emptyWorkspace, reviseNote, exportWorkspace } from "./model";
import {
  loadWorkspace,
  saveWorkspace,
  saveAudioNote,
  download,
} from "./storage";
export default function App() {
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const current = useRef(null);
  const writing = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Opening local workspace…");
  const [page, setPage] = useState("Jobs");
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  useEffect(() => {
    loadWorkspace()
      .then((data) => {
        current.current = data;
        setWorkspace(data);
        setSelected(data.jobs[0]?.id || "");
        setReady(true);
        setStatus("Saved on this device");
      })
      .catch((e) => {
        setError(
          `Cannot open local storage: ${e.message}. Please enable browser storage and reload. No data has been overwritten.`,
        );
        setStatus("Storage unavailable");
      });
  }, []);
  async function commit(change, audio) {
    if (!current.current) throw new Error("Local storage is not ready.");
    if (writing.current)
      throw new Error("Another save is in progress. Please retry.");
    writing.current = true;
    setStatus("Saving…");
    try {
      const next = {
        ...change(current.current),
        revision: (current.current.revision || 0) + 1,
      };
      if (audio) await saveAudioNote(next, audio.id, audio.blob);
      else await saveWorkspace(next);
      current.current = next;
      setWorkspace(next);
      setStatus("Saved on this device");
    } catch (e) {
      setStatus("Save failed — retry or export");
      throw e;
    } finally {
      writing.current = false;
    }
  }
  async function createJob(job) {
    await commit((w) => ({ ...w, jobs: [...w.jobs, job] }));
    setCreating(false);
    setSelected(job.id);
    setPage("Field notes");
  }
  async function addNote(note) {
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
  const navigate = (p) => {
    setCreating(false);
    setPage(p);
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!captureBusy) navigate("Jobs");
          }}
        >
          <Building2 size={34} strokeWidth={1.6} />
          <span>StreamLion</span>
        </a>
        <nav aria-label="Main">
          {[
            [FileText, "Jobs"],
            [NotebookPen, "Field notes"],
            [Link, "Connections"],
          ].map(([Icon, label]) => (
            <button
              key={label}
              disabled={captureBusy}
              className={page === label ? "active" : ""}
              onClick={() => navigate(label)}
              aria-current={page === label ? "page" : undefined}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="workspace-status">
          <Monitor size={19} />
          <span>
            Local workspace ·<br />
            <span role="status">{status}</span>
          </span>
        </div>
      </aside>
      <main>
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : !ready ? (
          <p role="status">Opening your workspace…</p>
        ) : page === "Jobs" ? (
          creating ? (
            <JobForm onSave={createJob} onCancel={() => setCreating(false)} />
          ) : (
            <Jobs
              workspace={workspace}
              onCreate={() => setCreating(true)}
              onOpen={(id) => {
                setSelected(id);
                setPage("Field notes");
              }}
            />
          )
        ) : page === "Field notes" ? (
          <Notes
            workspace={workspace}
            selected={selected}
            onSelect={setSelected}
            onAdd={addNote}
            onAudio={addAudio}
            captureBusy={captureBusy}
            onCaptureBusy={setCaptureBusy}
            onRevise={(id, text) =>
              commit((w) => ({
                ...w,
                notes: w.notes.map((n) =>
                  n.id === id
                    ? reviseNote(n, text, new Date().toISOString())
                    : n,
                ),
              }))
            }
            onReview={(id) =>
              commit((w) => ({
                ...w,
                notes: w.notes.map((n) =>
                  n.id === id ? { ...n, reviewed: true } : n,
                ),
              }))
            }
          />
        ) : (
          <>
            <header className="page-head">
              <div>
                <h1>Connections</h1>
                <p>Your workspace, your records.</p>
              </div>
            </header>
            <section className="connection">
              <div>
                <h2>Google Workspace</h2>
                <p>Sheets, Calendar, and Drive</p>
              </div>
              <span className="muted">Not connected</span>
            </section>
            <section className="connection">
              <div>
                <h2>AI and transcription</h2>
                <p>Voice interpretation and source-backed answers</p>
              </div>
              <span className="muted">Not connected</span>
            </section>
            <section className="export">
              <h2>Keep a copy of your work</h2>
              <p>
                This first version saves to this browser only. Browser data can
                be cleared or evicted. Export your jobs and notes regularly;
                download each voice memo separately.
              </p>
              <button
                onClick={() =>
                  download(
                    new Blob([exportWorkspace(workspace)], {
                      type: "application/json",
                    }),
                    "streamlion-workspace.json",
                  )
                }
              >
                <Download size={18} />
                Export jobs and notes
              </button>
              <p className="hint">
                Google sync, accounts, payments, and AI services are not enabled
                in this local pilot. Use synthetic data during validation.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
