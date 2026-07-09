import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { recordAudit } from "../audit.js";

export const coreRouter = Router();

// -- Users (also doubles as the dev "acting as" picker + owner dropdown source) --

coreRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
    res.json(users);
  })
);

// -- Tours --

coreRouter.get(
  "/tours",
  asyncHandler(async (_req, res) => {
    const tours = await prisma.tour.findMany({
      include: { shows: { orderBy: { date: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    res.json(tours);
  })
);

// -- Venues --

coreRouter.get(
  "/venues/:id",
  asyncHandler(async (req, res) => {
    const venue = await prisma.venue.findUnique({
      where: { id: req.params.id },
      include: { contacts: true },
    });
    if (!venue) return res.status(404).json({ error: "Venue not found" });
    res.json(venue);
  })
);

coreRouter.put(
  "/venues/:id",
  asyncHandler(async (req, res) => {
    const before = await prisma.venue.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Venue not found" });

    const { id, createdAt, updatedAt, contacts, shows, issues, tags, ...data } = req.body;
    const venue = await prisma.venue.update({
      where: { id: req.params.id },
      data: { ...data, updatedBy: req.actorId },
      include: { contacts: true },
    });
    await recordAudit({ entityType: "VENUE", entityId: venue.id, action: "UPDATE", actorId: req.actorId, before, after: venue });
    res.json(venue);
  })
);

coreRouter.post(
  "/venues/:id/contacts",
  asyncHandler(async (req, res) => {
    const venueId = req.params.id;
    const contact = await prisma.contact.create({
      data: { venueId, entityType: "VENUE", entityId: venueId, name: req.body.name ?? "New Contact", role: req.body.role ?? "", email: req.body.email ?? "", phone: req.body.phone ?? "" },
    });
    res.status(201).json(contact);
  })
);

coreRouter.put(
  "/contacts/:id",
  asyncHandler(async (req, res) => {
    const { id, entityType, entityId, venueId, vendorId, createdAt, updatedAt, ...data } = req.body;
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data });
    res.json(contact);
  })
);

coreRouter.delete(
  "/contacts/:id",
  asyncHandler(async (req, res) => {
    await prisma.contact.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// -- Shows --

const showListInclude = {
  venue: true,
  tour: true,
  advanceOwner: true,
  requirements: true,
  issues: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } } },
  documents: true,
} satisfies Prisma.ShowInclude;

coreRouter.get(
  "/shows",
  asyncHandler(async (_req, res) => {
    const shows = await prisma.show.findMany({ include: showListInclude, orderBy: { date: "asc" } });
    res.json(shows);
  })
);

const showDetailInclude = {
  venue: { include: { contacts: true } },
  tour: true,
  advanceOwner: true,
  requirements: { include: { owner: true }, orderBy: [{ department: "asc" }, { name: "asc" }] },
  issues: { include: { owner: true, tags: { include: { tag: true } } }, orderBy: { createdAt: "desc" } },
  scheduleItems: { include: { owner: true }, orderBy: { sortOrder: "asc" } },
  documents: { orderBy: { name: "asc" } },
  timelineEntries: { include: { stage: true, owner: true, dependsOn: true }, orderBy: { stage: { order: "asc" } } },
  comments: { where: { entityType: "SHOW" }, include: { author: true }, orderBy: { createdAt: "desc" } },
} satisfies Prisma.ShowInclude;

coreRouter.get(
  "/shows/:id",
  asyncHandler(async (req, res) => {
    const show = await prisma.show.findUnique({ where: { id: req.params.id }, include: showDetailInclude });
    if (!show) return res.status(404).json({ error: "Show not found" });
    res.json(show);
  })
);

coreRouter.put(
  "/shows/:id",
  asyncHandler(async (req, res) => {
    const before = await prisma.show.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Show not found" });

    const allowed = ["date", "city", "state", "loadIn", "doors", "showTime", "curfew", "crewCount", "status", "advanceOwnerId", "venueId"];
    const data: Record<string, unknown> = { updatedBy: req.actorId };
    for (const key of allowed) if (key in req.body) data[key] = req.body[key];
    if (typeof data.date === "string") data.date = new Date(data.date);

    const show = await prisma.show.update({ where: { id: req.params.id }, data, include: showDetailInclude });
    await recordAudit({ entityType: "SHOW", entityId: show.id, action: "UPDATE", actorId: req.actorId, before, after: show });
    res.json(show);
  })
);
