import { Router } from "express";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const notesRouter = Router();

// "Notes" are Comments scoped to entityType=SHOW with a category/noteStatus set.
// See prisma/schema.prisma Comment model doc comment for the rationale.

notesRouter.get(
  "/shows/:showId/notes",
  asyncHandler(async (req, res) => {
    const notes = await prisma.comment.findMany({
      where: { entityType: "SHOW", entityId: req.params.showId },
      include: { author: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(notes);
  })
);

notesRouter.post(
  "/shows/:showId/notes",
  asyncHandler(async (req, res) => {
    const note = await prisma.comment.create({
      data: {
        entityType: "SHOW",
        entityId: req.params.showId,
        showId: req.params.showId,
        authorId: req.actorId,
        body: req.body.body ?? "",
        category: req.body.category ?? "GENERAL",
        noteStatus: req.body.noteStatus ?? "OPEN",
      },
      include: { author: true },
    });
    res.status(201).json(note);
  })
);

notesRouter.put(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    const allowed = ["body", "category", "noteStatus"];
    const data: Record<string, unknown> = {};
    for (const key of allowed) if (key in req.body) data[key] = req.body[key];
    const note = await prisma.comment.update({ where: { id: req.params.id }, data, include: { author: true } });
    res.json(note);
  })
);

notesRouter.delete(
  "/notes/:id",
  asyncHandler(async (req, res) => {
    await prisma.comment.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);
