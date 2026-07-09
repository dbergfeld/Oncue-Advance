import { Router } from "express";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const scheduleRouter = Router();

scheduleRouter.get(
  "/shows/:showId/schedule",
  asyncHandler(async (req, res) => {
    const items = await prisma.scheduleItem.findMany({
      where: { showId: req.params.showId },
      include: { owner: true },
      orderBy: { sortOrder: "asc" },
    });
    res.json(items);
  })
);

scheduleRouter.put(
  "/schedule-items/:id",
  asyncHandler(async (req, res) => {
    const allowed = ["label", "time", "department", "ownerId", "notes", "status", "sortOrder"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) if (key in req.body) data[key] = req.body[key];
    const item = await prisma.scheduleItem.update({ where: { id: req.params.id }, data, include: { owner: true } });
    res.json(item);
  })
);
