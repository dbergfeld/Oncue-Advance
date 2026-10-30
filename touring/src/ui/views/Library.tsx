import { useMemo, useState } from "react";
import { LIBRARY } from "../../library/library";
import { PageHead, Panel } from "../kit";

export function LibraryView() {
  const [q, setQ] = useState("");
  const [cls, setCls] = useState("");
  const classes = useMemo(() => [...new Set(LIBRARY.templates.map((t) => t.class))].sort(), []);
  const list = LIBRARY.templates.filter((t) => (!cls || t.class === cls) && (!q || `${t.make} ${t.model} ${t.templateId} ${(t.aliases ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="max-w-6xl">
      <PageHead title="Device library" sub={<>Version <span className="font-mono">{LIBRARY.libraryVersion}</span> · {LIBRARY.templates.length} templates. Rows marked ≈ are approximate planning values pending a datasheet pass.</>} />
      <Panel actions={<>
        <input id="lib-q" className="inp" placeholder="Search make, model, alias" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="lib-class" className="inp" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{classes.map((c) => <option key={c}>{c}</option>)}</select>
      </>} title={`${list.length} shown`}>
        <div className="scroll-x">
          <table className="tbl text-[13px]">
            <thead><tr><th>Template</th><th>Class</th><th>Make / model</th><th className="text-right">RU</th><th className="text-right">W</th><th className="text-right">lb</th><th>Ports</th><th>Source</th></tr></thead>
            <tbody>{list.map((t) => (
              <tr key={t.templateId}>
                <td className="font-mono text-xs">{t.templateId}</td><td>{t.class}</td><td>{t.make} {t.model}</td>
                <td className="text-right font-mono">{t.ru}</td><td className="text-right font-mono">{t.class === "tile" ? `${t.spec.maxW}/${t.spec.avgW}` : t.powerW}</td><td className="text-right font-mono">{t.weightLb}</td>
                <td className="text-xs">{t.ports.map((p) => `${p.count}× ${p.type} ${p.dir}`).join(", ")}</td>
                <td>{t.source === "approximate" ? <span className="text-warn">≈ approx</span> : t.source}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
