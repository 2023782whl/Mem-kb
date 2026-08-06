import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppProviders } from "./shared/AppProviders";
import "antd/dist/reset.css";
import "./styles.css";
import "./enterprise.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders><App /></AppProviders>
  </React.StrictMode>
);
