import type {
  AppData,
  DocumentItem,
  ScheduleItem,
  ScheduleItemLabel,
  SignalLine,
  Status,
  TourStop,
  VideoPackageItem,
} from "../types/index.js";

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(++idCounter).toString(36)}`;

const SCHEDULE_LABELS: ScheduleItemLabel[] = [
  "Truck Arrival",
  "Load In",
  "Rigging Call",
  "LED Build",
  "Camera Build",
  "FOH Setup",
  "Power Tie-In",
  "Signal Check",
  "Camera Check",
  "Rehearsal",
  "Doors",
  "Show",
  "Load Out",
];

function buildSchedule(
  rows: Partial<Record<ScheduleItemLabel, Omit<ScheduleItem, "id" | "label">>>
): ScheduleItem[] {
  return SCHEDULE_LABELS.map((label) => {
    const row = rows[label];
    return {
      id: nextId("sched"),
      label,
      time: row?.time ?? "",
      department: row?.department ?? "",
      owner: row?.owner ?? "",
      notes: row?.notes ?? "",
      status: row?.status ?? ("not-started" as Status),
    };
  });
}

const VIDEO_PACKAGE_DEFAULTS: Array<{
  category: VideoPackageItem["category"];
  description: string;
}> = [
  { category: "LED Walls", description: "ROE CB5 upstage wall, ROE CB8 side hangs" },
  { category: "Cameras", description: "Panasonic UC4000 FOH cameras, Panasonic UE-150 PTZ cameras" },
  { category: "Media Servers", description: "Disguise media servers (dual redundant)" },
  { category: "Switcher / Control", description: "ATEM 2 M/E Constellation 4K w/ 2 M/E Advanced Panel" },
  { category: "FOH Video", description: "FOH video world on riser, dual operator positions" },
  { category: "Fiber / Cable Paths", description: "TAC fiber lines, stage-to-FOH primary + redundant run" },
  { category: "Records", description: "ISO records off all camera and program feeds" },
  { category: "Comms", description: "Clear-Com wired + RF beltpacks, video department channel" },
  { category: "Monitoring", description: "Brompton SX40 processors, confidence monitors at FOH and SR" },
];

function buildVideoPackage(
  overrides: Partial<Record<VideoPackageItem["category"], { description?: string; notes?: string; status?: Status }>> = {}
): VideoPackageItem[] {
  return VIDEO_PACKAGE_DEFAULTS.map((item) => {
    const o = overrides[item.category];
    return {
      id: nextId("vid"),
      category: item.category,
      description: o?.description ?? item.description,
      notes: o?.notes ?? "",
      status: o?.status ?? ("not-started" as Status),
    };
  });
}

const DOCUMENT_NAMES = [
  "Venue Packet",
  "Rigging Plot",
  "Stage Plot",
  "Power Plot",
  "Seating Map",
  "FOH Location Photo",
  "Truck Dock Photo",
  "Cable Path Photo",
  "Labor Sheet",
  "Final Day Sheet",
];

function buildDocuments(
  overrides: Partial<Record<string, { status: DocumentItem["status"]; notes?: string }>> = {}
): DocumentItem[] {
  return DOCUMENT_NAMES.map((name) => ({
    id: nextId("doc"),
    name,
    status: overrides[name]?.status ?? "not-uploaded",
    notes: overrides[name]?.notes ?? "",
  }));
}

function signalLine(
  category: SignalLine["category"],
  source: string,
  destination: string,
  status: Status,
  notes = ""
): SignalLine {
  return { id: nextId("sig"), category, source, destination, status, notes };
}

// ---------------------------------------------------------------------------
// Denver, CO — Ball Arena — fully advanced, ready for show day
// ---------------------------------------------------------------------------
const denver: TourStop = {
  id: "stop-denver",
  tourId: "tour-radius",
  date: "2026-07-14",
  city: "Denver",
  state: "CO",
  loadIn: "08:00",
  doors: "18:30",
  showTime: "20:00",
  curfew: "23:00",
  advanceOwner: "J. Alvarez",
  crewCount: 14,
  truckAccessStatus: "confirmed",
  lastUpdated: "2026-07-01T14:22:00Z",
  venue: {
    name: "Ball Arena",
    address: "1000 Chopper Cir, Denver, CO 80204",
    productionContact: { name: "Marcus Webb", role: "Production Manager", email: "mwebb@ballarena.com", phone: "(303) 555-0142" },
    dockAccess: "Dock B, 3 bays, 13'6\" clearance, ramp access confirmed",
    truckParking: "8 trailer spots, lot C, overnight approved",
    busParking: "4 bus spots, lot C north side",
    stageDimensions: "60' x 40', deck height 4'",
    fohLocation: "Center arena floor, riser B, 40' throw",
    fohCablePath: "Under-riser conduit run, house-provided, confirmed clear",
    internetAvailability: "Hardwired production internet + venue Wi-Fi, static IP available",
    curfew: "23:00 hard out per city noise ordinance",
    notes: "Loading dock freight elevator services level 2 only — confirm LED truck route with house carpenter on arrival.",
  },
  schedule: buildSchedule({
    "Truck Arrival": { time: "07:00", department: "Trucking", owner: "J. Alvarez", notes: "3 trucks, staggered 15 min", status: "confirmed" },
    "Load In": { time: "08:00", department: "All Depts", owner: "J. Alvarez", notes: "", status: "confirmed" },
    "Rigging Call": { time: "08:00", department: "Rigging", owner: "House Rigger", notes: "6 riggers called", status: "confirmed" },
    "LED Build": { time: "09:00", department: "Video", owner: "T. Nguyen", notes: "", status: "confirmed" },
    "Camera Build": { time: "10:30", department: "Video", owner: "R. Okafor", notes: "", status: "confirmed" },
    "FOH Setup": { time: "10:30", department: "Video", owner: "T. Nguyen", notes: "", status: "confirmed" },
    "Power Tie-In": { time: "09:00", department: "Electric", owner: "House Electrician", notes: "", status: "confirmed" },
    "Signal Check": { time: "13:00", department: "Video", owner: "R. Okafor", notes: "", status: "confirmed" },
    "Camera Check": { time: "13:30", department: "Video", owner: "R. Okafor", notes: "", status: "confirmed" },
    "Rehearsal": { time: "16:00", department: "All Depts", owner: "Tour Manager", notes: "Line check only", status: "needs-review" },
    "Doors": { time: "18:30", department: "Venue", owner: "House PM", notes: "", status: "confirmed" },
    "Show": { time: "20:00", department: "All Depts", owner: "Video Director", notes: "90 min set, no encore break", status: "confirmed" },
    "Load Out": { time: "23:00", department: "All Depts", owner: "J. Alvarez", notes: "Straight to Salt Lake", status: "confirmed" },
  }),
  videoPackage: buildVideoPackage({
    "LED Walls": { status: "confirmed", notes: "Confirmed rigging points against house plot" },
    "Cameras": { status: "confirmed" },
    "Media Servers": { status: "confirmed" },
    "Switcher / Control": { status: "confirmed" },
    "FOH Video": { status: "confirmed" },
    "Fiber / Cable Paths": { status: "confirmed", notes: "Redundant run tested clean" },
    "Records": { status: "confirmed" },
    "Comms": { status: "confirmed" },
    "Monitoring": { status: "confirmed" },
  }),
  labor: {
    roles: [
      { id: nextId("lab"), role: "Touring Video Crew", touringCount: 6, localCount: 0, callTime: "07:00", notes: "Full touring complement", confirmed: true },
      { id: nextId("lab"), role: "Local Video Hands", touringCount: 0, localCount: 4, callTime: "08:00", notes: "", confirmed: true },
      { id: nextId("lab"), role: "LED Hands", touringCount: 0, localCount: 3, callTime: "09:00", notes: "", confirmed: true },
      { id: nextId("lab"), role: "Camera Ops", touringCount: 2, localCount: 1, callTime: "10:30", notes: "", confirmed: true },
      { id: nextId("lab"), role: "Forklift Operator", touringCount: 0, localCount: 1, callTime: "07:00", notes: "Certified, house-provided", confirmed: true },
      { id: nextId("lab"), role: "Riggers", touringCount: 0, localCount: 6, callTime: "08:00", notes: "", confirmed: true },
    ],
    departmentLeads: "T. Nguyen (LED/Systems), R. Okafor (Camera)",
    notes: "Full crew confirmed with house 10 days out.",
    status: "confirmed",
  },
  power: {
    shorePowerRequired: "800A 3-phase",
    distroType: "House distro w/ tour cam-lock breakout",
    voltage: "208V",
    phase: "3-phase",
    amperage: "800A",
    fohPower: "100A, isolated ground",
    stageVideoPower: "200A, dedicated to LED/media servers",
    ledPower: "300A across 3 walls",
    cameraControlPower: "60A, FOH video world",
    cableLengths: "150' feeder run stage left to distro room",
    tieInLocation: "Dock B electrical room",
    electricianContact: { name: "Dana Foss", role: "House Electrician", email: "dfoss@ballarena.com", phone: "(303) 555-0177" },
    status: "confirmed",
    notes: "House confirmed isolated ground circuit for FOH video.",
    checklist: [
      { id: nextId("pchk"), label: "Shore power confirmed with house", status: "confirmed" },
      { id: nextId("pchk"), label: "Distro walked and approved", status: "confirmed" },
      { id: nextId("pchk"), label: "Cable run measured", status: "confirmed" },
      { id: nextId("pchk"), label: "Isolated ground confirmed for FOH", status: "confirmed" },
    ],
  },
  rigging: {
    ledWallPoints: "24 points across 3 walls",
    motorCount: "24",
    motorSize: "1-ton (18), 1/2-ton (6)",
    cablePickPoints: "8",
    riggingPlotReceived: true,
    trimHeight: "28' to bottom of wall",
    weightNotes: "Total video rig weight 18,400 lbs, within house grid rating",
    houseRiggerContact: { name: "Pete Callahan", role: "House Head Rigger", email: "pcallahan@ballarena.com", phone: "(303) 555-0199" },
    restrictions: "No points forward of truss position 4 — house lighting rig priority",
    status: "confirmed",
    notes: "Plot approved by house engineer, stamped drawing on file.",
  },
  signal: {
    lines: [
      signalLine("Camera Feeds", "Cam 1 (FOH)", "Switcher In 1", "confirmed"),
      signalLine("Camera Feeds", "Cam 2 (SR PTZ)", "Switcher In 2", "confirmed"),
      signalLine("Camera Feeds", "Cam 3 (SL PTZ)", "Switcher In 3", "confirmed"),
      signalLine("Program Feeds", "Switcher Program", "LED Processor A", "confirmed"),
      signalLine("Program Feeds", "Switcher Program", "Media Server Record", "confirmed"),
      signalLine("IMAG Feeds", "Switcher PGM", "House IMAG (Scoreboard)", "confirmed", "House-owned drop, confirmed with house video eng."),
      signalLine("FOH Sends", "FOH Video World", "Broadcast Truck (if present)", "not-started", "No broadcast this date"),
      signalLine("Stage Returns", "Stage Monitor Feed", "SR Confidence Monitor", "confirmed"),
      signalLine("Fiber Lines", "Stage Fiber Hub", "FOH Fiber Hub", "confirmed", "Primary + redundant run, both tested"),
      signalLine("SDI Routes", "Media Server Out", "LED Processor Input", "confirmed"),
    ],
    networkNotes: "Isolated production VLAN provided by house IT, static addressing per tour standard.",
    redundancyNotes: "Dual fiber run stage-to-FOH; secondary media server hot-standby.",
  },
  documents: buildDocuments({
    "Venue Packet": { status: "uploaded" },
    "Rigging Plot": { status: "uploaded" },
    "Stage Plot": { status: "uploaded" },
    "Power Plot": { status: "uploaded" },
    "Seating Map": { status: "uploaded" },
    "FOH Location Photo": { status: "uploaded" },
    "Truck Dock Photo": { status: "uploaded" },
    "Cable Path Photo": { status: "uploaded" },
    "Labor Sheet": { status: "uploaded" },
    "Final Day Sheet": { status: "not-uploaded", notes: "Finalize after rehearsal confirms timing" },
  }),
  notes: [
    { id: nextId("note"), category: "General", text: "House has hosted us twice before — strong relationship, fast turnaround on requests.", owner: "J. Alvarez", status: "resolved", createdAt: "2026-06-20T10:00:00Z" },
    { id: nextId("note"), category: "Venue Limitation", text: "Freight elevator only services level 2 — plan LED truck route accordingly.", owner: "T. Nguyen", status: "monitoring", createdAt: "2026-06-22T09:15:00Z" },
  ],
};

// ---------------------------------------------------------------------------
// Salt Lake City, UT — Delta Center — in progress, a few items need review
// ---------------------------------------------------------------------------
const saltLake: TourStop = {
  id: "stop-slc",
  tourId: "tour-radius",
  date: "2026-07-16",
  city: "Salt Lake City",
  state: "UT",
  loadIn: "07:30",
  doors: "18:00",
  showTime: "20:00",
  curfew: "23:00",
  advanceOwner: "J. Alvarez",
  crewCount: 12,
  truckAccessStatus: "needs-review",
  lastUpdated: "2026-06-28T11:05:00Z",
  venue: {
    name: "Delta Center",
    address: "301 S Temple, Salt Lake City, UT 84101",
    productionContact: { name: "Karen Sato", role: "Production Coordinator", email: "ksato@deltacenter.com", phone: "(801) 555-0110" },
    dockAccess: "Dock A, 2 bays, height TBD — awaiting confirmation",
    truckParking: "6 trailer spots confirmed",
    busParking: "3 bus spots, street permit required",
    stageDimensions: "56' x 38'",
    fohLocation: "Center floor, riser TBD pending seating kill",
    fohCablePath: "Path not yet confirmed with house carpenter",
    internetAvailability: "Venue Wi-Fi only confirmed so far, hardwire requested",
    curfew: "23:00",
    notes: "Awaiting updated venue packet from house PM — requested twice.",
  },
  schedule: buildSchedule({
    "Truck Arrival": { time: "06:30", department: "Trucking", owner: "J. Alvarez", notes: "", status: "confirmed" },
    "Load In": { time: "07:30", department: "All Depts", owner: "J. Alvarez", notes: "", status: "confirmed" },
    "Rigging Call": { time: "07:30", department: "Rigging", owner: "House Rigger", notes: "Crew size TBD", status: "needs-review" },
    "LED Build": { time: "08:30", department: "Video", owner: "T. Nguyen", notes: "", status: "needs-review" },
    "Camera Build": { time: "10:00", department: "Video", owner: "R. Okafor", notes: "", status: "not-started" },
    "FOH Setup": { time: "10:00", department: "Video", owner: "T. Nguyen", notes: "", status: "not-started" },
    "Power Tie-In": { time: "08:30", department: "Electric", owner: "House Electrician", notes: "", status: "needs-review" },
    "Signal Check": { time: "13:00", department: "Video", owner: "R. Okafor", notes: "", status: "not-started" },
    "Camera Check": { time: "13:30", department: "Video", owner: "R. Okafor", notes: "", status: "not-started" },
    "Rehearsal": { time: "16:00", department: "All Depts", owner: "Tour Manager", notes: "", status: "not-started" },
    "Doors": { time: "18:00", department: "Venue", owner: "House PM", notes: "", status: "confirmed" },
    "Show": { time: "20:00", department: "All Depts", owner: "Video Director", notes: "", status: "not-started" },
    "Load Out": { time: "23:00", department: "All Depts", owner: "J. Alvarez", notes: "", status: "not-started" },
  }),
  videoPackage: buildVideoPackage({
    "LED Walls": { status: "needs-review", notes: "Confirming point count against reduced rig for this date" },
    "Cameras": { status: "confirmed" },
    "Media Servers": { status: "confirmed" },
    "Switcher / Control": { status: "confirmed" },
    "FOH Video": { status: "needs-review", notes: "FOH position pending riser confirmation" },
    "Fiber / Cable Paths": { status: "needs-review" },
    "Records": { status: "confirmed" },
    "Comms": { status: "confirmed" },
    "Monitoring": { status: "not-started" },
  }),
  labor: {
    roles: [
      { id: nextId("lab"), role: "Touring Video Crew", touringCount: 6, localCount: 0, callTime: "06:30", notes: "", confirmed: true },
      { id: nextId("lab"), role: "Local Video Hands", touringCount: 0, localCount: 3, callTime: "07:30", notes: "Union call placed, awaiting names", confirmed: false },
      { id: nextId("lab"), role: "LED Hands", touringCount: 0, localCount: 2, callTime: "08:30", notes: "Short 1 hand vs standard call", confirmed: false },
      { id: nextId("lab"), role: "Camera Ops", touringCount: 2, localCount: 0, callTime: "10:00", notes: "", confirmed: true },
      { id: nextId("lab"), role: "Forklift Operator", touringCount: 0, localCount: 1, callTime: "06:30", notes: "", confirmed: true },
      { id: nextId("lab"), role: "Riggers", touringCount: 0, localCount: 5, callTime: "07:30", notes: "Headcount pending house confirmation", confirmed: false },
    ],
    departmentLeads: "T. Nguyen (LED/Systems), R. Okafor (Camera)",
    notes: "Local labor confirmations lagging — follow up with house PM by end of week.",
    status: "needs-review",
  },
  power: {
    shorePowerRequired: "600A 3-phase",
    distroType: "House distro, tour breakout TBD",
    voltage: "208V",
    phase: "3-phase",
    amperage: "600A",
    fohPower: "100A",
    stageVideoPower: "TBD",
    ledPower: "TBD pending reduced wall count",
    cameraControlPower: "60A",
    cableLengths: "Not yet measured",
    tieInLocation: "TBD",
    electricianContact: { name: "", role: "House Electrician", email: "", phone: "" },
    status: "needs-review",
    notes: "House electrician contact not yet provided.",
    checklist: [
      { id: nextId("pchk"), label: "Shore power confirmed with house", status: "needs-review" },
      { id: nextId("pchk"), label: "Distro walked and approved", status: "not-started" },
      { id: nextId("pchk"), label: "Cable run measured", status: "not-started" },
      { id: nextId("pchk"), label: "Isolated ground confirmed for FOH", status: "not-started" },
    ],
  },
  rigging: {
    ledWallPoints: "TBD — reduced rig for arena floor config",
    motorCount: "Estimated 18",
    motorSize: "TBD",
    cablePickPoints: "6",
    riggingPlotReceived: false,
    trimHeight: "TBD",
    weightNotes: "Awaiting house grid rating for reduced rig",
    houseRiggerContact: { name: "Lena Ford", role: "House Head Rigger", email: "lford@deltacenter.com", phone: "(801) 555-0133" },
    restrictions: "Unknown — plot not yet received",
    status: "needs-review",
    notes: "Chasing rigging plot from house, requested 6/24.",
  },
  signal: {
    lines: [
      signalLine("Camera Feeds", "Cam 1 (FOH)", "Switcher In 1", "confirmed"),
      signalLine("Camera Feeds", "Cam 2 (SR PTZ)", "Switcher In 2", "needs-review"),
      signalLine("Camera Feeds", "Cam 3 (SL PTZ)", "Switcher In 3", "needs-review"),
      signalLine("Program Feeds", "Switcher Program", "LED Processor A", "needs-review"),
      signalLine("IMAG Feeds", "Switcher PGM", "House IMAG", "not-started", "House video eng contact pending"),
      signalLine("FOH Sends", "FOH Video World", "Broadcast Truck (if present)", "not-started", "No broadcast this date"),
      signalLine("Stage Returns", "Stage Monitor Feed", "SR Confidence Monitor", "not-started"),
      signalLine("Fiber Lines", "Stage Fiber Hub", "FOH Fiber Hub", "needs-review", "Path not confirmed"),
      signalLine("SDI Routes", "Media Server Out", "LED Processor Input", "not-started"),
    ],
    networkNotes: "Network plan pending venue IT confirmation of hardwire availability.",
    redundancyNotes: "Redundancy plan unchanged from tour standard, pending fiber path confirmation.",
  },
  documents: buildDocuments({
    "Venue Packet": { status: "not-uploaded", notes: "Requested twice, still outstanding" },
    "Rigging Plot": { status: "not-uploaded" },
    "Stage Plot": { status: "uploaded" },
    "Power Plot": { status: "not-uploaded" },
    "Seating Map": { status: "uploaded" },
    "FOH Location Photo": { status: "not-uploaded" },
    "Truck Dock Photo": { status: "uploaded" },
    "Cable Path Photo": { status: "not-uploaded" },
    "Labor Sheet": { status: "not-uploaded" },
    "Final Day Sheet": { status: "not-uploaded" },
  }),
  notes: [
    { id: nextId("note"), category: "Follow-Up Question", text: "Need confirmed FOH riser position before we can lock cable path.", owner: "T. Nguyen", status: "open", createdAt: "2026-06-25T08:40:00Z" },
    { id: nextId("note"), category: "Production Concern", text: "Local labor confirmations lagging — escalate to promoter rep if no response by Friday.", owner: "J. Alvarez", status: "open", createdAt: "2026-06-27T15:10:00Z" },
  ],
};

// ---------------------------------------------------------------------------
// Phoenix, AZ — Footprint Center — blockers present
// ---------------------------------------------------------------------------
const phoenix: TourStop = {
  id: "stop-phx",
  tourId: "tour-radius",
  date: "2026-07-19",
  city: "Phoenix",
  state: "AZ",
  loadIn: "07:00",
  doors: "18:30",
  showTime: "20:00",
  curfew: "22:30",
  advanceOwner: "M. Reyes",
  crewCount: 12,
  truckAccessStatus: "missing",
  lastUpdated: "2026-06-24T09:00:00Z",
  venue: {
    name: "Footprint Center",
    address: "201 E Jefferson St, Phoenix, AZ 85004",
    productionContact: { name: "", role: "Production Manager", email: "", phone: "" },
    dockAccess: "",
    truckParking: "Unconfirmed — venue cites concurrent event in lot",
    busParking: "",
    stageDimensions: "",
    fohLocation: "",
    fohCablePath: "",
    internetAvailability: "",
    curfew: "22:30",
    notes: "Venue slow to respond — production contact bounced, need updated info from promoter.",
  },
  schedule: buildSchedule({
    "Truck Arrival": { time: "07:00", department: "Trucking", owner: "M. Reyes", notes: "Dock access unconfirmed", status: "missing" },
    "Load In": { time: "08:00", department: "All Depts", owner: "M. Reyes", notes: "", status: "not-started" },
  }),
  videoPackage: buildVideoPackage(),
  labor: {
    roles: [
      { id: nextId("lab"), role: "Touring Video Crew", touringCount: 6, localCount: 0, callTime: "07:00", notes: "", confirmed: true },
      { id: nextId("lab"), role: "Local Video Hands", touringCount: 0, localCount: 0, callTime: "", notes: "Local call not yet placed", confirmed: false },
      { id: nextId("lab"), role: "LED Hands", touringCount: 0, localCount: 0, callTime: "", notes: "", confirmed: false },
      { id: nextId("lab"), role: "Camera Ops", touringCount: 2, localCount: 0, callTime: "", notes: "", confirmed: false },
      { id: nextId("lab"), role: "Forklift Operator", touringCount: 0, localCount: 0, callTime: "", notes: "Not yet requested", confirmed: false },
      { id: nextId("lab"), role: "Riggers", touringCount: 0, localCount: 0, callTime: "", notes: "", confirmed: false },
    ],
    departmentLeads: "TBD",
    notes: "Local labor call blocked pending venue production contact response.",
    status: "missing",
  },
  power: {
    shorePowerRequired: "",
    distroType: "",
    voltage: "",
    phase: "",
    amperage: "",
    fohPower: "",
    stageVideoPower: "",
    ledPower: "",
    cameraControlPower: "",
    cableLengths: "",
    tieInLocation: "",
    electricianContact: { name: "", role: "House Electrician", email: "", phone: "" },
    status: "missing",
    notes: "No power advance started — blocked on venue contact.",
    checklist: [
      { id: nextId("pchk"), label: "Shore power confirmed with house", status: "missing" },
      { id: nextId("pchk"), label: "Distro walked and approved", status: "not-started" },
      { id: nextId("pchk"), label: "Cable run measured", status: "not-started" },
      { id: nextId("pchk"), label: "Isolated ground confirmed for FOH", status: "not-started" },
    ],
  },
  rigging: {
    ledWallPoints: "",
    motorCount: "",
    motorSize: "",
    cablePickPoints: "",
    riggingPlotReceived: false,
    trimHeight: "",
    weightNotes: "",
    houseRiggerContact: { name: "", role: "House Head Rigger", email: "", phone: "" },
    restrictions: "",
    status: "missing",
    notes: "Rigging plot not requested yet — blocked behind venue contact issue.",
  },
  signal: {
    lines: [
      signalLine("Camera Feeds", "Cam 1 (FOH)", "Switcher In 1", "not-started"),
      signalLine("Fiber Lines", "Stage Fiber Hub", "FOH Fiber Hub", "not-started"),
    ],
    networkNotes: "",
    redundancyNotes: "",
  },
  documents: buildDocuments(),
  notes: [
    { id: nextId("note"), category: "Production Concern", text: "Venue production contact email is bouncing. Escalating to promoter rep today — this is now a blocker for the entire advance.", owner: "M. Reyes", status: "open", createdAt: "2026-06-24T09:00:00Z" },
  ],
};

// ---------------------------------------------------------------------------
// Las Vegas, NV — T-Mobile Arena — not started
// ---------------------------------------------------------------------------
const lasVegas: TourStop = {
  id: "stop-vegas",
  tourId: "tour-radius",
  date: "2026-07-22",
  city: "Las Vegas",
  state: "NV",
  loadIn: "",
  doors: "18:30",
  showTime: "20:00",
  curfew: "",
  advanceOwner: "M. Reyes",
  crewCount: 0,
  truckAccessStatus: "not-started",
  lastUpdated: "2026-06-10T12:00:00Z",
  venue: {
    name: "T-Mobile Arena",
    address: "3780 Las Vegas Blvd S, Las Vegas, NV 89158",
    productionContact: { name: "", role: "", email: "", phone: "" },
    dockAccess: "",
    truckParking: "",
    busParking: "",
    stageDimensions: "",
    fohLocation: "",
    fohCablePath: "",
    internetAvailability: "",
    curfew: "",
    notes: "",
  },
  schedule: buildSchedule({}),
  videoPackage: buildVideoPackage(),
  labor: {
    roles: [],
    departmentLeads: "",
    notes: "",
    status: "not-started",
  },
  power: {
    shorePowerRequired: "",
    distroType: "",
    voltage: "",
    phase: "",
    amperage: "",
    fohPower: "",
    stageVideoPower: "",
    ledPower: "",
    cameraControlPower: "",
    cableLengths: "",
    tieInLocation: "",
    electricianContact: { name: "", role: "", email: "", phone: "" },
    status: "not-started",
    notes: "",
    checklist: [
      { id: nextId("pchk"), label: "Shore power confirmed with house", status: "not-started" },
      { id: nextId("pchk"), label: "Distro walked and approved", status: "not-started" },
      { id: nextId("pchk"), label: "Cable run measured", status: "not-started" },
      { id: nextId("pchk"), label: "Isolated ground confirmed for FOH", status: "not-started" },
    ],
  },
  rigging: {
    ledWallPoints: "",
    motorCount: "",
    motorSize: "",
    cablePickPoints: "",
    riggingPlotReceived: false,
    trimHeight: "",
    weightNotes: "",
    houseRiggerContact: { name: "", role: "", email: "", phone: "" },
    restrictions: "",
    status: "not-started",
    notes: "",
  },
  signal: { lines: [], networkNotes: "", redundancyNotes: "" },
  documents: buildDocuments(),
  notes: [],
};

export const seedData: AppData = {
  tour: {
    id: "tour-radius",
    name: "Radius World Tour",
    season: "Summer 2026",
    artist: "Nova Sterling",
  },
  tourStops: [denver, saltLake, phoenix, lasVegas],
};
