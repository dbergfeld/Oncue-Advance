import type { RecordStatus } from "../../types";
import { STATUS_CLASSES, STATUS_LABEL } from "../../utils/status";

export function StatusDot({ status, className = "" }: { status: RecordStatus; className?: string }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${STATUS_CLASSES[status].dot} ${className}`} />;
}

export function StatusBadge({ status, label }: { status: RecordStatus; label?: string }) {
  const classes = STATUS_CLASSES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${classes.badge}`}
    >
      <StatusDot status={status} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}
