import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { offerUpdate } from "./updates.js";
import "./style.css";
const updateSW = registerSW({
  onNeedRefresh() {
    offerUpdate(() => updateSW(true));
  },
  onOfflineReady() {
    window.dispatchEvent(new Event("offline-ready"));
  },
});
createRoot(document.getElementById("root")).render(<App />);
