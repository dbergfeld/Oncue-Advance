import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, CardHeader } from "../components/ui/Card";
import { CheckboxField, TextAreaField, TextField } from "../components/ui/Field";
import { StatusSelect } from "../components/ui/StatusSelect";
import { riggingCompletion } from "../utils/completion";
import type { RiggingAdvance } from "../types";

export function Rigging() {
  const { selectedStop, updateStop, savingStopIds } = useTour();

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;
  const completion = riggingCompletion(stop);

  function setRigging<K extends keyof RiggingAdvance>(key: K, value: RiggingAdvance[K]) {
    updateStop(stop.id, (s) => ({ ...s, rigging: { ...s.rigging, [key]: value } }));
  }

  function setContact(key: keyof RiggingAdvance["houseRiggerContact"], value: string) {
    updateStop(stop.id, (s) => ({
      ...s,
      rigging: { ...s.rigging, houseRiggerContact: { ...s.rigging.houseRiggerContact, [key]: value } },
    }));
  }

  return (
    <div>
      <PageHeader
        title="Rigging"
        description="Motor plot, points, and weight advance for the video rig."
        status={completion.status}
        percent={completion.percent}
        saving={savingStopIds.has(stop.id)}
      />

      <div className="mb-4 flex justify-end">
        <StatusSelect label="Overall Rigging Confirmation" value={stop.rigging.status} onChange={(v) => setRigging("status", v)} className="w-64" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Points & Motors" />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="LED Wall Points" value={stop.rigging.ledWallPoints} onChange={(v) => setRigging("ledWallPoints", v)} className="col-span-2" />
            <TextField label="Motor Count" value={stop.rigging.motorCount} onChange={(v) => setRigging("motorCount", v)} />
            <TextField label="Motor Size" value={stop.rigging.motorSize} onChange={(v) => setRigging("motorSize", v)} />
            <TextField label="Cable Pick Points" value={stop.rigging.cablePickPoints} onChange={(v) => setRigging("cablePickPoints", v)} />
            <TextField label="Trim Height" value={stop.rigging.trimHeight} onChange={(v) => setRigging("trimHeight", v)} />
          </div>
          <CheckboxField
            label="Rigging plot received from house"
            checked={stop.rigging.riggingPlotReceived}
            onChange={(v) => setRigging("riggingPlotReceived", v)}
            className="mt-3"
          />
        </Card>

        <Card>
          <CardHeader title="House Rigger Contact" />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Name" value={stop.rigging.houseRiggerContact.name} onChange={(v) => setContact("name", v)} className="col-span-2" />
            <TextField label="Email" value={stop.rigging.houseRiggerContact.email ?? ""} onChange={(v) => setContact("email", v)} type="email" />
            <TextField label="Phone" value={stop.rigging.houseRiggerContact.phone ?? ""} onChange={(v) => setContact("phone", v)} type="tel" />
          </div>
        </Card>

        <Card className="col-span-2">
          <CardHeader title="Weight & Restrictions" />
          <div className="grid grid-cols-2 gap-3">
            <TextAreaField label="Weight Notes" value={stop.rigging.weightNotes} onChange={(v) => setRigging("weightNotes", v)} rows={2} />
            <TextAreaField label="Rigging Restrictions" value={stop.rigging.restrictions} onChange={(v) => setRigging("restrictions", v)} rows={2} />
          </div>
        </Card>

        <Card className="col-span-2">
          <TextAreaField label="Rigging Notes" value={stop.rigging.notes} onChange={(v) => setRigging("notes", v)} rows={3} />
        </Card>
      </div>
    </div>
  );
}
