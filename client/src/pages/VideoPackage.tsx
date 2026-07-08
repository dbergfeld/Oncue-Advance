import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { StatusSelect } from "../components/ui/StatusSelect";
import { TextAreaField, TextField } from "../components/ui/Field";
import { videoPackageCompletion } from "../utils/completion";
import type { VideoPackageItem } from "../types";

export function VideoPackage() {
  const { selectedStop, updateStop, savingStopIds } = useTour();

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;
  const completion = videoPackageCompletion(stop);

  function setItem<K extends keyof VideoPackageItem>(id: string, key: K, value: VideoPackageItem[K]) {
    updateStop(stop.id, (s) => ({
      ...s,
      videoPackage: s.videoPackage.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    }));
  }

  return (
    <div>
      <PageHeader
        title="Video Package"
        description="Touring video system — signal chain, LED, cameras, and control."
        status={completion.status}
        percent={completion.percent}
        saving={savingStopIds.has(stop.id)}
      />

      <div className="grid grid-cols-3 gap-4">
        {stop.videoPackage.map((item) => (
          <Card key={item.id}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-100">{item.category}</h3>
              <StatusSelect value={item.status} onChange={(v) => setItem(item.id, "status", v)} />
            </div>
            <div className="space-y-3">
              <TextField label="Package Description" value={item.description} onChange={(v) => setItem(item.id, "description", v)} />
              <TextAreaField label="Notes" value={item.notes} onChange={(v) => setItem(item.id, "notes", v)} rows={2} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
