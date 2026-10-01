import type { NextFunction, Request, Response } from "express";
import { readSessionUserId } from "../lib/session";

export type AuthenticatedRequest = Request & { userId: string };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const candidate = readSessionUserId(req);
  if (!candidate) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as AuthenticatedRequest).userId = candidate;
  next();
}
