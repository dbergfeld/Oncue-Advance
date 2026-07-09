import type { NextFunction, Request, Response } from "express";
import { prisma } from "../prisma.js";
import { getSupabaseAdmin, isSupabaseConfigured } from "../lib/supabaseAdmin.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actorId: string | null;
    }
  }
}

let warnedDemoMode = false;

/** Resolves a Supabase session token to the matching app User, auto-provisioning one on first sign-in. */
async function resolveSupabaseActorId(token: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user?.email) return null;

  const { id: supabaseId, email, user_metadata } = data.user;

  let user = await prisma.user.findUnique({ where: { supabaseId } });
  if (!user) {
    user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      user = await prisma.user.update({ where: { id: user.id }, data: { supabaseId } });
    }
  }
  if (!user) {
    const name = typeof user_metadata?.name === "string" ? user_metadata.name : email;
    user = await prisma.user.create({ data: { email, name, supabaseId, role: "crew" } });
  }

  return user.id;
}

/**
 * Dual-mode actor resolution:
 *  - Supabase configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set): verifies the
 *    `Authorization: Bearer <token>` session against Supabase and resolves/auto-provisions
 *    the matching app User.
 *  - Otherwise: falls back to the Phase 1/2 demo mode — trusts the `x-user-id` header sent
 *    by the client's "acting as" picker (see UserContext). Keeps local dev usable without a
 *    Supabase project. See README "State Management" for the full picture.
 */
export function actorMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.actorId = null;

  if (isSupabaseConfigured()) {
    const authHeader = req.header("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : null;
    if (!token) return next();

    resolveSupabaseActorId(token)
      .then((id) => {
        req.actorId = id;
        next();
      })
      .catch(next);
    return;
  }

  if (!warnedDemoMode) {
    warnedDemoMode = true;
    console.warn(
      "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — running in demo auth mode (trusting the x-user-id header). See README."
    );
  }

  const header = req.header("x-user-id");
  req.actorId = header && header.trim().length > 0 ? header.trim() : null;
  next();
}

/** Blocks writes when no verified actor is resolved. Mounted for all non-GET /api routes. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.actorId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}
