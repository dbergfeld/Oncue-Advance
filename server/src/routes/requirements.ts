import { Router } from "express";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { recordAudit } from "../audit.js";

export const requirementsRouter = Router();

requirementsRouter.get(
  "/shows/:showId/requirements",
  asyncHandler(async (req, res) => {
    const requirements = await prisma.requirement.findMany({
      where: { showId: req.params.showId },
      include: { owner: true, tags: { include: { tag: true } } },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    });
    res.json(requirements);
  })
);

requirementsRouter.get(
  "/requirements/:id",
  asyncHandler(async (req, res) => {
    const requirement = await prisma.requirement.findUnique({
      where: { id: req.params.id },
      include: {
        owner: true,
        tags: { include: { tag: true } },
        comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
        attachments: true,
      },
    });
    if (!requirement) return res.status(404).json({ error: "Requirement not found" });
    res.json(requirement);
  })
);

requirementsRouter.post(
  "/shows/:showId/requirements",
  asyncHandler(async (req, res) => {
    const requirement = await prisma.requirement.create({
      data: {
        showId: req.params.showId,
        department: req.body.department ?? "PRODUCTION",
        name: req.body.name ?? "New Requirement",
        description: req.body.description ?? "",
        required: req.body.required ?? true,
        priority: req.body.priority ?? "MEDIUM",
        createdBy: req.actorId,
      },
      include: { owner: true, tags: { include: { tag: true } } },
    });
    await recordAudit({ entityType: "REQUIREMENT", entityId: requirement.id, action: "CREATE", actorId: req.actorId, after: requirement });
    res.status(201).json(requirement);
  })
);

requirementsRouter.put(
  "/requirements/:id",
  asyncHandler(async (req, res) => {
    const before = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Requirement not found" });

    const allowed = [
      "department", "name", "description", "required", "providedBy", "confirmed",
      "status", "ownerId", "dueDate", "priority", "riskLevel", "notes", "approvalStatus",
    ];
    const data: Record<string, unknown> = { updatedBy: req.actorId };
    for (const key of allowed) if (key in req.body) data[key] = req.body[key];
    if (typeof data.dueDate === "string") data.dueDate = data.dueDate ? new Date(data.dueDate as string) : null;

    const requirement = await prisma.requirement.update({
      where: { id: req.params.id },
      data,
      include: { owner: true, tags: { include: { tag: true } } },
    });
    await recordAudit({ entityType: "REQUIREMENT", entityId: requirement.id, action: "UPDATE", actorId: req.actorId, before, after: requirement });
    res.json(requirement);
  })
);

requirementsRouter.delete(
  "/requirements/:id",
  asyncHandler(async (req, res) => {
    const before = await prisma.requirement.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Requirement not found" });
    await prisma.requirement.delete({ where: { id: req.params.id } });
    await recordAudit({ entityType: "REQUIREMENT", entityId: req.params.id, action: "DELETE", actorId: req.actorId, before });
    res.status(204).end();
  })
);
