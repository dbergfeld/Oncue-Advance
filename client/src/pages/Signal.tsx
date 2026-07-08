import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, CardHeader } from "../components/ui/Card";
import { StatusSelect } from "../components/ui/StatusSelect";
import { SelectField, TextAreaField } from "../components/ui/Field";
import { Icon } from "../components/ui/icons";
import { signalCompletion } from "../utils/completion";
import { makeLocalId } from "../utils/format";
import type { SignalCategory, SignalLine } from "../types";

const CATEGORIES: SignalCategory[] = [
  "Camera Feeds",
  "Program Feeds",
  "IMAG Feeds",
  "FOH Sends",
  "Stage Returns",
  "Fiber Lines",
  "SDI Routes",
];

export function Signal() {
  const { selectedStop, updateStop, savingStopIds } = useTour();

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;
  const completion = signalCompletion(stop);

  function setLine<K extends keyof SignalLine>(id: string, key: K, value: SignalLine[K]) {
    updateStop(stop.id, (s) => ({
      ...s,
      signal: { ...s.signal, lines: s.signal.lines.map((l) => (l.id === id ? { ...l, [key]: value } : l)) },
    }));
  }

  function addLine() {
    const newLine: SignalLine = {
      id: makeLocalId("sig"),
      category: "Camera Feeds",
      source: "",
      destination: "",
      notes: "",
      status: "not-started",
    };
    updateStop(stop.id, (s) => ({ ...s, signal: { ...s.signal, lines: [...s.signal.lines, newLine] } }));
  }

  function removeLine(id: string) {
    updateStop(stop.id, (s) => ({ ...s, signal: { ...s.signal, lines: s.signal.lines.filter((l) => l.id !== id) } }));
  }

  return (
    <div>
      <PageHeader
        title="Signal"
        description="Camera, program, and IMAG routing. Structured for a Phase 2 node-based signal graph."
        status={completion.status}
        percent={completion.percent}
        saving={savingStopIds.has(stop.id)}
      />

      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-surface-border p-4">
          <CardHeader title="Signal Lines" subtitle="Source → destination routing, by category" />
          <button
            onClick={addLine}
            className="flex items-center gap-1.5 rounded-md border border-surface-border px-3 py-1.5 text-xs text-neutral-300 hover:border-accent/40 hover:text-accent"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add Line
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-raised/40 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2.5 font-medium w-40">Category</th>
              <th className="px-3 py-2.5 font-medium">Source</th>
              <th className="px-3 py-2.5 font-medium">Destination</th>
              <th className="px-3 py-2.5 font-medium">Notes</th>
              <th className="px-3 py-2.5 font-medium w-40">Status</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {stop.signal.lines.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-neutral-500">
                  No signal lines mapped yet.
                </td>
              </tr>
            )}
            {stop.signal.lines.map((line) => (
              <tr key={line.id} className="border-b border-surface-border last:border-0">
                <td className="px-3 py-2">
                  <SelectField
                    label=""
                    value={line.category}
                    onChange={(v) => setLine(line.id, "category", v as SignalCategory)}
                    options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                  />
                </td>
                <td className="px-3 py-2">
                  <input className="oc-input py-1" value={line.source} placeholder="Source" onChange={(e) => setLine(line.id, "source", e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <input className="oc-input py-1" value={line.destination} placeholder="Destination" onChange={(e) => setLine(line.id, "destination", e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <input className="oc-input py-1" value={line.notes} placeholder="Notes" onChange={(e) => setLine(line.id, "notes", e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <StatusSelect value={line.status} onChange={(v) => setLine(line.id, "status", v)} />
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => removeLine(line.id)} className="text-xs text-neutral-600 hover:text-status-missing">
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Card>
          <TextAreaField
            label="Network / IP Notes"
            value={stop.signal.networkNotes}
            onChange={(v) => updateStop(stop.id, (s) => ({ ...s, signal: { ...s.signal, networkNotes: v } }))}
            rows={3}
          />
        </Card>
        <Card>
          <TextAreaField
            label="Redundancy Notes"
            value={stop.signal.redundancyNotes}
            onChange={(v) => updateStop(stop.id, (s) => ({ ...s, signal: { ...s.signal, redundancyNotes: v } }))}
            rows={3}
          />
        </Card>
      </div>
    </div>
  );
}
