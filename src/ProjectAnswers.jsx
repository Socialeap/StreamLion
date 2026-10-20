import { MessageCircle } from "lucide-react";
import SectionHeading from "./SectionHeading.jsx";
import { PROJECT_FIELDS } from "./project-schema";
import { projectContext, readWorkflow } from "./workflow";
import ProjectVoiceAnswers from "./ProjectVoiceAnswers.jsx";
import { download } from "./storage";

export default function ProjectAnswers({
  project,
  notes = [],
  asOf = "Current device records",
  source = "device",
  scope,
  onBusy,
  onAISetup,
  compact = false,
  projectChooser,
  refreshProject,
}) {
  let snapshot = "",
    error = "";
  try {
    if (project)
      snapshot = JSON.stringify(
        projectContext(project, readWorkflow(notes, project), notes, asOf),
        null,
        2,
      );
  } catch (e) {
    error = e.message;
  }
  const exportPanel = (
    <>
      <h3>Project export</h3>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {snapshot && (
        <details className="quiet-details">
          <summary>Project snapshot and backup</summary>
          <p>
            This dated copy includes the project details and field notes for
            your records.
          </p>
          <button
            onClick={() =>
              download(
                new Blob([snapshot], { type: "application/json" }),
                "streamlion-project-snapshot.json",
              )
            }
          >
            Download project snapshot
          </button>
          <pre className="context-preview">{snapshot}</pre>
        </details>
      )}
      <p className="hint">
        Saved-detail lookup is free; managed AI answers use the displayed
        credits when enabled.
      </p>
    </>
  );
  if (compact) {
    if (!project)
      return (
        <section className="ask-empty">
          <h1>Choose your project</h1>
          {projectChooser}
          {refreshProject}
          <p>Open a project to ask by voice or type.</p>
        </section>
      );
    const fieldRecords = notes.filter((note) => note.jobId === project.id);
    return (
      <ProjectVoiceAnswers
        project={project}
        source={source}
        scope={scope}
        asOf={asOf}
        onBusy={onBusy}
        onAISetup={onAISetup}
        layout="workspace"
        projectPanel={projectChooser}
        contextPanel={
          <>
            {refreshProject}
            <p className="hint">
              {source === "google"
                ? "Selected Google project"
                : source === "copy"
                  ? "Saved Google copy"
                  : "Saved on this device"}{" "}
              · {asOf}
            </p>
            <dl className="ask-context-fields">
              {PROJECT_FIELDS.filter((field) => project[field.key]).map(
                (field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>{project[field.key]}</dd>
                  </div>
                ),
              )}
            </dl>
            <h3>Field records</h3>
            {fieldRecords.length ? (
              fieldRecords.map((note, index) => (
                <article key={note.id || index}>
                  <h4>
                    {note.area || "Unassigned area"} ·{" "}
                    {note.reviewed ? "Reviewed" : "Unreviewed"}
                  </h4>
                  <p>{note.text}</p>
                </article>
              ))
            ) : (
              <p>No field records saved.</p>
            )}
          </>
        }
        toolsPanel={exportPanel}
      />
    );
  }
  return (
    <section className="intake-panel chat-panel">
      <SectionHeading icon={MessageCircle} tone="violet">
        {project ? `Ask about ${project.title}` : "Choose a project above"}
      </SectionHeading>
      {project && (
        <>
          <ProjectVoiceAnswers
            project={project}
            source={source}
            scope={scope}
            asOf={asOf}
            onBusy={onBusy}
            onAISetup={onAISetup}
          />
        </>
      )}
      {project && exportPanel}
    </section>
  );
}
