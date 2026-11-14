import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { hydrateSettingsFromBackend } from "./lib/settingsSync";
import { startFitViewport } from "./lib/fitViewport";
import "katex/dist/katex.min.css";
import "./index.css";

startFitViewport();
hydrateSettingsFromBackend().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
