import { prisma } from "./prisma.js";
import type { AuditAction, EntityType } from "@prisma/client";

/**
 * Shallow before/after diff. Only iterates `before`'s keys — `before` always
 * comes from a plain findUnique with no `include`, so its key set is the
 * canonical scalar shape of the row. `after` is often fetched WITH relation
 * includes (for the API response), which would otherwise show up as bogus
 * "changed" fields (e.g. `owner`, `tags`) even when nothing relational moved.
 */
function shallowDiff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (!before || !after) return null;
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(before)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      diff[key] = { before: before[key], after: after[key] };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}

interface RecordAuditParams {
  entityType: EntityType;
  entityId: string;
  action: AuditAction;
  actorId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Writes an AuditLog row for a create/update/delete of a core entity.
 * Called explicitly from route handlers (see src/routes/*.ts) rather than via
 * Prisma middleware, so each route stays in control of exactly what "before"
 * state gets captured for the diff.
 */
export async function recordAudit({ entityType, entityId, action, actorId, before, after }: RecordAuditParams) {
  await prisma.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      actorId: actorId ?? null,
      diff: action === "UPDATE" ? (shallowDiff(before ?? null, after ?? null) as never) : undefined,
      snapshot: action !== "UPDATE" ? ((after ?? before ?? {}) as never) : undefined,
    },
  });
}
