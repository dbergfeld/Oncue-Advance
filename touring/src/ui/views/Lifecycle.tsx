import { useState } from "react";
import { CopyText, Modal } from "../kit";
import { explain, useApp, useRecord } from "../state";

export function Lifecycle() {
  const { ws, showId, toast, setShowId, go } = useApp();
  const r = useRecord();
  const [ask, setAsk] = useState<null | "revise" | "unlock">(null);
  const [reason, setReason] = useState("");
  const [exp, setExp] = useState<{ filename: string; json: string } | null>(null);
  if (!r || !showId) return null;
  const s = r.meta.status;
  const example = r.meta.source === "example" || r.meta.source === "template";
  const ready = r.derived.readiness?.advance;
  const run = (fn: () => { ok: boolean; errors?: { code: string; path: string; msg: string }[]; rev: number }, ok: string) => {
    const res = fn();
    if (res.ok) toast("ok", ok); else toast("error", explain(res));
  };
  return (
    <>
      {example && <button className="btn btn-primary" onClick={() => { const c = ws.copyShow(showId); setShowId(c.showId); go("overview"); toast("ok", `Copied to ${c.showCode}`); }}>Copy to new show</button>}
      {s === "draft" && !example && (
        <button className="btn btn-primary" disabled={!ready} title={ready ? "Freeze this revision and publish to crew" : "Not advance-ready: see Overview"}
          onClick={() => run(() => ws.issueShow(showId), `Issued REV ${r.meta.revision}`)}>Issue advance</button>
      )}
      {(s === "issued" || s === "locked") && <button className="btn" onClick={() => { setAsk("revise"); setReason(""); }}>Revise</button>}
      {s === "issued" && <button className="btn" onClick={() => run(() => ws.lockShow(showId), "Locked for load-in")}>Lock at load-in</button>}
      {s === "locked" && <button className="btn" onClick={() => { setAsk("unlock"); setReason(""); }}>Unlock</button>}
      {s !== "archived" && !example && <button className="btn" onClick={() => run(() => ws.archiveShow(showId), "Archived")}>Archive</button>}
      <button className="btn" onClick={() => setExp(ws.exportRecord(showId))}>Export</button>
      {ask && (
        <Modal title={ask === "revise" ? `Start REV ${r.meta.revision + 1}` : "Unlock show"} onClose={() => setAsk(null)}>
          <form className="grid gap-3" onSubmit={(e) => {
            e.preventDefault();
            if (ask === "revise") run(() => ws.reviseShow(showId, reason), `REV ${r.meta.revision + 1} draft started`);
            else run(() => ws.unlockShow(showId, reason), "Unlocked");
            setAsk(null);
          }}>
            <label className="grid gap-1"><span className="label">Reason (goes in the changelog)</span>
              <input id="lifecycle-reason" className="inp" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus /></label>
            <div><button className="btn btn-primary" type="submit">{ask === "revise" ? "Start revision" : "Unlock"}</button></div>
          </form>
        </Modal>
      )}
      {exp && <Modal title="Export show" onClose={() => setExp(null)}><p className="mb-2 text-dim">Full record plus issued revisions. Save it as the file name shown, or paste it into Import on another machine.</p><CopyText text={exp.json} filename={exp.filename} /></Modal>}
    </>
  );
}
