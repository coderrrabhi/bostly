import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();
const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function rateLimitKey(ip: string | undefined, email: string) {
  return createHash("sha256").update(`${ip ?? "unknown"}:${email.toLowerCase()}`).digest("hex");
}

router.post("/auth/legacy-login", async (req, res): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }

  const key = rateLimitKey(req.ip, parsed.data.email);
  const now = Date.now();
  const current = attempts.get(key);
  const attempt = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current;
  if (attempt.count >= MAX_ATTEMPTS) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }

  attempt.count += 1;
  attempts.set(key, attempt);

  const legacy = await pool.query<{ legacy_id: string; valid: boolean }>(
    `SELECT u.id::text AS legacy_id,
            crypt($2, c.password_digest) = c.password_digest AS valid
       FROM lovable_legacy.auth_users u
       JOIN lovable_legacy.auth_credentials c ON c.user_id = u.id
      WHERE lower(u.email) = lower($1)
      LIMIT 1`,
    [parsed.data.email, parsed.data.password],
  );

  if (!legacy.rows[0]) {
    res.status(404).json({ error: "Not a legacy account." });
    return;
  }
  if (!legacy.rows[0].valid) {
    res.status(401).json({ error: "Incorrect email or password." });
    return;
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({ error: "Authentication is temporarily unavailable." });
    return;
  }
  const headers = { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" };
  const usersUrl = new URL("https://api.clerk.com/v1/users");
  usersUrl.searchParams.set("limit", "1");
  usersUrl.searchParams.append("email_address", parsed.data.email);
  const usersResponse = await fetch(usersUrl, { headers });
  if (!usersResponse.ok) {
    res.status(503).json({ error: "Authentication is temporarily unavailable." });
    return;
  }
  const users = (await usersResponse.json()) as Array<{ id: string; external_id?: string | null }>;
  let clerkUser = users.find((user) => user.external_id === legacy.rows[0].legacy_id);
  if (!clerkUser && users[0] && !users[0].external_id) {
    const linkResponse = await fetch(`https://api.clerk.com/v1/users/${users[0].id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ external_id: legacy.rows[0].legacy_id }),
    });
    if (linkResponse.ok) clerkUser = await linkResponse.json() as { id: string; external_id?: string | null };
  }
  if (!clerkUser && users.length === 0) {
    const createResponse = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers,
      body: JSON.stringify({
        external_id: legacy.rows[0].legacy_id,
        email_address: [parsed.data.email.toLowerCase()],
        skip_password_requirement: true,
        skip_password_checks: true,
      }),
    });
    if (createResponse.ok) clerkUser = await createResponse.json() as { id: string; external_id?: string | null };
  }
  if (!clerkUser) {
    res.status(503).json({ error: "Imported account is not linked yet." });
    return;
  }

  const tokenResponse = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
    method: "POST",
    headers,
    body: JSON.stringify({ user_id: clerkUser.id, expires_in_seconds: 60 }),
  });
  if (!tokenResponse.ok) {
    res.status(503).json({ error: "Authentication is temporarily unavailable." });
    return;
  }
  const token = (await tokenResponse.json()) as { token: string };
  attempts.delete(key);
  res.json({ ticket: token.token });
});

export default router;