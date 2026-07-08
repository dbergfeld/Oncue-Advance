import { useTour } from "../context/TourContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Card, CardHeader } from "../components/ui/Card";
import { TextField, TextAreaField } from "../components/ui/Field";
import { venueCompletion } from "../utils/completion";
import type { Venue } from "../types";

export function VenueInfo() {
  const { selectedStop, updateStop, savingStopIds } = useTour();

  if (!selectedStop) return <p className="text-sm text-neutral-500">No tour stop selected.</p>;

  const stop = selectedStop;
  const completion = venueCompletion(stop);

  function setVenue<K extends keyof Venue>(key: K, value: Venue[K]) {
    updateStop(stop.id, (s) => ({ ...s, venue: { ...s.venue, [key]: value } }));
  }

  function setContactField(key: keyof Venue["productionContact"], value: string) {
    updateStop(stop.id, (s) => ({
      ...s,
      venue: { ...s.venue, productionContact: { ...s.venue.productionContact, [key]: value } },
    }));
  }

  return (
    <div>
      <PageHeader
        title="Venue Info"
        description="Physical venue details and production contact for this stop."
        status={completion.status}
        percent={completion.percent}
        saving={savingStopIds.has(stop.id)}
      />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Venue Details" />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Venue Name" value={stop.venue.name} onChange={(v) => setVenue("name", v)} required className="col-span-2" />
            <TextField label="Address" value={stop.venue.address} onChange={(v) => setVenue("address", v)} required className="col-span-2" />
            <TextField label="Stage Dimensions" value={stop.venue.stageDimensions} onChange={(v) => setVenue("stageDimensions", v)} required />
            <TextField label="Venue Curfew" value={stop.venue.curfew} onChange={(v) => setVenue("curfew", v)} required />
          </div>
        </Card>

        <Card>
          <CardHeader title="Production Contact" />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Name" value={stop.venue.productionContact.name} onChange={(v) => setContactField("name", v)} required className="col-span-2" />
            <TextField label="Role" value={stop.venue.productionContact.role ?? ""} onChange={(v) => setContactField("role", v)} />
            <TextField label="Email" value={stop.venue.productionContact.email ?? ""} onChange={(v) => setContactField("email", v)} type="email" />
            <TextField label="Phone" value={stop.venue.productionContact.phone ?? ""} onChange={(v) => setContactField("phone", v)} type="tel" className="col-span-2" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Access & Logistics" />
          <div className="grid grid-cols-1 gap-3">
            <TextAreaField label="Dock Access" value={stop.venue.dockAccess} onChange={(v) => setVenue("dockAccess", v)} rows={2} />
            <TextAreaField label="Truck Parking" value={stop.venue.truckParking} onChange={(v) => setVenue("truckParking", v)} rows={2} />
            <TextAreaField label="Bus Parking" value={stop.venue.busParking} onChange={(v) => setVenue("busParking", v)} rows={2} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Stage, FOH & Signal Environment" />
          <div className="grid grid-cols-1 gap-3">
            <TextField label="FOH Location" value={stop.venue.fohLocation} onChange={(v) => setVenue("fohLocation", v)} required />
            <TextAreaField label="FOH Cable Path" value={stop.venue.fohCablePath} onChange={(v) => setVenue("fohCablePath", v)} rows={2} />
            <TextField label="Internet Availability" value={stop.venue.internetAvailability} onChange={(v) => setVenue("internetAvailability", v)} required />
          </div>
        </Card>

        <Card className="col-span-2">
          <CardHeader title="Notes" />
          <TextAreaField label="Venue Notes" value={stop.venue.notes} onChange={(v) => setVenue("notes", v)} rows={3} />
        </Card>
      </div>
    </div>
  );
}
