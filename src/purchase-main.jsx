import React from "react";
import { createRoot } from "react-dom/client";
import Purchase from "./Purchase.jsx";
import "./purchase.css";
createRoot(document.getElementById("root")).render(
  <div className="purchase-shell">
    <Purchase />
  </div>,
);
