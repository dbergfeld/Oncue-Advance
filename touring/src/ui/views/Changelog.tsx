import { PageHead, Panel } from "../kit";
import { useRecord } from "../state";

export function ChangelogView() {
  const r = useRecord()!;
  const log = [...r.meta.changelog].reverse();
  return (
    <div className="max-w-5xl">
      <PageHead title="Changelog" sub="Every committed patch, with the module that wrote it. setup:* entries are what the wizard seeded." />
      <Panel>
        <div className="scroll-x">
          <table className="tbl text-[13px]">
            <thead><tr><th>Rev</th><th>When</th><th>By</th><th>Reason</th></tr></thead>
            <tbody>{log.slice(0, 300).map((e, i) => (
              <tr key={i}><td className="font-mono">{e.rev}</td><td className="font-mono text-xs whitespace-nowrap">{e.at.slice(0, 19).replace("T", " ")}</td>
                <td><span className="font-mono text-xs px-1 border border-line rounded-sm">{e.by}</span></td><td>{e.reason}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
