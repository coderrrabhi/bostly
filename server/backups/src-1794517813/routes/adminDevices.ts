import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "../db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { isLegacyAdmin } from "../lib/identity";
import { forgetSessionCache } from "../lib/session";

const router: IRouter = Router();

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), search: z.string().max(200).optional() }),
  z.object({ action: z.literal("set_limit"), userId: z.string().uuid(), maxDevices: z.number().int().min(1).max(20) }),
  z.object({ action: z.literal("remove_device"), userId: z.string().uuid(), deviceId: z.string().uuid() }),
  z.object({ action: z.literal("reset_user"), userId: z.string().uuid() }),
  z.object({ action: z.literal("logout_all") }),
]);

router.post("/admin/devices", requireAuth, async (req, res): Promise<void> => {
  const adminId = (req as AuthenticatedRequest).userId;
  if (!(await isLegacyAdmin(adminId))) { res.status(403).json({ error: "Admin access required." }); return; }
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request." }); return; }
  const a = parsed.data;
  res.setHeader("Cache-Control", "private, no-store");

  if (a.action === "list") {
    const q = `%${(a.search ?? "").trim().toLowerCase()}%`;
    const users = await pool.query(
      `SELECT u.id::text AS user_id, u.email,
              COALESCE(l.max_devices, 1) AS max_devices,
              EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id=u.id AND r.role='admin') AS is_admin,
              COALESCE((SELECT json_agg(json_build_object(
                  'device_id', d.device_id, 'user_agent', d.user_agent, 'ip', d.ip,
                  'first_seen_at', d.first_seen_at, 'last_seen_at', d.last_seen_at,
                  'active', EXISTS (SELECT 1 FROM lovable_legacy.user_sessions s WHERE s.user_id=d.user_id AND s.device_id=d.device_id AND s.revoked_at IS NULL)
                ) ORDER BY d.first_seen_at) FROM lovable_legacy.user_devices d WHERE d.user_id=u.id), '[]'::json) AS devices
         FROM lovable_legacy.auth_users u
         LEFT JOIN lovable_legacy.user_device_limits l ON l.user_id=u.id
        WHERE lower(u.email) LIKE $1
        ORDER BY (SELECT max(d.last_seen_at) FROM lovable_legacy.user_devices d WHERE d.user_id=u.id) DESC NULLS LAST, u.email
        LIMIT 200`, [q]);
    res.json({ users: users.rows });
    return;
  }
  if (a.action === "set_limit") {
    await pool.query(
      `INSERT INTO lovable_legacy.user_device_limits (user_id, max_devices) VALUES ($1::uuid,$2)
       ON CONFLICT (user_id) DO UPDATE SET max_devices=EXCLUDED.max_devices, updated_at=now()`, [a.userId, a.maxDevices]);
  } else if (a.action === "remove_device") {
    await pool.query("DELETE FROM lovable_legacy.user_devices WHERE user_id=$1::uuid AND device_id=$2::uuid", [a.userId, a.deviceId]);
    await pool.query("UPDATE lovable_legacy.user_sessions SET revoked_at=now() WHERE user_id=$1::uuid AND device_id=$2::uuid AND revoked_at IS NULL", [a.userId, a.deviceId]);
  } else if (a.action === "reset_user") {
    await pool.query("DELETE FROM lovable_legacy.user_devices WHERE user_id=$1::uuid", [a.userId]);
    await pool.query("UPDATE lovable_legacy.user_sessions SET revoked_at=now() WHERE user_id=$1::uuid AND revoked_at IS NULL", [a.userId]);
  } else if (a.action === "logout_all") {
    await pool.query("UPDATE lovable_legacy.user_sessions SET revoked_at=now() WHERE revoked_at IS NULL AND user_id <> $1::uuid", [adminId]);
  }
  forgetSessionCache();
  res.json({ ok: true });
});

export default router;
