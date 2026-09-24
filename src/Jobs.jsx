import { useState } from "react";
import { Plus, FileText, NotebookPen } from "lucide-react";
import { searchProjects } from "./project-schema";

function visitDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date)
    : value;
}

export default function Jobs({
  workspace,
  drafts = [],
  archivedProjects = [],
  archivedDrafts = [],
  onCreate,
  onOpen,
  onAsk,
  onEdit,
  onResumeDraft,
  onDeleteDraft,
  onDeleteProject,
  onRestoreProject,
  onRestoreDraft,
}) {
  const [query, setQuery] = useState("");
  const rows = [
    ...drafts.map((draft) => ({
      ...draft.fields,
      id: `${draft.scope}:${draft.draftId}`,
      kind: "unsaved",
      draft,
    })),
    ...workspace.jobs.map((project) => ({ ...project, kind: "saved" })),
  ];
  const filtered = searchProjects(rows, query);
  const pendingCount = rows.filter(
    (row) => row.kind === "unsaved" || row.reviewState !== "reviewed",
  ).length;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Find a project, finish a draft, or start a new one.</p>
        </div>
        <div className="actions">
          <button
            onClick={onAsk}
            title="Open a ChatGPT conversation with StreamLion to ask about your projects."
          >
            Ask in ChatGPT
          </button>
          <button
            className="primary"
            onClick={onCreate}
            title="Start a new project. Your unfinished named projects remain in this list."
          >
            <Plus size={18} />
            Create project
          </button>
        </div>
      </header>
      <div className="metrics">
        <div className="metric">
          <FileText />
          <div>
            <strong>{rows.length}</strong>
            <span>Projects and named drafts</span>
          </div>
        </div>
        <div className="metric">
          <NotebookPen />
          <div>
            <strong>{workspace.notes.length}</strong>
            <span>Field annotations</span>
          </div>
        </div>
        <div className="metric">
          <div>
            <strong>{pendingCount}</strong>
            <span>Details pending review</span>
          </div>
        </div>
      </div>
      <label className="search">
        Find a project
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, city, project ID, company…"
        />
      </label>
      {!filtered.length ? (
        <section className="empty">
          <h2>
            {query ? "No matching projects" : "Prepare your next capture"}
          </h2>
          <p>
            {query
              ? "Try fewer words or ask StreamLion in ChatGPT."
              : "Upload your brief in ChatGPT, or start with a manual project."}
          </p>
          {!query && (
            <button className="primary" onClick={onCreate}>
              Create project
            </button>
          )}
        </section>
      ) : (
        <section className="project-list" aria-label="Projects">
          <table className="project-table">
            <thead>
              <tr>
                <th scope="col">Project name</th>
                <th scope="col">City</th>
                <th scope="col">Visit date</th>
                <th
                  scope="col"
                  title="Completed means project details were reviewed. It does not mean the site work is finished."
                >
                  Details
                </th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const unsaved = row.kind === "unsaved";
                const edit = () =>
                  unsaved ? onResumeDraft(row.draft) : onEdit(row);
                return (
                  <tr key={row.id}>
                    <td data-label="Project name">
                      <button
                        className="project-name-button"
                        onClick={unsaved ? edit : () => onOpen(row.id)}
                        title={
                          unsaved
                            ? "Resume this unfinished project."
                            : "Open this project's field notes."
                        }
                      >
                        {row.title}
                      </button>
                      <small>
                        {unsaved
                          ? row.draft.scope === "local"
                            ? "Saved on this device only"
                            : "Unfinished Google project on this device"
                          : row.reference || "No project ID"}
                      </small>
                    </td>
                    <td data-label="City">{row.city || "Not set"}</td>
                    <td data-label="Visit date">{visitDate(row.startLocal)}</td>
                    <td data-label="Details">
                      <span
                        className={`project-status ${row.reviewState === "reviewed" ? "complete" : "pending"}`}
                        title="This describes the project details, not whether the site work is finished."
                      >
                        {row.reviewState === "reviewed"
                          ? "Completed"
                          : "Pending"}
                      </span>
                    </td>
                    <td data-label="Actions">
                      <div className="project-row-actions">
                        <button onClick={edit} title={`Edit ${row.title}`}>
                          Edit
                        </button>
                        <button
                          onClick={() =>
                            unsaved
                              ? onDeleteDraft(row.draft)
                              : onDeleteProject(row)
                          }
                          title={`Move ${row.title} to Deleted projects. You can restore it later.`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {archivedProjects.length + archivedDrafts.length > 0 && (
        <details className="deleted-projects">
          <summary>
            Deleted projects ({archivedProjects.length + archivedDrafts.length})
          </summary>
          <p>
            These projects and their field notes are kept so you can restore
            them.
          </p>
          {archivedDrafts.map((draft) => (
            <div
              className="deleted-project-row"
              key={`${draft.scope}:${draft.draftId}`}
            >
              <span>
                {draft.fields.title} <small>Unfinished draft</small>
              </span>
              <button
                onClick={() => onRestoreDraft(draft)}
                title={`Restore ${draft.fields.title} to the Projects list.`}
              >
                Restore
              </button>
            </div>
          ))}
          {archivedProjects.map((project) => (
            <div className="deleted-project-row" key={project.id}>
              <span>{project.title}</span>
              <button
                onClick={() => onRestoreProject(project)}
                title={`Restore ${project.title} to the Projects list.`}
              >
                Restore
              </button>
            </div>
          ))}
        </details>
      )}
    </>
  );
}
