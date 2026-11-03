// These are the already displayed project fields, not model-generated citations.
export default function BriefComparison({ project }) {
  const fields = [
    ["Requested work", project?.scope],
    ["Exclusions", project?.exclusions],
    ["Deliverables", project?.deliverables],
    ["Additional notes", project?.notes],
    ["Questions to resolve", project?.unresolved],
  ].filter(([, value]) => typeof value === "string" && value.trim());
  if (!fields.length) return null;
  return (
    <details className="quiet-details brief-comparison">
      <summary>Compare with this project brief</summary>
      <p className="hint">
        These displayed details are not exact AI citations. They may differ from
        the records read for this answer; refresh the project to check the
        latest wording.
      </p>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
