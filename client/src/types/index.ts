/**
 * OnCue: Advance — Phase 2 client-side types.
 *
 * Mirrors the shape the API actually returns (Prisma models plus the
 * includes each endpoint attaches), not the raw Prisma schema 1:1. The
 * canonical source of truth is server/prisma/schema.prisma.
 */

export type RecordStatus = "CONFIRMED" | "NEEDS_REVIEW" | "MISSING" | "NOT_STARTED";

export type Department =
  | "VIDEO"
  | "LIGHTING"
  | "AUDIO"
  | "RIGGING"
  | "AUTOMATION"
  | "BACKLINE"
  | "PRODUCTION"
  | "MERCH"
  | "TRANSPORTATION";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "NOT_REQUIRED";
export type IssueSeverity = "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL";
export type IssueStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type TimelineEntryStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "BLOCKED" | "SKIPPED";
export type ShowStatus = "PLANNING" | "ADVANCING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type DocumentStatus = "UPLOADED" | "NOT_UPLOADED" | "NOT_APPLICABLE";
export type NoteCategory = "GENERAL" | "PRODUCTION_CONCERN" | "VENUE_LIMITATION" | "FOLLOW_UP_QUESTION" | "INTERNAL_CREW_NOTE";
export type NoteStatus = "OPEN" | "MONITORING" | "RESOLVED";

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isAdmin: boolean;
}

export interface Tour {
  id: string;
  name: string;
  artist: string;
  season: string;
  status: RecordStatus;
}

export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  notes: string;
}

export interface Venue {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  capacity: number | null;
  website: string;
  venueType: string;
  loadInNotes: string;

  videoNotes: string;
  lightingNotes: string;
  audioNotes: string;
  riggingNotes: string;
  automationNotes: string;
  backlineNotes: string;
  productionNotes: string;

  dockAccess: string;
  truckCapacity: string;
  dockHeight: string;
  hasRamp: boolean;
  hasForklift: boolean;

  powerServiceType: string;
  powerVoltage: string;
  camlocks: string;
  companySwitch: string;
  generatorNotes: string;

  riggingPoints: string;
  weightLimits: string;
  roofCapacity: string;
  motorRestrictions: string;
  houseRiggingNotes: string;

  fohCablePath: string;
  fohDistance: string;
  fohMixPosition: string;
  fohPlatform: string;
  fiberRoute: string;
  cameraLocations: string;

  wifiAvailable: boolean;
  dedicatedNetwork: boolean;
  fiberAvailable: boolean;
  internetNotes: string;

  truckParking: string;
  busParking: string;
  crewParking: string;

  preferredHotelsNotes: string;
  airportDistance: string;
  groundTransportNotes: string;

  windRisk: RiskLevel;
  heatRisk: RiskLevel;
  rainRisk: RiskLevel;
  weatherNotes: string;

  notes: string;
  contacts: Contact[];
}

export interface Tag {
  id: string;
  label: string;
  color: string;
}

export interface EntityTagRef {
  id: string;
  tag: Tag;
}

export interface Requirement {
  id: string;
  showId: string;
  department: Department;
  name: string;
  description: string;
  required: boolean;
  providedBy: string;
  confirmed: boolean;
  status: RecordStatus;
  ownerId: string | null;
  owner: User | null;
  dueDate: string | null;
  priority: Priority;
  riskLevel: RiskLevel;
  notes: string;
  approvalStatus: ApprovalStatus;
  tags: EntityTagRef[];
  createdAt: string;
  updatedAt: string;
}

export interface Issue {
  id: string;
  showId: string | null;
  show?: { id: string; city: string; state: string; date: string } | null;
  venueId: string | null;
  venue?: { id: string; name: string } | null;
  title: string;
  description: string;
  department: Department | null;
  severity: IssueSeverity;
  priority: Priority;
  ownerId: string | null;
  owner: User | null;
  status: IssueStatus;
  resolution: string;
  lessonsLearned: string;
  tags: EntityTagRef[];
  createdAt: string;
  updatedAt: string;
}

export interface TimelineStage {
  id: string;
  key: string;
  label: string;
  order: number;
}

export interface TimelineEntry {
  id: string;
  showId: string;
  stageId: string;
  stage: TimelineStage;
  ownerId: string | null;
  owner: User | null;
  status: TimelineEntryStatus;
  startedAt: string | null;
  completedAt: string | null;
  notes: string;
  dependsOn: Array<{ id: string; stage?: TimelineStage }>;
}

export interface ScheduleItem {
  id: string;
  showId: string;
  label: string;
  time: string;
  department: Department | null;
  ownerId: string | null;
  owner: User | null;
  notes: string;
  status: RecordStatus;
  sortOrder: number;
}

export interface DocumentItem {
  id: string;
  showId: string;
  name: string;
  status: DocumentStatus;
  notes: string;
}

export interface AdvanceNote {
  id: string;
  showId: string;
  authorId: string | null;
  author: User | null;
  body: string;
  category: NoteCategory;
  noteStatus: NoteStatus;
  createdAt: string;
}

export interface EntityComment {
  id: string;
  body: string;
  authorId: string | null;
  author: User | null;
  createdAt: string;
}

export interface EntityAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  createdAt: string;
}

export interface DepartmentHealth {
  department: string;
  percentComplete: number;
  status: "on-track" | "at-risk" | "blocked" | "not-started";
  missingCount: number;
  summary: string;
}

export interface RiskEngineResult {
  showId: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  departmentHealth: DepartmentHealth[];
  missingCriticalItems: string[];
  openBlockers: string[];
  recommendations: string[];
  suggestedQuestions: string[];
  summary: string;
  confidence: number;
  generatedAt: string;
  model: string;
}

export interface Show {
  id: string;
  tourId: string;
  tour?: Tour;
  venueId: string | null;
  venue: Venue | null;
  date: string;
  city: string;
  state: string;
  loadIn: string;
  doors: string;
  showTime: string;
  curfew: string;
  crewCount: number;
  status: ShowStatus;
  advanceOwnerId: string | null;
  advanceOwner: User | null;
  riskScore: number | null;
  riskSummary: RiskEngineResult | null;
  riskAnalyzedAt: string | null;
  requirements: Requirement[];
  issues: Issue[];
  scheduleItems: ScheduleItem[];
  documents: DocumentItem[];
  timelineEntries: TimelineEntry[];
  comments: AdvanceNote[];
  createdAt: string;
  updatedAt: string;
}

/** Lighter shape returned by GET /api/shows (list view — no full nested detail). */
export interface ShowSummary {
  id: string;
  tourId: string;
  tour: Tour;
  venueId: string | null;
  venue: Venue | null;
  advanceOwner: User | null;
  date: string;
  city: string;
  state: string;
  status: ShowStatus;
  requirements: Requirement[];
  issues: Issue[];
  documents: DocumentItem[];
  riskScore: number | null;
  updatedAt: string;
}
