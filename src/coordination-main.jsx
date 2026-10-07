import React from "react";
import { createRoot } from "react-dom/client";
import CoordinationPortal from "./CoordinationPortal.jsx";
import "./coordination.css";
import { registerSW } from "virtual:pwa-register";
import { offerUpdate } from "./updates.js";
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
