import { useState } from "react";
import { useShow } from "../context/ShowContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, CardHeader } from "../components/ui/Card";
import { CheckboxField, SelectField } from "../components/ui/Field";
import { Icon } from "../components/ui/icons";
import { api } from "../api/client";
import type { RiskLevel, Venue } from "../types";

const RISK_OPTIONS: Array<{ value: RiskLevel; label: string }> = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

export function VenueInfo() {
  const { selectedShow, refreshSelectedShow } = useShow();
  const [newContact, setNewContact] = useState({ name: "", role: "", email: "", phone: "" });

  if (!selectedShow) return <p className="text-sm text-neutral-500">No show selected.</p>;
  if (!selectedShow.venue) {
    return <p className="text-sm text-neutral-500">This show has no venue assigned yet. Assign one from Settings or the Shows list.</p>;
  }

  const venue = selectedShow.venue;

  async function setVenue<K extends keyof Venue>(key: K, value: Venue[K]) {
    await api.updateVenue(venue.id, { [key]: value } as Partial<Venue>);
    await refreshSelectedShow();
  }

  async function addContact() {
    if (!newContact.name.trim()) return;
    await api.addVenueContact(venue.id, newContact);
    setNewContact({ name: "", role: "", email: "", phone: "" });
    await refreshSelectedShow();
  }

  async function removeContact(id: string) {
    await api.deleteContact(id);
    await refreshSelectedShow();
  }

  return (
    <div>
      <PageHeader title="Venue Info" description="Physical venue details, department notes, and contacts for this show." />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Venue Details" />
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Venue Name" value={venue.name} onCommit={(v) => setVenue("name", v)} className="col-span-2" />
            <Labeled label="Address" value={venue.address} onCommit={(v) => setVenue("address", v)} className="col-span-2" />
            <Labeled label="Timezone" value={venue.timezone} onCommit={(v) => setVenue("timezone", v)} />
            <Labeled label="Venue Type" value={venue.venueType} onCommit={(v) => setVenue("venueType", v)} />
            <Labeled label="Capacity" value={venue.capacity?.toString() ?? ""} onCommit={(v) => setVenue("capacity", (v ? Number(v) : null) as never)} />
            <Labeled label="Website" value={venue.website} onCommit={(v) => setVenue("website", v)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Loading Dock" />
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Dock Access" value={venue.dockAccess} onCommit={(v) => setVenue("dockAccess", v)} area className="col-span-2" />
            <Labeled label="Truck Capacity" value={venue.truckCapacity} onCommit={(v) => setVenue("truckCapacity", v)} />
            <Labeled label="Dock Height" value={venue.dockHeight} onCommit={(v) => setVenue("dockHeight", v)} />
            <CheckboxField label="Has ramp" checked={venue.hasRamp} onChange={(v) => setVenue("hasRamp", v)} />
            <CheckboxField label="Has forklift" checked={venue.hasForklift} onChange={(v) => setVenue("hasForklift", v)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Power" />
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Service Type" value={venue.powerServiceType} onCommit={(v) => setVenue("powerServiceType", v)} />
            <Labeled label="Voltage" value={venue.powerVoltage} onCommit={(v) => setVenue("powerVoltage", v)} />
            <Labeled label="Camlocks" value={venue.camlocks} onCommit={(v) => setVenue("camlocks", v)} />
            <Labeled label="Company Switch" value={venue.companySwitch} onCommit={(v) => setVenue("companySwitch", v)} />
            <Labeled label="Generator Notes" value={venue.generatorNotes} onCommit={(v) => setVenue("generatorNotes", v)} area className="col-span-2" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Rigging" />
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Rigging Points" value={venue.riggingPoints} onCommit={(v) => setVenue("riggingPoints", v)} />
            <Labeled label="Weight Limits" value={venue.weightLimits} onCommit={(v) => setVenue("weightLimits", v)} />
            <Labeled label="Roof Capacity" value={venue.roofCapacity} onCommit={(v) => setVenue("roofCapacity", v)} />
            <Labeled label="Motor Restrictions" value={venue.motorRestrictions} onCommit={(v) => setVenue("motorRestrictions", v)} />
            <Labeled label="House Rigging Notes" value={venue.houseRiggingNotes} onCommit={(v) => setVenue("houseRiggingNotes", v)} area className="col-span-2" />
          </div>
        </Card>

        <Card>
          <CardHeader title="FOH & Signal Environment" />
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="FOH Mix Position" value={venue.fohMixPosition} onCommit={(v) => setVenue("fohMixPosition", v)} />
            <Labeled label="FOH Distance" value={venue.fohDistance} onCommit={(v) => setVenue("fohDistance", v)} />
            <Labeled label="FOH Platform" value={venue.fohPlatform} onCommit={(v) => setVenue("fohPlatform", v)} />
            <Labeled label="Fiber Route" value={venue.fiberRoute} onCommit={(v) => setVenue("fiberRoute", v)} />
            <Labeled label="Camera Locations" value={venue.cameraLocations} onCommit={(v) => setVenue("cameraLocations", v)} className="col-span-2" />
            <Labeled label="FOH Cable Path" value={venue.fohCablePath} onCommit={(v) => setVenue("fohCablePath", v)} area className="col-span-2" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Internet & Parking" />
          <div className="grid grid-cols-2 gap-3">
            <CheckboxField label="Wi-Fi available" checked={venue.wifiAvailable} onChange={(v) => setVenue("wifiAvailable", v)} />
            <CheckboxField label="Dedicated network" checked={venue.dedicatedNetwork} onChange={(v) => setVenue("dedicatedNetwork", v)} />
            <CheckboxField label="Fiber available" checked={venue.fiberAvailable} onChange={(v) => setVenue("fiberAvailable", v)} className="col-span-2" />
            <Labeled label="Internet Notes" value={venue.internetNotes} onCommit={(v) => setVenue("internetNotes", v)} className="col-span-2" />
            <Labeled label="Truck Parking" value={venue.truckParking} onCommit={(v) => setVenue("truckParking", v)} />
            <Labeled label="Bus Parking" value={venue.busParking} onCommit={(v) => setVenue("busParking", v)} />
            <Labeled label="Crew Parking" value={venue.crewParking} onCommit={(v) => setVenue("crewParking", v)} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Nearby Logistics" />
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Airport Distance" value={venue.airportDistance} onCommit={(v) => setVenue("airportDistance", v)} />
            <Labeled label="Ground Transport Notes" value={venue.groundTransportNotes} onCommit={(v) => setVenue("groundTransportNotes", v)} />
            <Labeled label="Preferred Hotels Notes" value={venue.preferredHotelsNotes} onCommit={(v) => setVenue("preferredHotelsNotes", v)} area className="col-span-2" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Weather Risk" subtitle="Manual entry — no live weather feed this pass" />
          <div className="grid grid-cols-3 gap-3">
            <SelectField label="Wind Risk" value={venue.windRisk} onChange={(v) => setVenue("windRisk", v as RiskLevel)} options={RISK_OPTIONS} />
            <SelectField label="Heat Risk" value={venue.heatRisk} onChange={(v) => setVenue("heatRisk", v as RiskLevel)} options={RISK_OPTIONS} />
            <SelectField label="Rain Risk" value={venue.rainRisk} onChange={(v) => setVenue("rainRisk", v as RiskLevel)} options={RISK_OPTIONS} />
            <Labeled label="Weather Notes" value={venue.weatherNotes} onCommit={(v) => setVenue("weatherNotes", v)} className="col-span-3" />
          </div>
        </Card>

        <Card className="col-span-2">
          <CardHeader
            title="Venue Contacts"
            action={
              <div className="flex items-center gap-2">
                <input className="oc-input w-32 py-1 text-xs" placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
                <input className="oc-input w-32 py-1 text-xs" placeholder="Role" value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} />
                <input className="oc-input w-40 py-1 text-xs" placeholder="Email" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
                <input className="oc-input w-32 py-1 text-xs" placeholder="Phone" value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} />
                <button onClick={addContact} className="flex items-center gap-1 rounded-md border border-surface-border px-2 py-1 text-xs text-neutral-300 hover:border-accent/40 hover:text-accent">
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            }
          />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-[11px] uppercase tracking-wide text-neutral-500">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Role</th>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Phone</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {venue.contacts.map((c) => (
                <tr key={c.id} className="border-b border-surface-border last:border-0">
                  <td className="py-2 text-neutral-200">{c.name}</td>
                  <td className="py-2 text-neutral-400">{c.role}</td>
                  <td className="py-2 text-neutral-400">{c.email}</td>
                  <td className="py-2 text-neutral-400">{c.phone}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => removeContact(c.id)} className="text-xs text-neutral-600 hover:text-status-missing">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {venue.contacts.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-sm text-neutral-500">
                    No contacts on file yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="col-span-2">
          <CardHeader title="Load-In & General Notes" />
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Load-In Notes" value={venue.loadInNotes} onCommit={(v) => setVenue("loadInNotes", v)} area />
            <Labeled label="General Notes" value={venue.notes} onCommit={(v) => setVenue("notes", v)} area />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Labeled({
  label,
  value,
  onCommit,
  area,
  className,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  area?: boolean;
  className?: string;
}) {
  const commit = (v: string) => (v !== value ? onCommit(v) : undefined);
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="oc-label">{label}</span>
      {area ? (
        <textarea className="oc-textarea" defaultValue={value} onBlur={(e) => commit(e.target.value)} rows={2} />
      ) : (
        <input className="oc-input" defaultValue={value} onBlur={(e) => commit(e.target.value)} />
      )}
    </label>
  );
}
