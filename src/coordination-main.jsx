import "./provider-pricing.css";
import "./provider-branding.css";
import React from "react";
import { createRoot } from "react-dom/client";
import CoordinationPortal from "./CoordinationPortal.jsx";
import "./coordination.css";
import "./setup-assistant.css";
import "./request-assistant.css";
import "./brief-privacy-notice.css";
import "./app-navigation.css";
import { preferredTheme, applyTheme } from "./theme.js";
import { registerSW } from "virtual:pwa-register";
import { offerUpdate } from "./updates.js";
applyTheme(preferredTheme());
const updateSW = registerSW({
  onNeedRefresh() {
    offerUpdate(() => updateSW(true));
  },
});
createRoot(document.getElementById("root")).render(
  <CoordinationPortal
    client={
      window.location.pathname.startsWith("/client") ||
      window.location.pathname.startsWith("/api/client-portal")
    }
  />,
);
