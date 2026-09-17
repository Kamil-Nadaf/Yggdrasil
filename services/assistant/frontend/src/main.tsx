import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { hydrateSettingsFromBackend } from "./lib/settingsSync";
import "katex/dist/katex.min.css";
import "./index.css";

hydrateSettingsFromBackend().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
