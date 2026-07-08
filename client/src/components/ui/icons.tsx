import React from "react";

export type IconName =
  | "dashboard"
  | "map"
  | "venue"
  | "schedule"
  | "video"
  | "labor"
  | "power"
  | "rigging"
  | "signal"
  | "documents"
  | "notes"
  | "settings"
  | "warning"
  | "check"
  | "plus"
  | "chevronDown";

const paths: Record<IconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.2" />
      <rect x="14" y="3" width="7" height="5" rx="1.2" />
      <rect x="14" y="12" width="7" height="9" rx="1.2" />
      <rect x="3" y="16" width="7" height="5" rx="1.2" />
    </>
  ),
  map: (
    <>
      <path d="M9 3.5 3.5 5.5v15L9 18.5l6 2 5.5-2v-15l-5.5 2-6-2Z" />
      <path d="M9 3.5v15" />
      <path d="M15 5.5v15" />
    </>
  ),
  venue: (
    <>
      <path d="M4 21V7l8-4 8 4v14" />
      <path d="M9 21v-6h6v6" />
      <path d="M9 11h.01M15 11h.01M9 15h.01M15 15h.01" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="12" height="12" rx="1.5" />
      <path d="M15 10.5 21 7.5v9L15 13.5" />
    </>
  ),
  labor: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17.5" cy="9" r="2.3" />
      <path d="M21 20c0-2.6-1.8-4.8-4.2-5.6" />
    </>
  ),
  power: (
    <>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </>
  ),
  rigging: (
    <>
      <path d="M6 3v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V3" />
      <path d="M12 12v9" />
      <path d="M8 21h8" />
    </>
  ),
  signal: (
    <>
      <path d="M3 12h3l2.5-7L12 19l2.5-11L17 12h4" />
    </>
  ),
  documents: (
    <>
      <path d="M7 3h7l4 4v14H7Z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12.5h5M9.5 15.5h5M9.5 9.5h2" />
    </>
  ),
  notes: (
    <>
      <path d="M4 4h16v13l-4 3H4Z" />
      <path d="M8 9h8M8 12.5h8M8 16h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.55 1.55M17.55 17.55 19.1 19.1M3 12h2.2M18.8 12H21M4.9 19.1l1.55-1.55M17.55 6.45 19.1 4.9" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 9.5V14" />
      <path d="M12 17h.01" />
    </>
  ),
  check: <path d="m5 13 4 4L19 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
};

export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
