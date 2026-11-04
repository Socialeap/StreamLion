import "./provider-pricing.css";
import "./provider-branding.css";
import React from "react";
import { createRoot } from "react-dom/client";
import IntakePreview from "./IntakePreview.jsx";
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
const root = createRoot(document.getElementById("root"));
if (new URLSearchParams(window.location.search).get("preview") === "intake") {
  root.render(<IntakePreview />);
} else {
  const updateSW = registerSW({
    onNeedRefresh() {
      offerUpdate(() => updateSW(true));
    },
  });
  root.render(
    <CoordinationPortal
      client={
        window.location.pathname.startsWith("/client") ||
        window.location.pathname.startsWith("/api/client-portal")
      }
    />,
  );
}
