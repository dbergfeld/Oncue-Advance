import { Router } from "express";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { recordAudit } from "../audit.js";

export const timelineRouter = Router();

timelineRouter.get(
  "/shows/:showId/timeline",
  asyncHandler(async (req, res) => {
    const entries = await prisma.showTimelineEntry.findMany({
      where: { showId: req.params.showId },
      include: { stage: true, owner: true, dependsOn: { include: { stage: true } } },
      orderBy: { stage: { order: "asc" } },
    });
    res.json(entries);
  })
);

timelineRouter.put(
  "/timeline-entries/:id",
  asyncHandler(async (req, res) => {
    const before = await prisma.showTimelineEntry.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Timeline entry not found" });

    const allowed = ["status", "ownerId", "notes", "startedAt", "completedAt"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) if (key in req.body) data[key] = req.body[key];
    if (typeof data.startedAt === "string") data.startedAt = data.startedAt ? new Date(data.startedAt as string) : null;
    if (typeof data.completedAt === "string") data.completedAt = data.completedAt ? new Date(data.completedAt as string) : null;

    // Convenience: flipping status to COMPLETE stamps completedAt if the
    // caller didn't set one explicitly; moving off COMPLETE clears it.
    if (data.status === "COMPLETE" && !data.completedAt) data.completedAt = new Date();
    if (data.status && data.status !== "COMPLETE" && !("completedAt" in req.body)) data.completedAt = null;
    if (data.status && data.status !== "NOT_STARTED" && !before.startedAt && !("startedAt" in req.body)) data.startedAt = new Date();

    const entry = await prisma.showTimelineEntry.update({
      where: { id: req.params.id },
      data,
      include: { stage: true, owner: true, dependsOn: { include: { stage: true } } },
    });
    await recordAudit({ entityType: "TIMELINE_ENTRY", entityId: entry.id, action: "UPDATE", actorId: req.actorId, before, after: entry });
    res.json(entry);
  })
);
