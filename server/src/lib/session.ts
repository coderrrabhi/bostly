import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { pool } from "../db";

export const SESSION_COOKIE = "boostly_session";
export const DEVICE_COOKIE = "boostly_device";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEVICE_MAX_AGE_MS = 5 * 365 * 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars).");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie ?? "";
  const match = raw.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function createSessionToken(userId: string, sessionId: string): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, sid: sessionId, exp: Date.now() + MAX_AGE_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Signature-only parse. Tokens without a session id (old format) are rejected. */
export function readSessionToken(req: Request): { uid: string; sid: string } | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid?: string; sid?: string; exp?: number };
    if (!data.uid || !data.sid || !data.exp || data.exp < Date.now()) return null;
    return { uid: data.uid, sid: data.sid };
  } catch {
    return null;
  }
}

const cache = new Map<string, number>();
const CACHE_MS = 10_000;
export function forgetSessionCache(): void { cache.clear(); }

/** Full check: signature + session row still active + device still approved. */
export async function readSessionUserId(req: Request): Promise<string | null> {
  const tok = readSessionToken(req);
  if (!tok) return null;
  const hit = cache.get(tok.sid);
  if (hit && hit > Date.now()) return tok.uid;
  const r = await pool.query(
    `SELECT 1 FROM lovable_legacy.user_sessions s
       WHERE s.id = $1::uuid AND s.user_id = $2::uuid AND s.revoked_at IS NULL
         AND (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = s.user_id AND role = 'admin')
              OR EXISTS (SELECT 1 FROM lovable_legacy.user_devices d WHERE d.user_id = s.user_id AND d.device_id = s.device_id))`,
    [tok.sid, tok.uid],
  );
  if (!r.rows[0]) { cache.delete(tok.sid); return null; }
  cache.set(tok.sid, Date.now() + CACHE_MS);
  if (cache.size > 5000) cache.clear();
  pool.query("UPDATE lovable_legacy.user_sessions SET last_seen_at = now() WHERE id = $1::uuid AND last_seen_at < now() - interval '5 minutes'", [tok.sid]).catch(() => undefined);
  return tok.uid;
}

export function getOrSetDeviceId(req: Request, res: Response): string {
  const existing = readCookie(req, DEVICE_COOKIE);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const id = randomUUID();
  res.cookie(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DEVICE_MAX_AGE_MS,
    path: "/",
  });
  return id;
}

export function setSessionCookie(res: Response, userId: string, sessionId: string): void {
  res.cookie(SESSION_COOKIE, createSessionToken(userId, sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}
