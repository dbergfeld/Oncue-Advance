import React from "react";
import type { Status } from "../../types";
import { StatusDot } from "./StatusBadge";

export function StatCard({
  label,
  value,
  sublabel,
  status,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
  status?: Status;
  icon?: React.ReactNode;
}) {
  return (
    <div className="oc-card p-4">
      <div className="flex items-center justify-between">
        <span className="oc-label mb-0">{label}</span>
        {status && <StatusDot status={status} />}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {icon}
        <span className="text-xl font-semibold text-neutral-50">{value}</span>
      </div>
      {sublabel && <p className="mt-1 text-xs text-neutral-500">{sublabel}</p>}
    </div>
  );
}
