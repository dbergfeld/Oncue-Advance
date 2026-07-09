import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { recordAudit } from "../audit.js";

export const issuesRouter = Router();

const issueInclude = {
  owner: true,
  show: { select: { id: true, city: true, state: true, date: true } },
  venue: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.IssueInclude;

// GET /api/issues?showId=&status=&department=&severity=
issuesRouter.get(
  "/issues",
  asyncHandler(async (req, res) => {
    const { showId, status, department, severity } = req.query;
    const issues = await prisma.issue.findMany({
      where: {
        showId: typeof showId === "string" ? showId : undefined,
        status: typeof status === "string" ? (status as never) : undefined,
        department: typeof department === "string" ? (department as never) : undefined,
        severity: typeof severity === "string" ? (severity as never) : undefined,
      },
      include: issueInclude,
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    });
    res.json(issues);
  })
);

issuesRouter.get(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    const issue = await prisma.issue.findUnique({
      where: { id: req.params.id },
      include: { ...issueInclude, comments: { include: { author: true }, orderBy: { createdAt: "asc" } }, attachments: true },
    });
    if (!issue) return res.status(404).json({ error: "Issue not found" });
    res.json(issue);
  })
);

issuesRouter.post(
  "/issues",
  asyncHandler(async (req, res) => {
    const issue = await prisma.issue.create({
      data: {
        showId: req.body.showId ?? null,
        venueId: req.body.venueId ?? null,
        title: req.body.title ?? "New Issue",
        description: req.body.description ?? "",
        department: req.body.department ?? null,
        severity: req.body.severity ?? "MODERATE",
        priority: req.body.priority ?? "MEDIUM",
        ownerId: req.body.ownerId ?? null,
        createdBy: req.actorId,
      },
      include: issueInclude,
    });
    await recordAudit({ entityType: "ISSUE", entityId: issue.id, action: "CREATE", actorId: req.actorId, after: issue });
    res.status(201).json(issue);
  })
);

issuesRouter.put(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    const before = await prisma.issue.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Issue not found" });

    const allowed = ["title", "description", "department", "severity", "priority", "ownerId", "status", "resolution", "lessonsLearned"];
    const data: Record<string, unknown> = { updatedBy: req.actorId };
    for (const key of allowed) if (key in req.body) data[key] = req.body[key];

    const issue = await prisma.issue.update({ where: { id: req.params.id }, data, include: issueInclude });
    await recordAudit({ entityType: "ISSUE", entityId: issue.id, action: "UPDATE", actorId: req.actorId, before, after: issue });
    res.json(issue);
  })
);

issuesRouter.delete(
  "/issues/:id",
  asyncHandler(async (req, res) => {
    const before = await prisma.issue.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: "Issue not found" });
    await prisma.issue.delete({ where: { id: req.params.id } });
    await recordAudit({ entityType: "ISSUE", entityId: req.params.id, action: "DELETE", actorId: req.actorId, before });
    res.status(204).end();
  })
);
