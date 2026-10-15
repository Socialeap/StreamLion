import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./purchase.css";
import { offerUpdate } from "./updates.js";
import "./style.css";
import { preferredTheme, applyTheme } from "./theme.js";
import { startInstallListening } from "./installation.js";
// Capture eligibility even when it arrives before the license/session reads finish.
startInstallListening();
applyTheme(preferredTheme());
const updateSW = registerSW({
  onNeedRefresh() {
    offerUpdate(() => updateSW(true));
  },
  onOfflineReady() {
    window.dispatchEvent(new Event("offline-ready"));
  },
});
createRoot(document.getElementById("root")).render(<App />);
