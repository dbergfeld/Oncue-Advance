import { PrismaClient, Department, RecordStatus, ShowStatus, IssueStatus, IssueSeverity, TimelineEntryStatus, EntityType, Priority, RiskLevel } from "@prisma/client";

const prisma = new PrismaClient();

const TIMELINE_STAGES = [
  { key: "show_confirmed", label: "Show Confirmed", order: 1 },
  { key: "venue_contact", label: "Venue Contact", order: 2 },
  { key: "packet_received", label: "Packet Received", order: 3 },
  { key: "packet_reviewed", label: "Packet Reviewed", order: 4 },
  { key: "questions_sent", label: "Questions Sent", order: 5 },
  { key: "answers_received", label: "Answers Received", order: 6 },
  { key: "department_review", label: "Department Review", order: 7 },
  { key: "approvals", label: "Approvals", order: 8 },
  { key: "production_ready", label: "Production Ready", order: 9 },
  { key: "archived", label: "Archived", order: 10 },
];

interface RequirementSeed {
  department: Department;
  name: string;
  description: string;
  priority?: Priority;
}

const REQUIREMENT_TEMPLATE: RequirementSeed[] = [
  // Video
  { department: Department.VIDEO, name: "LED Walls", description: "ROE CB5 upstage wall, ROE CB8 side hangs", priority: Priority.CRITICAL },
  { department: Department.VIDEO, name: "Cameras", description: "Panasonic UC4000 FOH cameras, Panasonic UE-150 PTZ cameras", priority: Priority.CRITICAL },
  { department: Department.VIDEO, name: "Media Servers", description: "Disguise media servers (dual redundant)", priority: Priority.CRITICAL },
  { department: Department.VIDEO, name: "Switcher / Control", description: "ATEM 2 M/E Constellation 4K w/ 2 M/E Advanced Panel", priority: Priority.CRITICAL },
  { department: Department.VIDEO, name: "FOH Video World", description: "FOH video world on riser, dual operator positions", priority: Priority.HIGH },
  { department: Department.VIDEO, name: "Fiber / Cable Paths", description: "TAC fiber lines, stage-to-FOH primary + redundant run", priority: Priority.CRITICAL },
  { department: Department.VIDEO, name: "Records", description: "ISO records off all camera and program feeds", priority: Priority.MEDIUM },
  { department: Department.VIDEO, name: "Comms", description: "Clear-Com wired + RF beltpacks, video department channel", priority: Priority.HIGH },
  { department: Department.VIDEO, name: "Monitoring", description: "Brompton SX40 processors, confidence monitors at FOH and SR", priority: Priority.HIGH },
  { department: Department.VIDEO, name: "Local Video Hands", description: "Local crew call for video department", priority: Priority.HIGH },
  { department: Department.VIDEO, name: "LED Hands", description: "Local crew call for LED build", priority: Priority.HIGH },
  { department: Department.VIDEO, name: "Camera Ops", description: "Touring + local camera operators", priority: Priority.HIGH },
  // Rigging
  { department: Department.RIGGING, name: "LED Wall Rigging Points", description: "Motor plot for video rig", priority: Priority.CRITICAL },
  { department: Department.RIGGING, name: "Motor Plot Received", description: "Signed rigging plot from house", priority: Priority.CRITICAL },
  { department: Department.RIGGING, name: "Weight & Trim Approval", description: "House engineer sign-off on rig weight and trim height", priority: Priority.CRITICAL },
  { department: Department.RIGGING, name: "House Rigger Sign-off", description: "Final walk with house head rigger", priority: Priority.HIGH },
  { department: Department.RIGGING, name: "Riggers", description: "Local rigging crew call", priority: Priority.HIGH },
  // Production (power + site logistics)
  { department: Department.PRODUCTION, name: "Shore Power Confirmed", description: "Shore power requirement confirmed with house", priority: Priority.CRITICAL },
  { department: Department.PRODUCTION, name: "Distro Walked & Approved", description: "Power distro location walked and approved", priority: Priority.HIGH },
  { department: Department.PRODUCTION, name: "Isolated Ground for FOH", description: "Isolated ground circuit confirmed for FOH video", priority: Priority.HIGH },
  { department: Department.PRODUCTION, name: "Cable Run Measured", description: "Feeder cable run measured stage to distro", priority: Priority.MEDIUM },
  { department: Department.PRODUCTION, name: "Electrician Contact Confirmed", description: "House electrician contact on file", priority: Priority.MEDIUM },
  { department: Department.PRODUCTION, name: "Forklift Operator", description: "Certified forklift operator for load-in", priority: Priority.MEDIUM },
  { department: Department.PRODUCTION, name: "Truck Dock Access Confirmed", description: "Dock bay count, clearance, and ramp access confirmed", priority: Priority.CRITICAL },
];

