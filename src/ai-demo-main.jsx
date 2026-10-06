import React from "react";
import { createRoot } from "react-dom/client";
import ProjectVoiceAnswers from "./ProjectVoiceAnswers.jsx";
import "./style.css";
import { applyTheme } from "./theme.js";
// This HTML is deliberately absent from Vite production build inputs.
if (import.meta.env.DEV) {
  applyTheme("dark");
  const project = {
    id: "synthetic-ai-demo",
    title: "Synthetic Harbor House",
    address: "123 Example Street",
    contact1Name: "Example Site Manager",
  };
  createRoot(document.getElementById("root")).render(
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 20 }}>
      <h1>StreamLion AI pilot demo</h1>
      <p>
        Development fixture only. No Google connection, provider keys, paid
        calls or credit spending. Enable Read answers aloud to hear device
        speech.
      </p>
      <ProjectVoiceAnswers
        project={project}
        source="device"
        scope="synthetic-ai-demo"
      />
    </main>,
  );
}
