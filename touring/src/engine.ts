// The Engine the store runs on: the five registered modules, the device library, profiles, and store-level
// task / readiness / binder evaluation.
import { LIBRARY, library } from "./library/library";
import { binderModule } from "./modules/binder";
import { ledModule } from "./modules/led";
import { rackModule } from "./modules/rack";
import { serversModule } from "./modules/servers";
import { signalModule } from "./modules/signal/index";
import { profileFor } from "./store/profiles";
import { binderSummary, readiness } from "./store/readiness";
import { Workspace, type Engine, type Persist } from "./store/store";
import { deriveTasks } from "./store/tasks";

export const engine: Engine = {
  modules: [ledModule, signalModule, rackModule, serversModule, binderModule],
  library,
  libraryVersion: LIBRARY.libraryVersion,
  profileFor,
  deriveTasks,
  readiness,
  binderSummary,
};

/** A Workspace on the full engine, loaded from `persist` when given. */
export async function createWorkspace(persist?: Persist): Promise<Workspace> {
  const ws = new Workspace(engine, persist ?? null);
  await ws.load();
  return ws;
}
