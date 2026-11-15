import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ProspectIntake from "./ProspectIntake.jsx";
import RequestAssistant from "./RequestAssistant.jsx";
import { assistantSupported } from "./request-assistant.js";
import "./coordination.css";
import "./setup-assistant.css";
import "./request-assistant.css";
import "./provider-pricing.css";
import "./provider-branding.css";
import "./brief-privacy-notice.css";
import "./intake-embed.css";

const embedId = window.location.pathname.match(
  /^\/api\/intake-embed\/([A-Za-z0-9_-]{43})$/,
)?.[1];
const preview =
  new URLSearchParams(window.location.search).get("preview") === "1";

async function api(action, body, signal) {
  if (!embedId || !["public/open", "public/submit"].includes(action))
    throw new Error("This website form is unavailable. Contact the provider.");
  const response = await fetch(
    "/api/coordination/public/embed/" + action.split("/")[1],
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Reusable intake is anonymous even if the visitor has a StreamLion session.
      credentials: "omit",
      cache: "no-store",
      signal,
      body: JSON.stringify({ ...body, token: undefined, embedId }),
    },
  );
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(value.error || "This website form is unavailable."),
      {
        status: response.status,
        code: value.code,
      },
    );
  return value;
}

function EmbeddedIntake() {
  const [descriptor, setDescriptor] = useState(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("guided");
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api("public/open", { preview }, controller.signal)
      .then(setDescriptor)
      .catch((error) => {
        if (error.name !== "AbortError") setError(error.message);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!descriptor || window.parent === window) return;
    function closeOnEscape(event) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      for (const origin of descriptor.origins)
        window.parent.postMessage({ type: "streamlion:intake-close" }, origin);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [descriptor]);

  if (error)
    return (
      <main className="intake-embed-message" role="alert">
        {error}
      </main>
    );
  if (!descriptor)
    return (
      <main className="intake-embed-message" role="status">
        Loading project request…
      </main>
    );

  const formAPI = async (action, body) => {
    const result = await api(action, body);
    if (action === "public/open") setDescriptor(result);
    return result;
  };
  const changeMode = (next) => (answers) => {
    setDraft(answers);
    setMode(next);
  };
  const props = {
    descriptor,
    token: embedId,
    api: formAPI,
    initial: draft,
    preview,
    embedded: true,
  };
  return (
    <div className="intake-embed">
      {preview && (
        <p className="intake-embed-message" role="status">
          Preview · sample answers stay in this tab.
        </p>
      )}
      {mode === "guided" && assistantSupported(descriptor) ? (
        <RequestAssistant
          {...props}
          storage={null}
          onShowForm={changeMode("form")}
        />
      ) : (
        <main className="intake-embed-form">
          <ProspectIntake
            {...props}
            onShowAssistant={
              assistantSupported(descriptor) ? changeMode("guided") : undefined
            }
          />
        </main>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<EmbeddedIntake />);
