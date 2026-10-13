import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { App } from "./App";
import { AppProvider } from "./context";
import { loadRuntime } from "./config";
import type { Runtime } from "./types";
import "./style.css";
function Boot() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [error, setError] = useState("");
  useEffect(() => {
    void loadRuntime().then(setRuntime, (e) => setError(e.message));
  }, []);
  if (error)
    return (
      <main className="boot">
        <h1>Handlers In Control</h1>
        <p role="alert">{error}</p>
        <button onClick={() => location.reload()}>Reload deployment</button>
      </main>
    );
  if (!runtime)
    return (
      <main className="boot">
        <h1>Handlers In Control</h1>
        <p role="status">Loading the deployment record…</p>
      </main>
    );
  return (
    <AppProvider runtime={runtime}>
      <App />
    </AppProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Boot />);
