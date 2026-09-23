import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./style.css";
registerSW({
  onOfflineReady() {
    window.dispatchEvent(new Event("offline-ready"));
  },
});
createRoot(document.getElementById("root")).render(<App />);
