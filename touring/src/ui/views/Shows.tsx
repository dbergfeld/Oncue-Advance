import { useState } from "react";
import { loadExample } from "../../setup/example";
import { Empty, Modal, PageHead, Panel } from "../kit";
import { useApp, useWorkspaceVersion } from "../state";

export function ShowsView() {
  const { ws, setShowId, go, openWizard, toast, showId } = useApp();
  useWorkspaceVersion();
  const list = ws.list();
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const open = (id: string) => { setShowId(id); go("overview"); };
  const doImport = (src: string) => {
    try {
      const r = ws.importRecord(src);
      toast("ok", `Imported ${r.showCode}`);
      setImporting(false); setText("");
      open(r.showId);
    } catch (e) { toast("error", `Could not read that file: ${(e as Error).message}`); }
  };

  return (
    <div className="max-w-5xl">
      <PageHead title="Shows" sub="One record per show. A tour is a folder of shows that share a tour id."
        actions={<>
          <button className="btn btn-primary" onClick={() => openWizard(1, null)}>New show</button>
          <button className="btn" onClick={() => { const r = loadExample(ws); open(r.showId); }}>Open example</button>
          <button className="btn" onClick={() => setImporting(true)}>Import .oncue.json</button>
        </>} />
      <Panel>
        {list.length === 0 ? <Empty>No shows yet. Start a new show or open the example arena.</Empty> : (
          <div className="scroll-x">
            <table className="tbl">
              <thead><tr><th>Show code</th><th>Name</th><th>Date</th><th>Status</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.showId} className={e.showId === showId ? "bg-accent/5" : ""}>
                    <td><button className="font-mono text-accent underline" onClick={() => open(e.showId)}>{e.showCode}</button></td>
                    <td>{e.name || <span className="text-dim">Untitled</span>}{e.source === "example" && <span className="ml-2 text-xs text-info font-display uppercase tracking-widest">example</span>}</td>
                    <td className="font-mono">{e.eventDate ?? "—"}</td>
                    <td className="font-mono text-xs uppercase">{e.status === "draft" ? `rev ${e.revision}-draft` : `${e.status} · rev ${e.revision}`}</td>
                    <td className="font-mono text-xs text-dim">{e.updatedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn mr-1" onClick={() => { const c = ws.copyShow(e.showId); toast("ok", `Copied to ${c.showCode}`); }}>Copy</button>
                      {confirmDel === e.showId
                        ? <><button className="btn text-block border-block" onClick={() => { ws.deleteShow(e.showId); setConfirmDel(null); if (showId === e.showId) setShowId(null); }}>Delete for good</button> <button className="btn" onClick={() => setConfirmDel(null)}>Keep</button></>
                        : <button className="btn" onClick={() => setConfirmDel(e.showId)}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {importing && (
        <Modal title="Import show" onClose={() => setImporting(false)}>
          <div className="grid gap-3">
            <label className="grid gap-1"><span className="label">Choose a .oncue.json file</span>
              <input id="import-file" type="file" accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) doImport(await f.text()); }} /></label>
            <label className="grid gap-1"><span className="label">or paste the JSON</span>
              <textarea id="import-text" className="inp font-mono text-xs" rows={10} value={text} onChange={(e) => setText(e.target.value)} /></label>
            <div><button className="btn btn-primary" disabled={!text.trim()} onClick={() => doImport(text)}>Import</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
