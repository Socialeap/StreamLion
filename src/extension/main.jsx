import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { ExtensionWorkspace } from "./workspace.jsx";
const bridge = new App(
  { name: "StreamLion", version: "0.75.0" },
  { availableDisplayModes: ["fullscreen"] },
  { autoResize: false },
);
createRoot(document.getElementById("root")).render(
  <ExtensionWorkspace bridge={bridge} />,
);
