import { Outlet } from "react-router-dom";
import { useTour } from "../../context/TourContext";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { AdvanceStatusPanel } from "./AdvanceStatusPanel";

export function AppShell() {
  const { loading, error } = useTour();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface text-neutral-400">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-sm">Loading advance data…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface px-6 text-center text-neutral-400">
        <div className="max-w-md">
          <p className="text-sm font-medium text-status-missing">Could not load advance data</p>
          <p className="mt-2 text-sm text-neutral-500">{error}</p>
          <p className="mt-4 text-xs text-neutral-600">
            Start the API server with <code className="text-neutral-400">npm run dev</code> in{" "}
            <code className="text-neutral-400">/server</code>, then reload.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-[1024px] overflow-hidden bg-surface">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <div className="flex min-h-0 flex-1">
          <main className="oc-scrollbar min-w-0 flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
          <AdvanceStatusPanel />
        </div>
      </div>
    </div>
  );
}
