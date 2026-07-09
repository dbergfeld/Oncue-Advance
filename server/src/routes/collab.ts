import { Router } from "express";
import { prisma } from "../prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { EntityType } from "@prisma/client";

export const collabRouter = Router();

/** True if actorId is the record's owner, or an admin. Used to gate comment/attachment deletes. */
async function canManage(actorId: string | null, ownerId: string | null): Promise<boolean> {
  if (!actorId) return false;
  if (actorId === ownerId) return true;
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isAdmin: true } });
  return actor?.isAdmin ?? false;
}

// ---------------------------------------------------------------------------
// Comments — generic, threaded discussion on a Requirement or Issue.
// ---------------------------------------------------------------------------

collabRouter.post(
  "/requirements/:id/comments",
  asyncHandler(async (req, res) => {
    const comment = await prisma.comment.create({
      data: { entityType: "REQUIREMENT", entityId: req.params.id, requirementId: req.params.id, authorId: req.actorId, body: req.body.body ?? "" },
      include: { author: true },
    });
    res.status(201).json(comment);
  })
);

collabRouter.post(
  "/issues/:id/comments",
  asyncHandler(async (req, res) => {
    const comment = await prisma.comment.create({
      data: { entityType: "ISSUE", entityId: req.params.id, issueId: req.params.id, authorId: req.actorId, body: req.body.body ?? "" },
      include: { author: true },
    });
    res.status(201).json(comment);
  })
);

collabRouter.delete(
  "/comments/:id",
  asyncHandler(async (req, res) => {
    const comment = await prisma.comment.findUnique({ where: { id: req.params.id }, select: { authorId: true } });
    if (!comment) {
      res.status(404).json({ error: "Comment not found." });
      return;
    }
    if (!(await canManage(req.actorId, comment.authorId))) {
      res.status(403).json({ error: "Only the comment's author or an admin can delete it." });
      return;
    }
    await prisma.comment.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Attachments — metadata only, no real object storage this pass (see README).
// ---------------------------------------------------------------------------

const ATTACHMENT_PARENTS: Record<string, "requirementId" | "issueId" | "documentId"> = {
  requirements: "requirementId",
  issues: "issueId",
  documents: "documentId",
};

const ATTACHMENT_ENTITY_TYPE: Record<string, EntityType> = {
  requirements: "REQUIREMENT",
  issues: "ISSUE",
  documents: "DOCUMENT",
};

collabRouter.post(
  "/:parent(requirements|issues|documents)/:id/attachments",
  asyncHandler(async (req, res) => {
    const parentField = ATTACHMENT_PARENTS[req.params.parent];
    const attachment = await prisma.attachment.create({
      data: {
        entityType: ATTACHMENT_ENTITY_TYPE[req.params.parent],
        entityId: req.params.id,
        [parentField]: req.params.id,
        fileName: req.body.fileName ?? "untitled",
        mimeType: req.body.mimeType ?? "",
        sizeBytes: req.body.sizeBytes ?? null,
        uploadedById: req.actorId,
      },
    });
    res.status(201).json(attachment);
  })
);

collabRouter.delete(
  "/attachments/:id",
  asyncHandler(async (req, res) => {
    const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id }, select: { uploadedById: true } });
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    if (!(await canManage(req.actorId, attachment.uploadedById))) {
      res.status(403).json({ error: "Only the uploader or an admin can delete this attachment." });
      return;
    }
    await prisma.attachment.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

collabRouter.get(
  "/tags",
  asyncHandler(async (_req, res) => {
    const tags = await prisma.tag.findMany({ orderBy: { label: "asc" } });
    res.json(tags);
  })
);

collabRouter.post(
  "/tags",
  asyncHandler(async (req, res) => {
    const tag = await prisma.tag.create({ data: { label: req.body.label, color: req.body.color ?? "#adff2f" } });
    res.status(201).json(tag);
  })
);

const TAGGABLE_ENTITY_TYPE: Record<string, EntityType> = {
  requirements: "REQUIREMENT",
  issues: "ISSUE",
};
const TAGGABLE_FIELD: Record<string, "requirementId" | "issueId"> = {
  requirements: "requirementId",
  issues: "issueId",
};

collabRouter.post(
  "/:parent(requirements|issues)/:id/tags",
  asyncHandler(async (req, res) => {
    const field = TAGGABLE_FIELD[req.params.parent];
    const entityTag = await prisma.entityTag.create({
      data: {
        tagId: req.body.tagId,
        entityType: TAGGABLE_ENTITY_TYPE[req.params.parent],
        entityId: req.params.id,
        [field]: req.params.id,
      },
      include: { tag: true },
    });
    res.status(201).json(entityTag);
  })
);

collabRouter.delete(
  "/entity-tags/:id",
  asyncHandler(async (req, res) => {
    await prisma.entityTag.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Audit log (read-only)
// ---------------------------------------------------------------------------

collabRouter.get(
  "/audit-log",
  asyncHandler(async (req, res) => {
    const { entityType, entityId } = req.query;
    const logs = await prisma.auditLog.findMany({
      where: {
        entityType: typeof entityType === "string" ? (entityType as EntityType) : undefined,
        entityId: typeof entityId === "string" ? entityId : undefined,
      },
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(logs);
  })
);
