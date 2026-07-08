import type { Status } from "../../types";
import { STATUS_LABEL } from "../../utils/status";
import { StatusDot } from "./StatusBadge";

const STATUS_OPTIONS: Status[] = ["confirmed", "needs-review", "missing", "not-started"];

export function StatusSelect({
  value,
  onChange,
  label,
  className = "",
}: {
  value: Status;
  onChange: (value: Status) => void;
  label?: string;
  className?: string;
}) {
  const select = (
    <div className="relative">
      <select
        className="oc-select min-w-[8.5rem] py-1.5 pl-6 pr-6 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value as Status)}
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <StatusDot status={value} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" />
    </div>
  );

  if (!label) return <div className={className}>{select}</div>;

  return (
    <label className={`block ${className}`}>
      <span className="oc-label">{label}</span>
      {select}
    </label>
  );
}
