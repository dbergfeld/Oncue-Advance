import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actorId: string | null;
    }
  }
}

/**
 * Phase 2 has no real authentication yet (Supabase Auth is a documented,
 * deferred seam — see README). Until then, the client sends the active
 * "acting as" user's id in this header (see client's UserContext), and every
 * write attributes createdBy/updatedBy/AuditLog.actorId to it. Swapping this
 * for a verified session user id is the entire migration to real auth.
 */
export function actorMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("x-user-id");
  req.actorId = header && header.trim().length > 0 ? header : null;
  next();
}
