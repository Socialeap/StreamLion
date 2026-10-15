import React from "react";
import { createRoot } from "react-dom/client";
import Purchase from "./Purchase.jsx";
import "./app-navigation.css";
import "./purchase.css";
import { preferredTheme, applyTheme } from "./theme.js";
applyTheme(preferredTheme());
createRoot(document.getElementById("root")).render(
  <div className="purchase-shell">
    <Purchase />
  </div>,
);
