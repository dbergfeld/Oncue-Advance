import { useEffect, useState, type ReactNode } from "react";
import type { Check, ConfirmState, Severity, ShowRecord, TaskStatus } from "../store/types";
import { useApp, type View } from "./state";

export function SevChip({ s, n }: { s: Severity; n?: number }) {
  const cls = s === "block" ? "bg-block/15 text-block border-block/40" : s === "warn" ? "bg-warn/15 text-warn border-warn/40" : "bg-info/10 text-info border-info/30";
  return <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 text-[11px] font-mono uppercase leading-5 ${cls}`}>{s}{n !== undefined && <b>{n}</b>}</span>;
}

export function StatusPill({ r }: { r: ShowRecord }) {
  const s = r.meta.status;
  const txt = s === "draft" ? `REV ${r.meta.revision}-DRAFT` : s === "issued" ? `REV ${r.meta.revision}` : s === "locked" ? `REV ${r.meta.revision} · LOCKED` : "ARCHIVED";
  const cls = s === "draft" ? "border-warn text-warn" : s === "issued" ? "border-ok text-ok" : s === "locked" ? "border-info text-info" : "border-dim text-dim";
  return <span className={`font-display font-semibold tracking-widest text-xs border-2 rounded-sm px-1.5 py-px ${cls}`}>{txt}</span>;
}

export function SourceTag({ r }: { r: ShowRecord }) {
  if (r.meta.source !== "example" && r.meta.source !== "template") return null;
  return <span className="font-display text-xs uppercase tracking-widest bg-info/15 text-info px-1.5 rounded-sm">{r.meta.source} · read-only</span>;
}

const CONFIRM_STYLE: Record<ConfirmState, string> = {
  unknown: "border-line text-dim", asked: "border-info/60 text-info", assumed: "border-warn/60 text-warn",
  confirmed: "border-ok/60 text-ok", waived: "border-line text-dim line-through",
};
export function ConfirmChip({ s }: { s: ConfirmState }) {
  return <span className={`inline-block border rounded-sm px-1.5 text-[11px] font-mono leading-5 ${CONFIRM_STYLE[s]}`}>{s === "assumed" ? "≈ assumed" : s}</span>;
}

const TASK_STYLE: Record<TaskStatus, string> = {
  todo: "text-dim border-line", doing: "text-info border-info/50", blocked: "text-block border-block/50", done: "text-ok border-ok/50", na: "text-dim border-line line-through",
};
export function TaskChip({ s }: { s: TaskStatus }) {
  return <span className={`inline-block border rounded-sm px-1.5 text-[11px] font-mono leading-5 ${TASK_STYLE[s]}`}>{s}</span>;
}

export function Panel({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-raised border border-line rounded-sm min-w-0 ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-2 justify-between px-3 py-2 border-b border-line">
          <h2 className="font-display text-base font-semibold uppercase tracking-wider">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-3 min-w-0">{children}</div>
    </section>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide leading-none">{title}</h1>
        {sub && <div className="text-dim mt-1">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, unit, approx }: { label: string; value: ReactNode; unit?: string; approx?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="font-mono text-lg leading-tight">{approx && <span title="Includes approximate specs" className="text-warn">≈</span>}{value}{unit && <span className="text-dim text-sm ml-0.5">{unit}</span>}</div>
    </div>
  );
}

/** Commit-on-blur text/number input so each keystroke is not a patch. */
export function Edit({ value, onCommit, type = "text", className = "", disabled, placeholder, id }: {
  value: string | number | null | undefined; onCommit(v: string): void; type?: string; className?: string; disabled?: boolean; placeholder?: string; id?: string;
}) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <input id={id} className={`inp ${className}`} type={type} value={v} disabled={disabled} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (String(v) !== String(value ?? "")) onCommit(String(v)); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

export function CheckCard({ c, compact }: { c: Check; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { go } = useApp();
  const stripe = c.severity === "block" ? "border-l-block" : c.severity === "warn" ? "border-l-warn" : "border-l-info";
  return (
    <div className={`border border-line border-l-4 ${stripe} rounded-sm bg-raised px-3 py-2 min-w-0 ${c.resolved ? "opacity-60" : ""}`}>
      <button className="w-full text-left flex flex-wrap gap-x-2 gap-y-1 items-baseline" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="font-mono text-xs text-dim">{c.code}</span>
        <span className="font-semibold">{c.title}</span>
        <SevChip s={c.severity} />
        {c.resolved && <span className="text-xs text-ok font-mono">{c.resolution}</span>}
      </button>
      <p className="mt-1 text-[13px]">{c.message}</p>
      {open && !compact && (
        <div className="mt-2 grid gap-2 text-[13px]">
          {c.rule && <div><span className="label mr-2">Rule</span>{c.rule}</div>}
          {c.evidence?.length > 0 && (
            <div><div className="label">Evidence</div>
              <ul className="mt-1 grid gap-0.5">{c.evidence.map((e, i) => <li key={i} className="flex flex-wrap gap-x-2"><span>{e.label}</span><b className="font-mono">{e.value}</b><code className="text-dim text-xs">{e.path}</code></li>)}</ul>
            </div>
          )}
          {c.fixes?.length > 0 && (
            <div><div className="label">What would clear it</div>
              <ol className="mt-1 list-decimal pl-5 grid gap-0.5">{c.fixes.map((f, i) => (
                <li key={i}>{f.label} <button className="text-accent underline text-xs ml-1" onClick={() => go(moduleView(f.module))}>{moduleName(f.module)}</button></li>
              ))}</ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function moduleView(m: string): View {
  return ({ led: "led", signal: "signal", rack: "rack", servers: "servers", binder: "binder", shell: "advance", store: "overview", crew: "crew", advance: "advance" } as Record<string, View>)[m] ?? "overview";
}
export function moduleName(m: string): string {
  return ({ led: "LED Map & Power", signal: "Signal Flow", rack: "Rack Build", servers: "Media Servers", binder: "Show Binder", shell: "Advance", store: "Store", crew: "Crew", advance: "Advance" } as Record<string, string>)[m] ?? m;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 bg-ink/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className={`bg-bg border border-line rounded-sm shadow-xl w-full ${wide ? "max-w-5xl" : "max-w-2xl"} my-8`} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-2 border-b border-line">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">{title}</h2>
          <button className="btn" onClick={onClose} aria-label="Close">Close</button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** Downloads are blocked inside the artifact viewer, so exports are shown as copyable text. */
export function CopyText({ text, rows = 14, filename }: { text: string; rows?: number; filename?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2 items-center">
        {filename && <code className="text-xs text-dim">{filename}</code>}
        <button className="btn" onClick={(e) => {
          const ta = (e.currentTarget.parentElement?.nextElementSibling as HTMLTextAreaElement | null);
          navigator.clipboard?.writeText(text).then(() => setCopied(true), () => { ta?.select(); });
        }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <textarea readOnly className="inp font-mono text-xs w-full" rows={rows} value={text} onFocus={(e) => e.target.select()} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-dim border border-dashed border-line rounded-sm p-4 text-center">{children}</div>;
}

export function fmt(n: number | undefined | null, d = 0): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
}
