import React from "react";
import { createRoot } from "react-dom/client";
import ChatGPTPanel from "./ChatGPTPanel.jsx";
import {
  FileText,
  NotebookPen,
  Ruler,
  MessageCircle,
  Link,
} from "lucide-react";
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
    scope:
      "Measure the retail area's length, width and ceiling height to fractional inches.",
  };
  createRoot(document.getElementById("root")).render(
    <div className="app app-ask">
      <aside className="sidebar">
        <div className="brand">
          <img src="/lion.png" width="32" height="32" alt="" />
          <span>StreamLion</span>
        </div>
        <small className="hint">Local demo · no providers or charges</small>
        <nav aria-label="Main">
          {[
            [FileText, "Projects"],
            [NotebookPen, "Field notes"],
            [Ruler, "Measure"],
            [MessageCircle, "Ask"],
            [Link, "Connections"],
          ].map(([Icon, label]) => (
            <button
              key={label}
              className={label === "Ask" ? "active" : ""}
              disabled={label !== "Ask"}
              title="Isolated Ask demo"
            >
              <Icon size={20} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        <ChatGPTPanel
          compact
          project={project}
          source="device"
          scope="synthetic-ai-demo"
          projectChooser={
            <label>
              Project to discuss
              <select defaultValue={project.id}>
                <option value={project.id}>{project.title}</option>
              </select>
            </label>
          }
        />
      </main>
    </div>,
  );
}
