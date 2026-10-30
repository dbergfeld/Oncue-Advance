import { useState } from "react";
import { engine } from "../../engine";
import { airtablePayload, importPullSheet } from "../../setup/importers";
import type { Check, Severity } from "../../store/types";
import { CheckCard, CopyText, Empty, Modal, PageHead, Panel, SevChip } from "../kit";
import { explain, useApp, useRecord, useWriter, isFrozen } from "../state";

const SEV: Severity[] = ["block", "warn", "info"];

export function BinderView() {
  const r = useRecord()!;
  const { ws, showId, toast } = useApp();
  const binder = useWriter("binder");
  const [tab, setTab] = useState<"cover" | "sections" | "checks" | "exports" | "revisions">("cover");
  const [exp, setExp] = useState<{ title: string; text: string } | null>(null);
  const [csv, setCsv] = useState("");
  const cover = engine.modules.find((m) => m.id === "binder")?.exports.find((e) => /cover/i.test(e.label));
  const draftMark = r.meta.status === "draft";

  return (
    <div className="grid gap-4 max-w-6xl">
      <PageHead title="Show Binder" sub="Composes every module's output into the advance packet. The only place checks are resolved." />
      <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
        {(["cover", "sections", "checks", "exports", "revisions"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-3 py-1.5 font-display uppercase tracking-wider ${tab === t ? "border-b-2 border-accent text-accent" : "text-dim"}`}>{t}</button>
        ))}
      </div>

      {tab === "cover" && (
        <Panel title="Cover page" actions={draftMark && <span className="font-display tracking-[0.3em] text-warn border-2 border-warn px-2">DRAFT</span>}>
          {cover ? <pre className="whitespace-pre-wrap font-body text-[13px] leading-relaxed">{cover.render(r)}</pre> : <Empty>Cover page export not available.</Empty>}
          <footer className="mt-4 pt-2 border-t border-line font-mono text-xs text-dim">{r.showCode} · {draftMark ? `REV ${r.meta.revision}-DRAFT` : `REV ${r.meta.revision}`} · {r.meta.updatedAt.slice(0, 16).replace("T", " ")}</footer>
        </Panel>
      )}

      {tab === "sections" && (
        <Panel title="Sections">
          {r.binder.sections.length === 0 ? <Empty>No sections yet. They are seeded when the show profile is applied.</Empty> : (
            <ul className="grid gap-2">
              {[...r.binder.sections].sort((a, b) => a.order - b.order).map((s) => {
                const pct = r.derived.binder.completeness[s.key] ?? r.derived.binder.completeness[s.id];
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 border border-line rounded-sm px-3 py-2 bg-raised">
                    <span className="font-mono text-xs text-dim w-6">{s.order}</span>
                    <span className="font-display uppercase tracking-wider flex-1 min-w-[8rem]">{s.key}{s.required && <span className="text-xs text-dim normal-case ml-2">required</span>}</span>
                    {pct !== undefined && <span className="font-mono text-xs">{Math.round(pct)}%</span>}
                    <span className="text-xs text-dim">{s.blocks.length} block(s)</span>
                    <label className="flex gap-1 items-center text-[13px]"><input type="checkbox" checked={s.visible} disabled={r.meta.status === "archived"}
                      onChange={(e) => binder([{ op: "replace", path: `/binder/sections/${s.id}/visible`, value: e.target.checked }], `binder: ${s.key} ${e.target.checked ? "shown" : "hidden"}`)} />visible</label>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {tab === "checks" && <Checks />}

      {tab === "exports" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Module exports">
            <ul className="grid gap-1">
              {engine.modules.flatMap((m) => m.exports.map((e) => ({ m, e }))).map(({ m, e }) => (
                <li key={m.id + e.key} className="flex justify-between gap-2 items-center">
                  <span><span className="font-mono text-xs text-dim mr-2">{m.id}</span>{e.label}</span>
                  <button className="btn" onClick={() => setExp({ title: e.label, text: e.render(r) })}>View</button>
                </li>
              ))}
            </ul>
          </Panel>
          <div className="grid gap-4 content-start">
            <Panel title="Airtable (Ground) mirror">
              <p className="text-dim mb-2 text-[13px]">One-way push of identity, devices, racks and open checks to base appzQEKX7O1IAi6KN. Airtable is a mirror, never a source. The payload below is what a push sends.</p>
              <button className="btn" onClick={() => setExp({ title: "Airtable payload", text: JSON.stringify(airtablePayload(r), null, 2) })}>Build payload</button>
            </Panel>
            <Panel title="RentalWorks pull sheet">
              <p className="text-dim mb-2 text-[13px]">Paste a pull-sheet CSV (I-Code, description, qty). Matched items become devices; unknown I-Codes land as unclassified devices with a check; a changed order raises warnings instead of editing the record.</p>
              <textarea id="rw-csv" className="inp font-mono text-xs w-full" rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"I-Code,Description,Qty\n100234,ROE CB5,24"} />
              <button className="btn mt-2" disabled={!csv.trim() || isFrozen(r)} onClick={() => {
                try { const res = importPullSheet(ws, showId!, csv) as unknown; toast("ok", `Imported pull sheet${res && typeof res === "object" && "matched" in res ? `: ${(res as { matched: number }).matched} matched` : ""}`); setCsv(""); }
                catch (e) { toast("error", (e as Error).message); }
              }}>Import</button>
            </Panel>
          </div>
        </div>
      )}

      {tab === "revisions" && (
        <Panel title="Issued revisions">
          {ws.revisions(showId!).length === 0 ? <Empty>Nothing issued yet. Rev 1 is produced by Issue advance.</Empty> : (
            <table className="tbl"><thead><tr><th>Rev</th><th>Issued</th><th>Open tasks at issue</th><th>Open warnings</th></tr></thead>
              <tbody>{ws.revisions(showId!).map((v) => (
                <tr key={v.rev}><td className="font-mono">REV {v.rev}</td><td className="font-mono text-xs">{v.issuedAt.slice(0, 16).replace("T", " ")}</td><td>{v.openTasks.length}</td>
                  <td>{v.record.binder.checks.filter((c) => !c.resolved && c.severity === "warn").length}</td></tr>
              ))}</tbody></table>
          )}
        </Panel>
      )}
      {exp && <Modal wide title={exp.title} onClose={() => setExp(null)}><CopyText text={exp.text} rows={20} /></Modal>}
    </div>
  );
}

function Checks() {
  const r = useRecord()!;
  const { ws, showId, toast } = useApp();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [resolving, setResolving] = useState<Check | null>(null);
  const [res, setRes] = useState<NonNullable<Check["resolution"]>>("fixed");
  const [note, setNote] = useState("");
  const list = r.binder.checks.filter((c) => filter === "all" || !c.resolved);
  return (
    <Panel title="Checks" actions={<>
      <select aria-label="Filter" className="inp" value={filter} onChange={(e) => setFilter(e.target.value as "open" | "all")}><option value="open">Open</option><option value="all">All</option></select>
    </>}>
      {SEV.map((s) => {
        const group = list.filter((c) => c.severity === s).sort((a, b) => a.code.localeCompare(b.code));
        if (!group.length) return null;
        return (
          <div key={s} className="mb-4">
            <h3 className="mb-2"><SevChip s={s} n={group.length} /></h3>
            <div className="grid gap-2">
              {group.map((c) => (
                <div key={c.id} className="grid gap-1">
                  <CheckCard c={c} />
                  {!c.resolved && <div><button className="btn text-xs" onClick={() => { setResolving(c); setRes(c.severity === "block" ? "fixed" : "accepted-risk"); setNote(""); }}>Resolve…</button></div>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {list.length === 0 && <Empty>No checks.</Empty>}
      <h3 className="label mt-4 mb-1">What the system does not validate</h3>
      <p className="text-[13px] text-dim">Internal device configuration, as-built cable runs and connector condition, rigging loads and structure, generator or house power availability, brightness and viewing distance, network bandwidth and switch configuration, content fit, and anything on a device with approximate specs beyond flagging it. A clean report is not a guarantee.</p>
      {resolving && (
        <Modal title={`Resolve ${resolving.code}`} onClose={() => setResolving(null)}>
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            const out = ws.api(showId!, "binder").resolveCheck(resolving.id, res, note);
            if (out.ok) { toast("ok", `${resolving.code} ${res}`); setResolving(null); } else toast("error", explain(out));
          }}>
            <p>{resolving.message}</p>
            <label className="grid gap-1"><span className="label">Resolution</span>
              <select id="resolve-kind" className="inp" value={res} onChange={(e) => setRes(e.target.value as typeof res)}>
                <option value="fixed">fixed</option>
                {resolving.severity !== "block" && <option value="accepted-risk">accepted risk</option>}
                <option value="not-applicable">not applicable</option>
              </select></label>
            <label className="grid gap-1"><span className="label">Annotation {res !== "fixed" && "(required)"}</span>
              <textarea id="resolve-note" className="inp" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required={res !== "fixed"} /></label>
            <p className="text-xs text-dim">Checks clear themselves when the record is fixed. A resolution stays with the check; if the condition clears and later comes back, it reopens.</p>
            <div><button className="btn btn-primary" type="submit">Resolve</button></div>
          </form>
        </Modal>
      )}
    </Panel>
  );
}
