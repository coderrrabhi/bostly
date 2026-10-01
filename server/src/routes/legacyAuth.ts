import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "../db";
import { z } from "zod";
import { clearSessionCookie, readSessionUserId, setSessionCookie } from "../lib/session";

const router: IRouter = Router();
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});
const signupSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(6).max(256),
  fullName: z.string().trim().max(200).optional(),
});

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function rateLimitKey(ip: string | undefined, email: string) {
  return createHash("sha256").update(`${ip ?? "unknown"}:${email.toLowerCase()}`).digest("hex");
}

function limited(ip: string | undefined, email: string): boolean {
  const key = rateLimitKey(ip, email);
  const now = Date.now();
  const current = attempts.get(key);
  const attempt = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;
  if (attempt.count >= MAX_ATTEMPTS) return true;
  attempt.count += 1;
  attempts.set(key, attempt);
  return false;
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a valid email and password." }); return; }
  if (limited(req.ip, parsed.data.email)) { res.status(429).json({ error: "Too many attempts. Please try again later." }); return; }

  const result = await pool.query<{ id: string; valid: boolean }>(
    `SELECT u.id::text AS id, crypt($2, c.password_digest) = c.password_digest AS valid
       FROM lovable_legacy.auth_users u
       JOIN lovable_legacy.auth_credentials c ON c.user_id = u.id
      WHERE lower(u.email) = lower($1) LIMIT 1`,
    [parsed.data.email, parsed.data.password],
  );
  const row = result.rows[0];
  if (!row || !row.valid) { res.status(401).json({ error: "Incorrect email or password." }); return; }
  attempts.delete(rateLimitKey(req.ip, parsed.data.email));
  setSessionCookie(res, row.id);
  res.json({ ok: true, userId: row.id });
});

router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a valid email and a password of at least 6 characters." }); return; }
  if (limited(req.ip, parsed.data.email)) { res.status(429).json({ error: "Too many attempts. Please try again later." }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT 1 FROM lovable_legacy.auth_users WHERE lower(email)=lower($1)", [parsed.data.email]);
    if (exists.rows[0]) { await client.query("ROLLBACK"); res.status(409).json({ error: "An account with this email already exists." }); return; }
    const user = await client.query<{ id: string }>(
      `INSERT INTO lovable_legacy.auth_users (email, raw_user_meta_data) VALUES (lower($1), jsonb_build_object('full_name', $2::text)) RETURNING id::text`,
      [parsed.data.email, parsed.data.fullName ?? ""],
    );
    await client.query(
      `INSERT INTO lovable_legacy.auth_credentials (user_id, password_digest) VALUES ($1::uuid, crypt($2, gen_salt('bf')))`,
      [user.rows[0].id, parsed.data.password],
    );
    await client.query("COMMIT");
    setSessionCookie(res, user.rows[0].id);
    res.json({ ok: true, userId: user.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
});

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const id = readSessionUserId(req);
  if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = await pool.query<{ id: string; email: string }>("SELECT id::text, email FROM lovable_legacy.auth_users WHERE id=$1::uuid", [id]);
  if (!user.rows[0]) { clearSessionCookie(res); res.status(401).json({ error: "Unauthorized" }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ user: user.rows[0] });
});

export default router;
