import React, { useEffect, useState } from "react";
import RequestAssistant from "./RequestAssistant.jsx";
import ProspectIntake from "./ProspectIntake.jsx";

const storageKey = "streamlion-intake-preview";

export function openIntakePreview(snapshot) {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set("preview", "intake");
  const preview = window.open(url.href, "_blank");
  if (!preview) return false;
  function sendSnapshot(event) {
    if (event.origin !== window.location.origin ||
        event.source !== preview || event.data !== "intake-preview-ready") return;
    preview.postMessage({ intakePreview: snapshot }, window.location.origin);
    cleanup();
  }
  function cleanup() {
    window.removeEventListener("message", sendSnapshot);
    clearTimeout(timeout);
  }
  const timeout = setTimeout(cleanup, 15000);
  window.addEventListener("message", sendSnapshot);
  return true;
}

export default function IntakePreview() {
  const [snapshot, setSnapshot] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey));
    } catch {
      return null;
    }
  });
  const [guided, setGuided] = useState(true);
  const [seed, setSeed] = useState(null);
  const [selected, setSelected] = useState(snapshot?.selected ?? "");
  useEffect(() => {
    const source = window.opener;
    if (snapshot || !source) return;
    function receive(event) {
      const data = event.data?.intakePreview;
      if (event.origin !== window.location.origin || event.source !== source ||
          !Array.isArray(data?.forms)) return;
      setSelected(data.selected);
      setSnapshot(data);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(data));
      } catch {
        // The preview can still run in memory.
      }
      window.opener = null;
    }
    window.addEventListener("message", receive);
    source.postMessage("intake-preview-ready", window.location.origin);
    return () => window.removeEventListener("message", receive);
  }, [snapshot]);
  const form = snapshot?.forms.find(({ id }) => id === selected) ?? snapshot?.forms[0];

  return (
    <main className="coord-shell">
      <header className="coord-heading">
        <div>
          <h1>Sample forms</h1>
          <p>Try the client form. Sample answers stay in this tab.</p>
        </div>
      </header>
      {form ? (
        <>
          <section className="coord-card" aria-labelledby="sample-focus">
            <h2 id="sample-focus">{form.label}</h2>
            <p>All forms collect the core work-order details, including site, scope, access, and deliverables. Choose based on the details you need the client to provide.</p>
            <h3>Compare forms</h3>
            <div className="coord-form-comparison">
              {snapshot.forms.map(({ id, label, descriptor }) => (
                <button type="button" key={id} aria-pressed={id === form.id} className={id === form.id ? "is-selected" : undefined} onClick={() => {
                    if (id === form.id) return;
                    setSelected(id);
                    setSeed(null);
                  }}>
                  <strong>{label}{id === form.id && " · Viewing"}</strong>
                  <span>
                    {id === ""
                      ? "For general requests. Uses the standard fields without service-specific prompts."
                      : id === "preset:tm-spatial"
                        ? "For Matterport jobs where you need the receiving hosting account and handoff instructions. The handoff question is optional."
                        : descriptor.intake.description ||
                          "For jobs that need the service-specific questions configured in this template."}
                  </span>
                </button>
              ))}
            </div>
            {Boolean(form.descriptor.intake?.questions.length) && (
              <>
                <h3>What this form asks differently</h3>
                <ul>
                  {form.descriptor.intake.questions.map((question) => (
                    <li key={question.field}>
                      {question.label} · {question.required ? "Required" : "Optional"}
                      {question.when && " when shown based on another answer"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          {guided ? (
            <RequestAssistant
              key={form.id}
              initial={seed}
              descriptor={form.descriptor}
              token={form.id || "standard"}
              storage={null}
              preview
              onShowForm={(answers) => {
                setSeed(answers);
                setGuided(false);
              }}
            />
          ) : (
            <ProspectIntake
              key={form.id}
              descriptor={form.descriptor}
              initial={seed}
              preview
              onShowAssistant={(draft) => { setSeed(draft); setGuided(true); }}
            />
          )}
        </>
      ) : (
        <p>Open a new sample from Service &amp; intake in the invitation setup.</p>
      )}
    </main>
  );
}
