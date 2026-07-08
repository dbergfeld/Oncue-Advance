/**
 * OnCue: Advance — core data model.
 *
 * This file is intentionally framework-agnostic (no React imports) so it can be
 * lifted into a shared package once the server moves off flat-file JSON storage
 * (Phase 2 / Supabase). The server keeps a duplicate of this file for now.
 */

/** Universal confirmation state used for status badges across the app. */
export type Status = "confirmed" | "needs-review" | "missing" | "not-started";

export interface Contact {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
}

export interface Venue {
  name: string;
  address: string;
  productionContact: Contact;
  dockAccess: string;
  truckParking: string;
  busParking: string;
  stageDimensions: string;
  fohLocation: string;
  fohCablePath: string;
  internetAvailability: string;
  curfew: string;
  notes: string;
}

/** Fixed set of schedule row labels a tour stop advance is built around. */
export type ScheduleItemLabel =
  | "Truck Arrival"
  | "Load In"
  | "Rigging Call"
  | "LED Build"
  | "Camera Build"
  | "FOH Setup"
  | "Power Tie-In"
  | "Signal Check"
  | "Camera Check"
  | "Rehearsal"
  | "Doors"
  | "Show"
  | "Load Out";

export interface ScheduleItem {
  id: string;
  label: ScheduleItemLabel;
  time: string;
  department: string;
  owner: string;
  notes: string;
  status: Status;
}

export type VideoPackageCategory =
  | "LED Walls"
  | "Cameras"
  | "Media Servers"
  | "Switcher / Control"
  | "FOH Video"
  | "Fiber / Cable Paths"
  | "Records"
  | "Comms"
  | "Monitoring";

export interface VideoPackageItem {
  id: string;
  category: VideoPackageCategory;
  description: string;
  notes: string;
  status: Status;
}

export interface LaborRole {
  id: string;
  role: string;
  touringCount: number;
  localCount: number;
  callTime: string;
  notes: string;
  confirmed: boolean;
}

export interface LaborPlan {
  roles: LaborRole[];
  departmentLeads: string;
  notes: string;
  status: Status;
}

export interface PowerChecklistItem {
  id: string;
  label: string;
  status: Status;
}

export interface PowerAdvance {
  shorePowerRequired: string;
  distroType: string;
  voltage: string;
  phase: string;
  amperage: string;
  fohPower: string;
  stageVideoPower: string;
  ledPower: string;
  cameraControlPower: string;
  cableLengths: string;
  tieInLocation: string;
  electricianContact: Contact;
  status: Status;
  notes: string;
  checklist: PowerChecklistItem[];
}

export interface RiggingAdvance {
  ledWallPoints: string;
  motorCount: string;
  motorSize: string;
  cablePickPoints: string;
  riggingPlotReceived: boolean;
  trimHeight: string;
  weightNotes: string;
  houseRiggerContact: Contact;
  restrictions: string;
  status: Status;
  notes: string;
}

/**
 * Signal is modeled as a flat list of routed lines rather than a single blob so
 * a Phase 2 node-based routing graph can consume the same records directly
 * (each SignalLine maps cleanly onto a graph edge: source -> destination).
 */
export type SignalCategory =
  | "Camera Feeds"
  | "Program Feeds"
  | "IMAG Feeds"
  | "FOH Sends"
  | "Stage Returns"
  | "Fiber Lines"
  | "SDI Routes";

export interface SignalLine {
  id: string;
  category: SignalCategory;
  source: string;
  destination: string;
  notes: string;
  status: Status;
}

export interface SignalAdvance {
  lines: SignalLine[];
  networkNotes: string;
  redundancyNotes: string;
}

export type DocumentStatus = "uploaded" | "not-uploaded" | "not-applicable";

export interface DocumentItem {
  id: string;
  name: string;
  status: DocumentStatus;
  notes: string;
}

export type NoteCategory =
  | "General"
  | "Production Concern"
  | "Venue Limitation"
  | "Follow-Up Question"
  | "Internal Crew Note";

export type NoteStatus = "open" | "monitoring" | "resolved";

export interface AdvanceNote {
  id: string;
  category: NoteCategory;
  text: string;
  owner: string;
  status: NoteStatus;
  createdAt: string;
}

export interface TourStop {
  id: string;
  tourId: string;
  date: string;
  city: string;
  state: string;
  venue: Venue;
  loadIn: string;
  doors: string;
  showTime: string;
  curfew: string;
  advanceOwner: string;
  crewCount: number;
  truckAccessStatus: Status;
  lastUpdated: string;
  schedule: ScheduleItem[];
  videoPackage: VideoPackageItem[];
  labor: LaborPlan;
  power: PowerAdvance;
  rigging: RiggingAdvance;
  signal: SignalAdvance;
  documents: DocumentItem[];
  notes: AdvanceNote[];
}

export interface Tour {
  id: string;
  name: string;
  season: string;
  artist: string;
}

export interface AppData {
  tour: Tour;
  tourStops: TourStop[];
}
