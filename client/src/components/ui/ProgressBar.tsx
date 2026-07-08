export function ProgressBar({ percent, className = "" }: { percent: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const color = clamped >= 100 ? "bg-status-confirmed" : clamped >= 50 ? "bg-accent" : clamped > 0 ? "bg-status-review" : "bg-status-idle";
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-border ${className}`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
