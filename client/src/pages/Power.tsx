import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, CardHeader } from "../components/ui/Card";
import { TextAreaField, TextField } from "../components/ui/Field";
import { StatusSelect } from "../components/ui/StatusSelect";
import { powerCompletion } from "../utils/completion";
import type { PowerAdvance, PowerChecklistItem } from "../types";

export function Power() {
  const { selectedStop, updateStop, savingStopIds } = useTour();

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;
  const completion = powerCompletion(stop);

  function setPower<K extends keyof PowerAdvance>(key: K, value: PowerAdvance[K]) {
    updateStop(stop.id, (s) => ({ ...s, power: { ...s.power, [key]: value } }));
  }

  function setContact(key: keyof PowerAdvance["electricianContact"], value: string) {
    updateStop(stop.id, (s) => ({
      ...s,
      power: { ...s.power, electricianContact: { ...s.power.electricianContact, [key]: value } },
    }));
  }

  function setChecklistItem(id: string, status: PowerChecklistItem["status"]) {
    updateStop(stop.id, (s) => ({
      ...s,
      power: { ...s.power, checklist: s.power.checklist.map((c) => (c.id === id ? { ...c, status } : c)) },
    }));
  }

  return (
    <div>
      <PageHeader
        title="Power"
        description="Shore power, distro, and electrical tie-in advance."
        status={completion.status}
        percent={completion.percent}
        saving={savingStopIds.has(stop.id)}
      />

      <div className="mb-4 flex justify-end">
        <StatusSelect label="Overall Power Confirmation" value={stop.power.status} onChange={(v) => setPower("status", v)} className="w-64" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Shore Power & Distro" />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Shore Power Requirement" value={stop.power.shorePowerRequired} onChange={(v) => setPower("shorePowerRequired", v)} className="col-span-2" />
            <TextField label="Distro Type" value={stop.power.distroType} onChange={(v) => setPower("distroType", v)} className="col-span-2" />
            <TextField label="Voltage" value={stop.power.voltage} onChange={(v) => setPower("voltage", v)} />
            <TextField label="Phase" value={stop.power.phase} onChange={(v) => setPower("phase", v)} />
            <TextField label="Amperage" value={stop.power.amperage} onChange={(v) => setPower("amperage", v)} className="col-span-2" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Department Power Allocation" />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="FOH Power" value={stop.power.fohPower} onChange={(v) => setPower("fohPower", v)} />
            <TextField label="Stage Video Power" value={stop.power.stageVideoPower} onChange={(v) => setPower("stageVideoPower", v)} />
            <TextField label="LED Power" value={stop.power.ledPower} onChange={(v) => setPower("ledPower", v)} />
            <TextField label="Camera / Control Power" value={stop.power.cameraControlPower} onChange={(v) => setPower("cameraControlPower", v)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Tie-In & Cable Run" />
          <div className="grid grid-cols-1 gap-3">
            <TextField label="Tie-In Location" value={stop.power.tieInLocation} onChange={(v) => setPower("tieInLocation", v)} />
            <TextAreaField label="Cable Lengths" value={stop.power.cableLengths} onChange={(v) => setPower("cableLengths", v)} rows={2} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Electrician Contact" />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Name" value={stop.power.electricianContact.name} onChange={(v) => setContact("name", v)} className="col-span-2" />
            <TextField label="Email" value={stop.power.electricianContact.email ?? ""} onChange={(v) => setContact("email", v)} type="email" />
            <TextField label="Phone" value={stop.power.electricianContact.phone ?? ""} onChange={(v) => setContact("phone", v)} type="tel" />
          </div>
        </Card>

        <Card className="col-span-2">
          <CardHeader title="Power Status Checklist" />
          <ul className="divide-y divide-surface-border">
            {stop.power.checklist.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2.5">
                <span className="text-sm text-neutral-300">{item.label}</span>
                <StatusSelect value={item.status} onChange={(v) => setChecklistItem(item.id, v)} className="w-48" />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="col-span-2">
          <TextAreaField label="Power Notes" value={stop.power.notes} onChange={(v) => setPower("notes", v)} rows={3} />
        </Card>
      </div>
    </div>
  );
}
