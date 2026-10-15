import React from "react";
import { createRoot } from "react-dom/client";
import Credits from "./Credits.jsx";
import "./app-navigation.css";
import "./purchase.css";
import { preferredTheme, applyTheme } from "./theme.js";
applyTheme(preferredTheme());
createRoot(document.getElementById("root")).render(
  <div className="purchase-shell">
    <Credits />
  </div>,
);
