import React from "react";
import { createRoot } from "react-dom/client";
import Credits from "./Credits.jsx";
import "./purchase.css";
createRoot(document.getElementById("root")).render(
  <div className="purchase-shell">
    <Credits />
  </div>,
);