const SCHEDULE_TEMPLATE = [
  "Truck Arrival", "Load In", "Rigging Call", "LED Build", "Camera Build",
  "FOH Setup", "Power Tie-In", "Signal Check", "Camera Check", "Rehearsal",
  "Doors", "Show", "Load Out",
];

const DOCUMENT_TEMPLATE = [
  "Venue Packet", "Rigging Plot", "Stage Plot", "Power Plot", "Seating Map",
  "FOH Location Photo", "Truck Dock Photo", "Cable Path Photo", "Labor Sheet", "Final Day Sheet",
];

async function main() {
  console.log("Clearing existing data...");
  // Order matters — children before parents.
  await prisma.entityTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.communication.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.deliverable.deleteMany();
  await prisma.crewAssignment.deleteMany();
  await prisma.crewMember.deleteMany();
  await prisma.travelLeg.deleteMany();
  await prisma.hotelBooking.deleteMany();
  await prisma.document.deleteMany();
  await prisma.scheduleItem.deleteMany();
  await prisma.task.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.showTimelineEntry.deleteMany();
  await prisma.timelineStageDefinition.deleteMany();
  await prisma.show.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.equipment.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.tour.deleteMany();
  await prisma.user.deleteMany();

  console.log("Seeding users...");
  const [alvarez, reyes, nguyen, okafor, videoDirector, tourManager] = await Promise.all([
    prisma.user.create({ data: { email: "j.alvarez@radiustour.com", name: "J. Alvarez", role: "Advance Coordinator" } }),
    prisma.user.create({ data: { email: "m.reyes@radiustour.com", name: "M. Reyes", role: "Advance Coordinator" } }),
    prisma.user.create({ data: { email: "t.nguyen@radiustour.com", name: "T. Nguyen", role: "Video Systems Lead" } }),
    prisma.user.create({ data: { email: "r.okafor@radiustour.com", name: "R. Okafor", role: "Camera Lead" } }),
    prisma.user.create({ data: { email: "video.director@radiustour.com", name: "Video Director", role: "Video Director" } }),
    prisma.user.create({ data: { email: "tour.manager@radiustour.com", name: "Tour Manager", role: "Tour Manager" } }),
  ]);

  console.log("Seeding timeline stage definitions...");
  const stages = await Promise.all(TIMELINE_STAGES.map((s) => prisma.timelineStageDefinition.create({ data: s })));
  const stageByKey = Object.fromEntries(stages.map((s) => [s.key, s]));

  console.log("Seeding tags...");
  const [blockerTag, followUpTag, houseRelationshipTag] = await Promise.all([
    prisma.tag.create({ data: { label: "blocker", color: "#f87171" } }),
    prisma.tag.create({ data: { label: "follow-up", color: "#facc15" } }),
    prisma.tag.create({ data: { label: "house-relationship", color: "#4ade80" } }),
  ]);

  console.log("Seeding tour...");
  const tour = await prisma.tour.create({
    data: { name: "Radius World Tour", artist: "Nova Sterling", season: "Summer 2026", status: RecordStatus.CONFIRMED, createdBy: alvarez.id },
  });

  console.log("Seeding venues...");
  const ballArena = await prisma.venue.create({
    data: {
      name: "Ball Arena",
      address: "1000 Chopper Cir, Denver, CO 80204",
      timezone: "America/Denver",
      capacity: 19520,
      venueType: "Arena",
      dockAccess: "Dock B, 3 bays, 13'6\" clearance, ramp access confirmed",
      truckCapacity: "8 trailer spots, lot C, overnight approved",
      dockHeight: "48 inches",
      hasRamp: true,
      hasForklift: true,
      powerServiceType: "House distro w/ tour cam-lock breakout",
      powerVoltage: "208V / 3-phase",
      generatorNotes: "Not required — house service sufficient",
      riggingPoints: "24 points across 3 walls",
      weightLimits: "18,400 lbs total video rig, within house grid rating",
      houseRiggingNotes: "No points forward of truss position 4 — house lighting rig priority",
      fohCablePath: "Under-riser conduit run, house-provided, confirmed clear",
      fohMixPosition: "Center arena floor, riser B, 40' throw",
      fiberRoute: "Primary + redundant run stage-to-FOH, both tested",
      wifiAvailable: true,
      dedicatedNetwork: true,
      fiberAvailable: true,
      internetNotes: "Hardwired production internet + venue Wi-Fi, static IP available",
      truckParking: "8 trailer spots, lot C, overnight approved",
      busParking: "4 bus spots, lot C north side",
      airportDistance: "8 miles from DEN",
      windRisk: RiskLevel.LOW,
      heatRisk: RiskLevel.LOW,
      rainRisk: RiskLevel.LOW,
      notes: "Loading dock freight elevator services level 2 only — confirm LED truck route with house carpenter on arrival.",
      createdBy: alvarez.id,
    },
  });
  await prisma.contact.createMany({
    data: [
      { venueId: ballArena.id, entityType: EntityType.VENUE, entityId: ballArena.id, name: "Marcus Webb", role: "Production Manager", email: "mwebb@ballarena.com", phone: "(303) 555-0142" },
      { venueId: ballArena.id, entityType: EntityType.VENUE, entityId: ballArena.id, name: "Dana Foss", role: "House Electrician", email: "dfoss@ballarena.com", phone: "(303) 555-0177" },
      { venueId: ballArena.id, entityType: EntityType.VENUE, entityId: ballArena.id, name: "Pete Callahan", role: "House Head Rigger", email: "pcallahan@ballarena.com", phone: "(303) 555-0199" },
    ],
  });

  const deltaCenter = await prisma.venue.create({
    data: {
      name: "Delta Center",
      address: "301 S Temple, Salt Lake City, UT 84101",
      timezone: "America/Denver",
      capacity: 18306,
      venueType: "Arena",
      dockAccess: "Dock A, 2 bays, height TBD — awaiting confirmation",
      truckCapacity: "6 trailer spots confirmed",
      hasRamp: false,
      hasForklift: false,
      powerServiceType: "House distro, tour breakout TBD",
      powerVoltage: "208V / 3-phase",
      riggingPoints: "TBD — reduced rig for arena floor config",
      houseRiggingNotes: "Chasing rigging plot from house, requested 6/24",
      fohCablePath: "Path not yet confirmed with house carpenter",
      fohMixPosition: "Center floor, riser TBD pending seating kill",
      wifiAvailable: true,
      dedicatedNetwork: false,
      fiberAvailable: false,
      internetNotes: "Venue Wi-Fi only confirmed so far, hardwire requested",
      truckParking: "6 trailer spots confirmed",
      busParking: "3 bus spots, street permit required",
      windRisk: RiskLevel.LOW,
      heatRisk: RiskLevel.MEDIUM,
      rainRisk: RiskLevel.LOW,
      notes: "Awaiting updated venue packet from house PM — requested twice.",
      createdBy: alvarez.id,
    },
  });
  await prisma.contact.createMany({
    data: [
      { venueId: deltaCenter.id, entityType: EntityType.VENUE, entityId: deltaCenter.id, name: "Karen Sato", role: "Production Coordinator", email: "ksato@deltacenter.com", phone: "(801) 555-0110" },
      { venueId: deltaCenter.id, entityType: EntityType.VENUE, entityId: deltaCenter.id, name: "Lena Ford", role: "House Head Rigger", email: "lford@deltacenter.com", phone: "(801) 555-0133" },
    ],
  });

  const footprintCenter = await prisma.venue.create({
    data: {
      name: "Footprint Center",
      address: "201 E Jefferson St, Phoenix, AZ 85004",
      timezone: "America/Phoenix",
      venueType: "Arena",
      truckParking: "Unconfirmed — venue cites concurrent event in lot",
      windRisk: RiskLevel.LOW,
      heatRisk: RiskLevel.HIGH,
      rainRisk: RiskLevel.LOW,
      weatherNotes: "July load-in — extreme heat risk for dock crew, plan hydration breaks",
      notes: "Venue slow to respond — production contact bounced, need updated info from promoter.",
      createdBy: reyes.id,
    },
  });

  const tMobileArena = await prisma.venue.create({
    data: {
      name: "T-Mobile Arena",
      address: "3780 Las Vegas Blvd S, Las Vegas, NV 89158",
      timezone: "America/Los_Angeles",
      venueType: "Arena",
      windRisk: RiskLevel.LOW,
      heatRisk: RiskLevel.HIGH,
      rainRisk: RiskLevel.LOW,
      createdBy: reyes.id,
    },
  });

  console.log("Seeding shows...");
  const denverShow = await prisma.show.create({
    data: {
      tourId: tour.id,
      venueId: ballArena.id,
      date: new Date("2026-07-14"),
      city: "Denver",
      state: "CO",
      loadIn: "08:00",
      doors: "18:30",
      showTime: "20:00",
      curfew: "23:00",
      crewCount: 14,
      status: ShowStatus.CONFIRMED,
      advanceOwnerId: alvarez.id,
      createdBy: alvarez.id,
    },
  });

  const slcShow = await prisma.show.create({
    data: {
      tourId: tour.id,
      venueId: deltaCenter.id,
      date: new Date("2026-07-16"),
      city: "Salt Lake City",
      state: "UT",
      loadIn: "07:30",
      doors: "18:00",
      showTime: "20:00",
      curfew: "23:00",
      crewCount: 12,
      status: ShowStatus.ADVANCING,
      advanceOwnerId: alvarez.id,
      createdBy: alvarez.id,
    },
  });

  const phoenixShow = await prisma.show.create({
    data: {
      tourId: tour.id,
      venueId: footprintCenter.id,
      date: new Date("2026-07-19"),
      city: "Phoenix",
      state: "AZ",
      loadIn: "07:00",
      doors: "18:30",
      showTime: "20:00",
      curfew: "22:30",
      crewCount: 12,
      status: ShowStatus.ADVANCING,
      advanceOwnerId: reyes.id,
      createdBy: reyes.id,
    },
  });

  const vegasShow = await prisma.show.create({
    data: {
      tourId: tour.id,
      venueId: tMobileArena.id,
      date: new Date("2026-07-22"),
      city: "Las Vegas",
      state: "NV",
      doors: "18:30",
      showTime: "20:00",
      status: ShowStatus.PLANNING,
      advanceOwnerId: reyes.id,
      createdBy: reyes.id,
    },
  });

  // -------------------------------------------------------------------------
  // Requirements — status overrides per show, keyed by requirement name.
  // -------------------------------------------------------------------------
  type Overrides = Record<string, { status: RecordStatus; confirmed?: boolean; notes?: string; riskLevel?: RiskLevel; providedBy?: string }>;

  async function seedRequirements(showId: string, overrides: Overrides, ownerByDept: Partial<Record<Department, string>>) {
    for (const req of REQUIREMENT_TEMPLATE) {
      const o = overrides[req.name];
      await prisma.requirement.create({
        data: {
          showId,
          department: req.department,
          name: req.name,
          description: req.description,
          priority: req.priority ?? Priority.MEDIUM,
          status: o?.status ?? RecordStatus.NOT_STARTED,
          confirmed: o?.confirmed ?? o?.status === RecordStatus.CONFIRMED,
          notes: o?.notes ?? "",
          riskLevel: o?.riskLevel ?? RiskLevel.LOW,
          providedBy: o?.providedBy ?? "",
          ownerId: ownerByDept[req.department],
          createdBy: alvarez.id,
        },
      });
    }
  }

  console.log("Seeding requirements...");
  await seedRequirements(
    denverShow.id,
    Object.fromEntries(REQUIREMENT_TEMPLATE.map((r) => [r.name, { status: RecordStatus.CONFIRMED as RecordStatus }])),
    { [Department.VIDEO]: nguyen.id, [Department.RIGGING]: nguyen.id, [Department.PRODUCTION]: alvarez.id }
  );

  await seedRequirements(
    slcShow.id,
    {
      "LED Walls": { status: RecordStatus.NEEDS_REVIEW, notes: "Confirming point count against reduced rig for this date" },
      "Cameras": { status: RecordStatus.CONFIRMED },
      "Media Servers": { status: RecordStatus.CONFIRMED },
      "Switcher / Control": { status: RecordStatus.CONFIRMED },
      "FOH Video World": { status: RecordStatus.NEEDS_REVIEW, notes: "FOH position pending riser confirmation" },
      "Fiber / Cable Paths": { status: RecordStatus.NEEDS_REVIEW },
      "Records": { status: RecordStatus.CONFIRMED },
      "Comms": { status: RecordStatus.CONFIRMED },
      "Monitoring": { status: RecordStatus.NOT_STARTED },
      "Local Video Hands": { status: RecordStatus.NEEDS_REVIEW, notes: "Union call placed, awaiting names" },
      "LED Hands": { status: RecordStatus.NEEDS_REVIEW, notes: "Short 1 hand vs standard call" },
      "Camera Ops": { status: RecordStatus.CONFIRMED },
      "LED Wall Rigging Points": { status: RecordStatus.NEEDS_REVIEW, notes: "TBD — reduced rig for arena floor config" },
      "Motor Plot Received": { status: RecordStatus.MISSING, riskLevel: RiskLevel.HIGH },
      "Weight & Trim Approval": { status: RecordStatus.NOT_STARTED },
      "House Rigger Sign-off": { status: RecordStatus.NOT_STARTED },
      "Riggers": { status: RecordStatus.NEEDS_REVIEW, notes: "Headcount pending house confirmation" },
      "Shore Power Confirmed": { status: RecordStatus.NEEDS_REVIEW },
      "Distro Walked & Approved": { status: RecordStatus.NOT_STARTED },
      "Isolated Ground for FOH": { status: RecordStatus.NOT_STARTED },
      "Cable Run Measured": { status: RecordStatus.NOT_STARTED },
      "Electrician Contact Confirmed": { status: RecordStatus.MISSING },
      "Forklift Operator": { status: RecordStatus.CONFIRMED },
      "Truck Dock Access Confirmed": { status: RecordStatus.NEEDS_REVIEW },
    },
    { [Department.VIDEO]: nguyen.id, [Department.RIGGING]: nguyen.id, [Department.PRODUCTION]: alvarez.id }
  );

  await seedRequirements(
    phoenixShow.id,
    {
      "Truck Dock Access Confirmed": { status: RecordStatus.MISSING, riskLevel: RiskLevel.CRITICAL, notes: "Dock access unconfirmed" },
      "Local Video Hands": { status: RecordStatus.MISSING, notes: "Local call not yet placed" },
      "Shore Power Confirmed": { status: RecordStatus.MISSING, riskLevel: RiskLevel.CRITICAL },
      "Forklift Operator": { status: RecordStatus.MISSING, notes: "Not yet requested" },
    },
    { [Department.PRODUCTION]: reyes.id }
  );

  await seedRequirements(vegasShow.id, {}, {});

  // -------------------------------------------------------------------------
  // Schedule
  // -------------------------------------------------------------------------
  console.log("Seeding schedule items...");
  async function seedSchedule(showId: string, overrides: Record<string, { time?: string; department?: Department; ownerId?: string; notes?: string; status?: RecordStatus }>) {
    for (let i = 0; i < SCHEDULE_TEMPLATE.length; i++) {
      const label = SCHEDULE_TEMPLATE[i];
      const o = overrides[label] ?? {};
      await prisma.scheduleItem.create({
        data: { showId, label, sortOrder: i, time: o.time ?? "", department: o.department, ownerId: o.ownerId, notes: o.notes ?? "", status: o.status ?? RecordStatus.NOT_STARTED },
      });
    }
  }

  await seedSchedule(denverShow.id, {
    "Truck Arrival": { time: "07:00", ownerId: alvarez.id, notes: "3 trucks, staggered 15 min", status: RecordStatus.CONFIRMED },
    "Load In": { time: "08:00", ownerId: alvarez.id, status: RecordStatus.CONFIRMED },
    "Rigging Call": { time: "08:00", department: Department.RIGGING, status: RecordStatus.CONFIRMED },
    "LED Build": { time: "09:00", department: Department.VIDEO, ownerId: nguyen.id, status: RecordStatus.CONFIRMED },
    "Camera Build": { time: "10:30", department: Department.VIDEO, ownerId: okafor.id, status: RecordStatus.CONFIRMED },
    "FOH Setup": { time: "10:30", department: Department.VIDEO, ownerId: nguyen.id, status: RecordStatus.CONFIRMED },
    "Power Tie-In": { time: "09:00", department: Department.PRODUCTION, status: RecordStatus.CONFIRMED },
    "Signal Check": { time: "13:00", department: Department.VIDEO, ownerId: okafor.id, status: RecordStatus.CONFIRMED },
    "Camera Check": { time: "13:30", department: Department.VIDEO, ownerId: okafor.id, status: RecordStatus.CONFIRMED },
    "Rehearsal": { time: "16:00", ownerId: tourManager.id, notes: "Line check only", status: RecordStatus.NEEDS_REVIEW },
    "Doors": { time: "18:30", status: RecordStatus.CONFIRMED },
    "Show": { time: "20:00", ownerId: videoDirector.id, notes: "90 min set, no encore break", status: RecordStatus.CONFIRMED },
    "Load Out": { time: "23:00", ownerId: alvarez.id, notes: "Straight to Salt Lake", status: RecordStatus.CONFIRMED },
  });

  await seedSchedule(slcShow.id, {
    "Truck Arrival": { time: "06:30", ownerId: alvarez.id, status: RecordStatus.CONFIRMED },
    "Load In": { time: "07:30", ownerId: alvarez.id, status: RecordStatus.CONFIRMED },
    "Rigging Call": { time: "07:30", department: Department.RIGGING, notes: "Crew size TBD", status: RecordStatus.NEEDS_REVIEW },
    "LED Build": { time: "08:30", department: Department.VIDEO, ownerId: nguyen.id, status: RecordStatus.NEEDS_REVIEW },
    "Camera Build": { time: "10:00", department: Department.VIDEO, ownerId: okafor.id },
    "FOH Setup": { time: "10:00", department: Department.VIDEO, ownerId: nguyen.id },
    "Power Tie-In": { time: "08:30", department: Department.PRODUCTION, status: RecordStatus.NEEDS_REVIEW },
    "Signal Check": { time: "13:00", department: Department.VIDEO, ownerId: okafor.id },
    "Camera Check": { time: "13:30", department: Department.VIDEO, ownerId: okafor.id },
    "Rehearsal": { time: "16:00", ownerId: tourManager.id },
    "Doors": { time: "18:00", status: RecordStatus.CONFIRMED },
    "Show": { time: "20:00", ownerId: videoDirector.id },
    "Load Out": { time: "23:00", ownerId: alvarez.id },
  });

  await seedSchedule(phoenixShow.id, {
    "Truck Arrival": { time: "07:00", ownerId: reyes.id, notes: "Dock access unconfirmed", status: RecordStatus.MISSING },
    "Load In": { time: "08:00", ownerId: reyes.id },
  });

  await seedSchedule(vegasShow.id, {});

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------
  console.log("Seeding documents...");
  async function seedDocuments(showId: string, uploaded: string[], notes: Record<string, string> = {}) {
    for (const name of DOCUMENT_TEMPLATE) {
      await prisma.document.create({
        data: { showId, name, status: uploaded.includes(name) ? "UPLOADED" : "NOT_UPLOADED", notes: notes[name] ?? "" },
      });
    }
  }
  await seedDocuments(denverShow.id, DOCUMENT_TEMPLATE.filter((d) => d !== "Final Day Sheet"), { "Final Day Sheet": "Finalize after rehearsal confirms timing" });
  await seedDocuments(slcShow.id, ["Stage Plot", "Seating Map", "Truck Dock Photo"], { "Venue Packet": "Requested twice, still outstanding" });
  await seedDocuments(phoenixShow.id, []);
  await seedDocuments(vegasShow.id, []);

  // -------------------------------------------------------------------------
  // Issues
  // -------------------------------------------------------------------------
  console.log("Seeding issues...");
  const issue1 = await prisma.issue.create({
    data: {
      showId: phoenixShow.id,
      venueId: footprintCenter.id,
      title: "Venue production contact unreachable",
      description: "Venue production contact email is bouncing. Escalating to promoter rep — this is now a blocker for the entire advance.",
      department: Department.PRODUCTION,
      severity: IssueSeverity.CRITICAL,
      priority: Priority.CRITICAL,
      ownerId: reyes.id,
      status: IssueStatus.OPEN,
      createdBy: reyes.id,
    },
  });
  await prisma.entityTag.create({ data: { tagId: blockerTag.id, entityType: EntityType.ISSUE, entityId: issue1.id, issueId: issue1.id } });

  const issue2 = await prisma.issue.create({
    data: {
      showId: slcShow.id,
      venueId: deltaCenter.id,
      title: "Rigging plot outstanding",
      description: "Chasing rigging plot from house, requested 6/24. Blocks weight/trim approval.",
      department: Department.RIGGING,
      severity: IssueSeverity.MAJOR,
      priority: Priority.HIGH,
      ownerId: nguyen.id,
      status: IssueStatus.OPEN,
      createdBy: alvarez.id,
    },
  });
  await prisma.entityTag.create({ data: { tagId: followUpTag.id, entityType: EntityType.ISSUE, entityId: issue2.id, issueId: issue2.id } });

  const issue3 = await prisma.issue.create({
    data: {
      showId: slcShow.id,
      venueId: deltaCenter.id,
      title: "Local labor confirmations lagging",
      description: "Local labor confirmations lagging — escalate to promoter rep if no response by Friday.",
      department: Department.VIDEO,
      severity: IssueSeverity.MODERATE,
      priority: Priority.MEDIUM,
      ownerId: alvarez.id,
      status: IssueStatus.OPEN,
      createdBy: alvarez.id,
    },
  });
  await prisma.entityTag.create({ data: { tagId: followUpTag.id, entityType: EntityType.ISSUE, entityId: issue3.id, issueId: issue3.id } });

  const issue4 = await prisma.issue.create({
    data: {
      showId: denverShow.id,
      venueId: ballArena.id,
      title: "Freight elevator restricted to level 2",
      description: "Loading dock freight elevator services level 2 only — confirmed LED truck route with house carpenter on arrival.",
      department: Department.VIDEO,
      severity: IssueSeverity.MINOR,
      priority: Priority.LOW,
      ownerId: nguyen.id,
      status: IssueStatus.RESOLVED,
      resolution: "Routed LED truck via dock B ramp instead of freight elevator — no delay to build schedule.",
      lessonsLearned: "Ask about freight elevator floor restrictions during initial venue advance call, not on arrival.",
      createdBy: nguyen.id,
    },
  });
  await prisma.entityTag.create({ data: { tagId: houseRelationshipTag.id, entityType: EntityType.ISSUE, entityId: issue4.id, issueId: issue4.id } });

  // -------------------------------------------------------------------------
  // Timeline entries — one per show per stage, with dependency chain and
  // status reflecting how far along each show's advance actually is.
  // -------------------------------------------------------------------------
  console.log("Seeding advance timeline...");
  async function seedTimeline(showId: string, completedThrough: number, inProgressStage?: string, blockedStage?: string) {
    const entriesByKey: Record<string, string> = {};
    let previousEntryId: string | null = null;
    for (const stageDef of TIMELINE_STAGES) {
      const stage = stageByKey[stageDef.key];
      let status: TimelineEntryStatus = TimelineEntryStatus.NOT_STARTED;
      if (stageDef.order <= completedThrough) status = TimelineEntryStatus.COMPLETE;
      if (stageDef.key === inProgressStage) status = TimelineEntryStatus.IN_PROGRESS;
      if (stageDef.key === blockedStage) status = TimelineEntryStatus.BLOCKED;

      const entry = await prisma.showTimelineEntry.create({
        data: {
          showId,
          stageId: stage.id,
          status,
          ownerId: alvarez.id,
          startedAt: status !== TimelineEntryStatus.NOT_STARTED ? new Date() : null,
          completedAt: status === TimelineEntryStatus.COMPLETE ? new Date() : null,
          ...(previousEntryId ? { dependsOn: { connect: [{ id: previousEntryId }] } } : {}),
        },
      });
      entriesByKey[stageDef.key] = entry.id;
      previousEntryId = entry.id;
    }
    return entriesByKey;
  }

  await seedTimeline(denverShow.id, 9); // through Production Ready
  await seedTimeline(slcShow.id, 4, "questions_sent");
  await seedTimeline(phoenixShow.id, 1, undefined, "venue_contact");
  await seedTimeline(vegasShow.id, 1);

  // -------------------------------------------------------------------------
  // Advance notes (Comment with entityType=SHOW + category/noteStatus)
  // -------------------------------------------------------------------------
  console.log("Seeding advance notes...");
  await prisma.comment.createMany({
    data: [
      {
        entityType: EntityType.SHOW, entityId: denverShow.id, showId: denverShow.id, authorId: alvarez.id,
        body: "House has hosted us twice before — strong relationship, fast turnaround on requests.",
        category: "GENERAL", noteStatus: "RESOLVED",
      },
      {
        entityType: EntityType.SHOW, entityId: denverShow.id, showId: denverShow.id, authorId: nguyen.id,
        body: "Freight elevator only services level 2 — plan LED truck route accordingly.",
        category: "VENUE_LIMITATION", noteStatus: "MONITORING",
      },
      {
        entityType: EntityType.SHOW, entityId: slcShow.id, showId: slcShow.id, authorId: nguyen.id,
        body: "Need confirmed FOH riser position before we can lock cable path.",
        category: "FOLLOW_UP_QUESTION", noteStatus: "OPEN",
      },
      {
        entityType: EntityType.SHOW, entityId: slcShow.id, showId: slcShow.id, authorId: alvarez.id,
        body: "Local labor confirmations lagging — escalate to promoter rep if no response by Friday.",
        category: "PRODUCTION_CONCERN", noteStatus: "OPEN",
      },
      {
        entityType: EntityType.SHOW, entityId: phoenixShow.id, showId: phoenixShow.id, authorId: reyes.id,
        body: "Venue production contact email is bouncing. Escalating to promoter rep today — this is now a blocker for the entire advance.",
        category: "PRODUCTION_CONCERN", noteStatus: "OPEN",
      },
    ],
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
