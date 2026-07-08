import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Icon } from "../components/ui/icons";
import { documentsCompletion, CRITICAL_DOCUMENTS } from "../utils/completion";
import type { DocumentItem, DocumentStatus } from "../types";

const STATUS_OPTIONS: Array<{ value: DocumentStatus; label: string }> = [
  { value: "not-uploaded", label: "Not Uploaded" },
  { value: "uploaded", label: "Uploaded" },
  { value: "not-applicable", label: "Not Applicable" },
];

export function Documents() {
  const { selectedStop, updateStop, savingStopIds } = useTour();

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;
  const completion = documentsCompletion(stop);

  function setDoc<K extends keyof DocumentItem>(id: string, key: K, value: DocumentItem[K]) {
    updateStop(stop.id, (s) => ({
      ...s,
      documents: s.documents.map((d) => (d.id === id ? { ...d, [key]: value } : d)),
    }));
  }

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Advance document checklist. File upload lands in a later phase — this tracks status only."
        status={completion.status}
        percent={completion.percent}
        saving={savingStopIds.has(stop.id)}
      />

      <Card padded={false} className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-border bg-surface-raised/40 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2.5 font-medium">Document</th>
              <th className="px-4 py-2.5 font-medium w-44">Status</th>
              <th className="px-4 py-2.5 font-medium w-32">File</th>
              <th className="px-4 py-2.5 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {stop.documents.map((doc) => (
              <tr key={doc.id} className="border-b border-surface-border last:border-0">
                <td className="px-4 py-2.5 font-medium text-neutral-200">
                  {doc.name}
                  {CRITICAL_DOCUMENTS.includes(doc.name) && <span className="ml-1.5 text-status-missing">*</span>}
                </td>
                <td className="px-4 py-2.5">
                  <select
                    className="oc-select py-1"
                    value={doc.status}
                    onChange={(e) => setDoc(doc.id, "status", e.target.value as DocumentStatus)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2.5">
                  <button
                    disabled
                    title="File upload arrives in a later phase"
                    className="flex items-center gap-1.5 rounded-md border border-dashed border-surface-border px-2.5 py-1 text-xs text-neutral-600"
                  >
                    <Icon name="documents" className="h-3.5 w-3.5" />
                    Upload
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <input
                    className="oc-input py-1"
                    value={doc.notes}
                    placeholder="Notes"
                    onChange={(e) => setDoc(doc.id, "notes", e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-neutral-600">* Marked documents are treated as critical for advance completion.</p>
    </div>
  );
}
