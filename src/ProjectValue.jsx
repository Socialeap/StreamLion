import {
  ClipboardCheck,
  Camera,
  FolderCheck,
  Clock3,
  ListChecks,
  RefreshCw,
} from "lucide-react";

export function ProjectWorkflow() {
  return (
    <ol className="project-workflow" aria-label="Shared project workflow">
      {[
        [
          ClipboardCheck,
          "Agree the work",
          "Areas, outputs and access instructions",
        ],
        [
          Camera,
          "Capture with clarity",
          "Work from the brief both sides approved",
        ],
        [
          FolderCheck,
          "Review the handover",
          "Progress, updates and delivery links together",
        ],
      ].map(([Icon, title, detail], index) => (
        <li key={title}>
          <span className="project-workflow-symbol" aria-hidden="true">
            <Icon size={25} />
          </span>
          <span className="project-workflow-step">0{index + 1}</span>
          <strong>{title}</strong>
          <span>{detail}</span>
        </li>
      ))}
    </ol>
  );
}

function ProjectBenefits({ client }) {
  return (
    <>
      <div className="project-benefits">
        {[
          [
            Clock3,
            "Fewer follow-up messages",
            client
              ? "Share what you need once, then keep questions and changes with the project."
              : "Keep client instructions and changes together, so you spend less time searching messages.",
          ],
          [
            ListChecks,
            "Clearer instructions",
            client
              ? "Review the areas, outputs and access details before the visit. Both sides approve the same brief."
              : "Confirm the areas, outputs and site access before the visit. Changes to the agreed work need fresh approval.",
          ],
          [
            RefreshCw,
            "A current shared record",
            client
              ? "Check the brief, progress and delivery links as your provider saves updates."
              : "Give your client one place to check the agreed work, progress and delivery links.",
          ],
        ].map(([Icon, title, text]) => (
          <article key={title}>
            <Icon size={22} aria-hidden="true" />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </div>
      <p className="project-sync-note">
        Saved updates refresh while the project page is open and connected.
        Changes may take time to appear. Unsubmitted drafts are not shared.
      </p>
    </>
  );
}
export default function ProjectValue({ client = false, compact = false }) {
  return (
    <section
      className={`project-value${compact ? " project-value-compact" : ""}`}
      aria-label={client ? "Your shared project" : "Why use a shared project?"}
    >
      <h2>
        {client
          ? "Clear expectations. Easier follow-up."
          : "Spend less time piecing the job together."}
      </h2>
      {compact ? (
        <details className="project-value-more">
          <summary>How a shared project helps</summary>
          <ProjectBenefits client={client} />
        </details>
      ) : (
        <>
          <ProjectBenefits client={client} />
          <ProjectWorkflow />
        </>
      )}
      {client && (
        <p className="project-client-free">
          Your invited project portal is free. You do not need to buy credits,
          create a StreamLion account or install an app.
        </p>
      )}
    </section>
  );
}
