import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/globals.css";
import "./i18n";
import { NotchWindow } from "./windows/notch/NotchWindow";
import { SettingsWindow } from "./windows/settings/SettingsWindow";

// One HTML entry serves every window; the Tauri window label picks the UI.
function resolveLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    // Plain browser (vite dev without Tauri).
    return new URLSearchParams(window.location.search).get("window") ?? "notch";
  }
}

const Root = resolveLabel() === "settings" ? SettingsWindow : NotchWindow;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
