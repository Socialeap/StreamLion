import React from "react";
import { requestProgress } from "./request-progress.js";
export default function RequestProgress({ job, link, activity, client }) {
  const steps = requestProgress(job, link, activity, client),
    done = steps.filter((s) => s.done).length;
  return (
    <section className="coord-progress" aria-label="Work-order progress">
      <div className="coord-state">
        <h3>Work-order progress</h3>
        <span>
          {done} of {steps.length} milestones recorded
        </span>
      </div>
      {["cancelled", "archived", "declined", "expired"].includes(job.state) && (
        <p>This request is {job.state}. Recorded milestones are retained.</p>
      )}
      {job.state === "declined" && (
        <p role="status">
          <strong>Request declined.</strong>{" "}
          {job.declineMessage ||
            "The provider is unable to accept this request."}{" "}
          {job.archiveAt &&
            `This page expires ${new Date(job.archiveAt).toLocaleDateString()}.`}
        </p>
      )}
      <div
        className="coord-progress-track"
        role="progressbar"
        aria-label="Recorded work-order milestones"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
      >
        <span style={{ width: `${(100 * done) / steps.length}%` }} />
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.key} className={s.done ? "complete" : "pending"}>
            <span className="coord-progress-number" aria-hidden="true">
              {s.done ? "✓" : i + 1}
            </span>
            <strong>{s.label}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <p className="coord-small">
        Payment can occur before or after work. Payment amounts are
        provider-reported; bank settlement is not connected.
      </p>
    </section>
  );
}
