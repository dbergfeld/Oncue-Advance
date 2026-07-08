import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "../ui/icons";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/tour-stops", label: "Tour Stops", icon: "map" },
  { to: "/venue", label: "Venue Info", icon: "venue" },
  { to: "/schedule", label: "Schedule", icon: "schedule" },
  { to: "/video-package", label: "Video Package", icon: "video" },
  { to: "/labor", label: "Labor", icon: "labor" },
  { to: "/power", label: "Power", icon: "power" },
  { to: "/rigging", label: "Rigging", icon: "rigging" },
  { to: "/signal", label: "Signal", icon: "signal" },
  { to: "/documents", label: "Documents", icon: "documents" },
  { to: "/notes", label: "Notes", icon: "notes" },
];

export function Sidebar() {
  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-surface-border bg-surface-panel">
      <div className="flex h-14 items-center gap-2 border-b border-surface-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-accent text-surface">
          <span className="text-sm font-bold">OC</span>
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-neutral-50">OnCue</p>
          <p className="-mt-0.5 text-[10px] uppercase tracking-wider text-accent">Advance</p>
        </div>
      </div>

      <nav className="oc-scrollbar flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-accent/10 text-accent"
                      : "text-neutral-400 hover:bg-surface-raised hover:text-neutral-100"
                  }`
                }
              >
                <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-surface-border p-2">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              isActive
                ? "bg-accent/10 text-accent"
                : "text-neutral-400 hover:bg-surface-raised hover:text-neutral-100"
            }`
          }
        >
          <Icon name="settings" className="h-4 w-4 shrink-0" />
          Settings
        </NavLink>
      </div>
    </aside>
  );
}
