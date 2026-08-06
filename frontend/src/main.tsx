import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import { AppProviders } from "./shared/AppProviders";
import "antd/dist/reset.css";
import "./styles.css";
import "./enterprise.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider><AppProviders><App /></AppProviders></I18nProvider>
  </React.StrictMode>
);
