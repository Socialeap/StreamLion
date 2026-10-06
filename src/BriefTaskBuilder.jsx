import { useState } from "react";
import { ListChecks } from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import { suggestTasks, appendReviewedTasks, READINGS } from "./brief-tasks.js";

const empty = {
  text: "",
  sourceName: "Pasted brief",
  suggestions: [],
  reviewed: false,
};
export default function BriefTaskBuilder({
  project,
  plan,
  onChange,
  onAdd,
  onBusy,
}) {
  const draft = plan.briefDraft || empty;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  function organize() {
    try {
      onChange({
        ...draft,
        suggestions: suggestTasks({ project, ...draft }),
        reviewed: false,
      });
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function read(file) {
    setLoading(true);
    onBusy?.(true);
    setError("");
    try {
      const { readBrief } = await import("./read-brief.js");
      onChange(await readBrief(file));
    } catch (e) {
      setError(
        e.message || "The brief could not be read. Paste its wording instead.",
      );
    } finally {
      setLoading(false);
      onBusy?.(false);
    }
  }
  function edit(id, values) {
    onChange({
      ...draft,
      reviewed: false,
      suggestions: draft.suggestions.map((item) =>
        item.id === id ? { ...item, ...values } : item,
      ),
    });
  }
  return (
    <section className="brief-builder" aria-label="Brief to site tasks">
      <p className="wizard-eyebrow">1. Organize · 2. Review · 3. Add</p>
      <SectionHeading icon={ListChecks} level={3}>
        Turn the brief into site tasks
      </SectionHeading>
      <p>
        Get separate capture, measurement, and delivery tasks. Check each
        suggestion beside the customer's exact wording.
      </p>
      <details open={!!draft.text}>
        <summary>Paste or choose a brief</summary>
        <label>
          Brief wording
          <textarea
            value={draft.text}
            maxLength={6000}
            rows={5}
            placeholder="Capture kitchen + lobby. Measure kitchen length and width. Deliver tour link and room readings."
            onChange={(e) => onChange({ ...empty, text: e.target.value })}
          />
        </label>
        <label>
          Choose a brief file
          <input
            type="file"
            accept=".txt,.pdf,text/plain,application/pdf"
            disabled={loading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) read(file);
            }}
          />
        </label>
        <small>
          Readable PDF or text, up to 5 MB. Reading happens on this device.
          Source passages go into your checklist when you save it.
        </small>
      </details>
      <div className="actions">
        <button onClick={organize} disabled={loading}>
          {loading
            ? "Reading brief…"
            : draft.text.trim()
              ? "Organize this brief"
              : "Build from project details"}
        </button>
        {(draft.text || draft.suggestions.length > 0) && (
          <button
            className="text-action"
            onClick={() => {
              onChange(undefined);
              setError("");
            }}
          >
            Clear brief review
          </button>
        )}
      </div>
      {project.exclusions && (
        <details>
          <summary>Check excluded work</summary>
          <p className="note-text">{project.exclusions}</p>
        </details>
      )}
      {draft.suggestions.length > 0 && (
        <>
          <div className="task-review-list">
            {draft.suggestions.map((item) => (
              <article className="task-suggestion" key={item.id}>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={(e) =>
                      edit(item.id, { selected: e.target.checked })
                    }
                  />
                  Include this task
                </label>
                <h4>
                  {item.label}
                  {item.area && <small> · {item.area}</small>}
                </h4>
                <blockquote>
                  <span>
                    {item.source.name}
                    {item.source.page && ` · page ${item.source.page}`}
                  </span>
                  {item.source.quote}
                </blockquote>
                <details>
                  <summary>Edit this suggestion</summary>
                  <label>
                    Task wording
                    <input
                      value={item.label}
                      maxLength={500}
                      onChange={(e) => edit(item.id, { label: e.target.value })}
                    />
                  </label>
                  <div className="task-review-fields">
                    <label>
                      Task type
                      <select
                        value={item.kind}
                        onChange={(e) =>
                          edit(item.id, {
                            kind: e.target.value,
                            reading:
                              e.target.value === "measurement"
                                ? item.reading || "Length"
                                : undefined,
                          })
                        }
                      >
                        <option value="capture">Capture</option>
                        <option value="measurement">Tape reading</option>
                        <option value="delivery">Delivery</option>
                        <option value="review">Other / confirm request</option>
                      </select>
                    </label>
                    <label>
                      Space / area
                      {item.kind === "measurement" ? " (required)" : ""}
                      <input
                        value={item.area}
                        maxLength={200}
                        onChange={(e) =>
                          edit(item.id, { area: e.target.value })
                        }
                      />
                    </label>
                    {item.kind === "measurement" && (
                      <label>
                        Reading needed
                        <select
                          value={item.reading || "Length"}
                          onChange={(e) =>
                            edit(item.id, { reading: e.target.value })
                          }
                        >
                          {READINGS.map((name) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </details>
              </article>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.reviewed}
              onChange={(e) =>
                onChange({ ...draft, reviewed: e.target.checked })
              }
            />
            I checked the selected tasks against the source, including
            exclusions.
          </label>
          <button
            className="primary"
            disabled={!draft.reviewed}
            onClick={() => {
              try {
                onAdd(appendReviewedTasks(plan.requirements, draft));
                setError("");
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Add reviewed tasks to checklist
          </button>
          <small>
            Existing checks and evidence stay in place. Matching tasks are added
            only once.
          </small>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
