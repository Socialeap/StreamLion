import { useState } from "react";
import { Plus, ArrowRight, FileText, NotebookPen } from "lucide-react";
import { searchProjects } from "./project-schema";
export default function Jobs({ workspace, onCreate, onOpen, onAsk }) {
  const [query, setQuery] = useState("");
  const jobs = searchProjects(workspace.jobs, query);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Projects</h1>
          <p>From the first brief to the final site note.</p>
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
            title="Start a project using ChatGPT or enter the details yourself."
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
            <strong>{workspace.jobs.length}</strong>
            <span>Projects</span>
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
            <strong>
              {
                workspace.jobs.filter((j) => j.reviewState !== "reviewed")
                  .length
              }
            </strong>
            <span>Awaiting review</span>
          </div>
        </div>
      </div>
      <label className="search">
        Find a project
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Project ID, company, address, scope…"
        />
      </label>
      {!jobs.length ? (
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
            <button
              className="primary"
              onClick={onCreate}
              title="Start a project using ChatGPT or enter the details yourself."
            >
              Create project
            </button>
          )}
        </section>
      ) : (
        <section className="job-list" aria-label="Projects">
          {jobs.map((j) => (
            <button key={j.id} className="job-row" onClick={() => onOpen(j.id)}>
              <FileText />
              <span>
                <strong>{j.title}</strong>
                <small>
                  {j.reference || "No project ID"} ·{" "}
                  {j.companyName || j.address || "Details pending"}
                </small>
              </span>
              <span className="job-count">
                {j.reviewState === "reviewed" ? "Reviewed" : "Draft"}
              </span>
              <ArrowRight size={18} />
            </button>
          ))}
        </section>
      )}
    </>
  );
}
