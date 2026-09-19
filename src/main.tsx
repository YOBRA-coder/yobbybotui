// main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";

// Prints in the browser DevTools console the instant the app loads.
// Compare this against GET /health's "build" field on the backend — if
// either shows an older tag than expected after a deploy, that half of
// the stack is still running old code (a hard browser refresh / cache
// clear, or a full backend process restart, is needed — re-uploading
// files alone doesn't reload either).
console.log("[NexusAI build] 2026-graduated-confidence-oco-concurrent-positions");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
  </React.StrictMode>
);
