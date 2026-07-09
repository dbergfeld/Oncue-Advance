import { Router } from "express";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const documentsRouter = Router();

documentsRouter.get(
  "/shows/:showId/documents",
  asyncHandler(async (req, res) => {
    const documents = await prisma.document.findMany({ where: { showId: req.params.showId }, orderBy: { name: "asc" } });
    res.json(documents);
  })
);

documentsRouter.put(
  "/documents/:id",
  asyncHandler(async (req, res) => {
    const allowed = ["status", "notes"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) if (key in req.body) data[key] = req.body[key];
    const doc = await prisma.document.update({ where: { id: req.params.id }, data });
    res.json(doc);
  })
);
