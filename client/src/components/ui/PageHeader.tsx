import type { RecordStatus } from "../../types";
import { StatusBadge } from "./StatusBadge";
import { ProgressBar } from "./ProgressBar";

export function PageHeader({
  title,
  description,
  status,
  percent,
  saving,
}: {
  title: string;
  description?: string;
  status?: RecordStatus;
  percent?: number;
  saving?: boolean;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4 border-b border-surface-border pb-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-50">{title}</h1>
          {status && <StatusBadge status={status} />}
        </div>
        {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      </div>
      <div className="flex items-center gap-3">
        {saving && <span className="text-xs text-neutral-500">Saving…</span>}
        {typeof percent === "number" && (
          <div className="w-32 text-right">
            <span className="text-xs font-medium text-neutral-400">{percent}% complete</span>
            <ProgressBar percent={percent} className="mt-1.5" />
          </div>
        )}
      </div>
    </div>
  );
}
