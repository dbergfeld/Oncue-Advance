import { useState } from "react";
import { StatusPill, SourceTag } from "./kit";
import { useApp, useRecord, VIEWS } from "./state";
import { ShowsView } from "./views/Shows";
import { OverviewView } from "./views/Overview";
import { AdvanceView } from "./views/Advance";
import { CrewView } from "./views/Crew";
import { LedView } from "./views/Led";
import { SignalView } from "./views/Signal";
import { RackView } from "./views/Rack";
import { ServersView } from "./views/Servers";
import { BinderView } from "./views/Binder";
import { ShowBookView } from "./views/ShowBook";
import { TasksView } from "./views/Tasks";
import { LibraryView } from "./views/Library";
import { ChangelogView } from "./views/Changelog";
import { Wizard } from "./views/Wizard";
import { Lifecycle } from "./views/Lifecycle";

export function App() {
  const { view, go, toasts, wizard, ephemeral } = useApp();
  const r = useRecord();
  const [navOpen, setNavOpen] = useState(false);
  const current = VIEWS.find((v) => v.id === view)!;
  const body = current.needsShow && !r ? <ShowsView /> : render(view);
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-raised border-b border-line" style={{ paddingLeft: "max(16px, env(safe-area-inset-left, 0px))", paddingRight: "max(16px, env(safe-area-inset-right, 0px))" }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
          <button className="btn md:hidden" onClick={() => setNavOpen(!navOpen)} aria-expanded={navOpen}>Menu</button>
          <button onClick={() => go("shows")} className="font-display text-xl font-bold uppercase tracking-wider leading-none">
            On Cue<span className="text-accent">:</span> Touring
          </button>
          {r && (
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <code className="font-mono font-medium">{r.showCode}</code>
              <span className="truncate max-w-[22rem] text-dim">{r.name || "Untitled show"}</span>
              <StatusPill r={r} />
              <SourceTag r={r} />
            </div>
          )}
          <div className="ml-auto flex flex-wrap gap-2 items-center">{r && <Lifecycle />}</div>
        </div>
      </header>
      {ephemeral && (
        <div className="bg-warn/15 text-[13px] py-1" style={{ paddingLeft: "max(16px, env(safe-area-inset-left, 0px))", paddingRight: "max(16px, env(safe-area-inset-right, 0px))" }}>
          Browser storage is unavailable here, so shows live only until this tab closes. Use Export to keep a copy.
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <nav className={`${navOpen ? "block" : "hidden"} md:block w-52 shrink-0 border-r border-line bg-panel py-3 absolute md:static z-20 h-full md:h-auto`}>
          <ul className="grid gap-px">
            {VIEWS.map((v) => (
              <li key={v.id}>
                <button disabled={v.needsShow && !r} onClick={() => { go(v.id); setNavOpen(false); }}
                  className={`w-full text-left px-4 py-1.5 font-display uppercase tracking-wider text-[15px] disabled:opacity-40 ${view === v.id ? "bg-raised text-accent border-l-4 border-accent pl-3" : "hover:bg-raised"}`}>
                  {v.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 min-w-0 py-5" style={{ paddingLeft: "max(16px, env(safe-area-inset-left, 0px))", paddingRight: "max(16px, env(safe-area-inset-right, 0px))" }}>
          {body}
        </main>
      </div>
      {wizard.open && <Wizard />}
      <div className="fixed bottom-4 right-4 z-50 grid gap-2 max-w-sm" style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`border rounded-sm px-3 py-2 shadow bg-raised text-[13px] ${t.kind === "error" ? "border-block text-block" : "border-ok"}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}

function render(view: string) {
  switch (view) {
    case "overview": return <OverviewView />;
    case "advance": return <AdvanceView />;
    case "crew": return <CrewView />;
    case "led": return <LedView />;
    case "signal": return <SignalView />;
    case "rack": return <RackView />;
    case "servers": return <ServersView />;
    case "binder": return <BinderView />;
    case "showbook": return <ShowBookView />;
    case "tasks": return <TasksView />;
    case "library": return <LibraryView />;
    case "changelog": return <ChangelogView />;
    default: return <ShowsView />;
  }
}
