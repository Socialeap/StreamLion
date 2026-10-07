import React from "react";
import { createRoot } from "react-dom/client";
import CoordinationPortal from "./CoordinationPortal.jsx";
import "./coordination.css";
createRoot(document.getElementById("root")).render(
  <CoordinationPortal
    client={
      window.location.pathname.startsWith("/client") ||
      window.location.pathname.startsWith("/api/client-portal")
    }
  />,
);
