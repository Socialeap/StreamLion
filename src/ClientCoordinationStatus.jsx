import React, { useEffect, useState } from "react";
export default function ClientCoordinationStatus({ project }) {
  const id = project.recordId || project.id;
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(
          "/api/coordination/provider/project?job=" + encodeURIComponent(id),
          { credentials: "same-origin" },
        );
        if (!response.ok) throw new Error("unavailable");
        const result = await response.json();
        if (active) setStatus(result);
      } catch {
        if (active)
          setStatus((previous) =>
            previous?.managed || id?.startsWith("job-")
              ? { managed: true, available: false }
              : null,
          );
      }
    }
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  if (!status?.managed) return null;
  const stale =
    !status.available ||
    status.pending ||
    status.projectRevision !== project.revisionId;
  return (
    <section className="sync-bar" aria-label="Client coordination status">
      <div>
        <strong>
          {stale
            ? "Verify the current client brief"
            : status.issues.length
              ? "Client updates need attention"
              : "Client brief checked"}
        </strong>
        <p>
          {stale
            ? "Live coordination or field synchronization is unverified. Resolve it before treating this job as ready."
            : status.issues.length
              ? status.issues.length +
                " question(s), proposal(s) or operational update(s) remain."
              : "Version " +
                status.revision +
                " · " +
                status.state.replaceAll("_", " ")}
        </p>
      </div>
      <a href={"/api/client-requests?job=" + encodeURIComponent(id)}>
        Review client request
      </a>
    </section>
  );
}
