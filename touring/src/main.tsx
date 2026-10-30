import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { engine } from "./engine";
import { indexedDbPersist } from "./store/persist";
import { Workspace } from "./store/store";
import { loadExample } from "./setup/example";
import { App } from "./ui/App";
import { AppProvider } from "./ui/state";

async function boot() {
  const persist = await indexedDbPersist().catch(() => null);
  const ws = new Workspace(engine, persist);
  ws.devGuard = import.meta.env.DEV;
  try { await ws.load(); } catch (e) { console.warn("could not load saved shows", e); }
  if (ws.list().length === 0) loadExample(ws);
  const ephemeral = !persist || "ephemeral" in persist;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProvider ws={ws} ephemeral={ephemeral}><App /></AppProvider>
    </StrictMode>,
  );
}
boot();
