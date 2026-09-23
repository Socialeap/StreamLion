import Building2 from "./BuildingIcon";
import { useState } from "react";
import {
  Plus,
  FileText,
  NotebookPen,
  DollarSign,
  ArrowRight,
} from "lucide-react";
import { feeCents } from "./model";
export function JobForm({ onSave, onCancel }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(event.currentTarget);
      const title = f.get("title").trim();
      if (!title) throw new Error("Enter a project name.");
      await onSave({
        id: crypto.randomUUID(),
        title,
        reference: f.get("reference").trim(),
        address: f.get("address").trim(),
        scope: f.get("scope"),
        offeredCents: feeCents(f.get("fee")),
        createdAt: new Date().toISOString(),
        status: "Planned",
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="editor">
      <h2>New job</h2>
      <p>Keep the original project ID and scope wording.</p>
      <form onSubmit={submit}>
        <label>
          Project name
          <input autoFocus name="title" required maxLength={160} />
        </label>
        <div className="form-row">
          <label>
            Project ID
            <input name="reference" maxLength={100} />
          </label>
          <label>
            Offered fee (USD)
            <input name="fee" inputMode="decimal" placeholder="Unknown" />
          </label>
        </div>
        <label>
          Site address
          <input name="address" maxLength={300} />
        </label>
        <label>
          Scope and access instructions
          <textarea name="scope" rows={4} maxLength={10000} />
        </label>
        <p className="hint">An offered fee is not an invoice or a payment.</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save job"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
export default function Jobs({ workspace, onCreate, onOpen }) {
  const total = workspace.jobs.reduce(
    (sum, job) => sum + (job.offeredCents ?? 0),
    0,
  );
  const metrics = [
    [FileText, workspace.jobs.length, "Active jobs"],
    [NotebookPen, workspace.notes.length, "Field notes"],
    [
      DollarSign,
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(total / 100),
      "Offered fees",
    ],
  ];
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Jobs</h1>
          <p>Your next capture starts here.</p>
        </div>
        <button className="primary" onClick={onCreate}>
          <Plus size={19} />
          New job
        </button>
      </header>
      <div className="metrics">
        {metrics.map(([Icon, value, label]) => (
          <div className="metric" key={label}>
            <span className="metric-icon">
              <Icon size={23} />
            </span>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          </div>
        ))}
      </div>
      {workspace.jobs.length === 0 ? (
        <section className="empty">
          <Building2 size={84} strokeWidth={1} />
          <h2>Ready for your first capture.</h2>
          <p>Add a job to keep scope and field notes together.</p>
          <button className="primary" onClick={onCreate}>
            Create a job
          </button>
        </section>
      ) : (
        <section className="job-list" aria-label="Jobs">
          {workspace.jobs.map((job) => (
            <button
              className="job-row"
              key={job.id}
              onClick={() => onOpen(job.id)}
            >
              <span className="job-icon">
                <Building2 />
              </span>
              <span>
                <strong>{job.title}</strong>
                <small>
                  {job.reference || "No project ID"} ·{" "}
                  {job.address || "Address not provided"}
                </small>
              </span>
              <span className="job-count">
                {workspace.notes.filter((n) => n.jobId === job.id).length} notes
              </span>
              <ArrowRight size={20} />
            </button>
          ))}
        </section>
      )}
    </>
  );
}
