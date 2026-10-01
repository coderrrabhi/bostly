import { Router, type IRouter } from "express";
import { pool } from "../db";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { resolveIdentity, resolveLegacyId } from "../lib/identity";

const router: IRouter = Router();
router.use(requireAuth);

// Kept intentionally small: this is a compatibility endpoint, not a general
// database-function proxy.
const requestSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("get_admin_users_summary"), args: z.unknown().optional() }).strict(),
  z.object({
    name: z.literal("reschedule_organic_run"),
    args: z.object({
      p_run_id: z.string().uuid(),
      p_quantity: z.coerce.number().int().positive(),
      p_scheduled_at: z.string().datetime(),
    }).strict(),
  }).strict(),
]);

function getLegacyId(req: AuthenticatedRequest): Promise<string> {
  return resolveLegacyId(req.userId);
}

async function requireLegacyAdmin(req: AuthenticatedRequest): Promise<void> {
  const identity = await resolveIdentity(req.userId);
  if (!identity.isAdmin) {
    const error = new Error("Administrator access is required.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
}

router.post("/legacy/rpc", async (req, res): Promise<void> => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: "This legacy RPC is unavailable through the compatibility API." });
    return;
  }

  try {
    if (parsed.data.name === "reschedule_organic_run") {
      const legacyId = await getLegacyId(req as AuthenticatedRequest);
      const { p_run_id, p_quantity, p_scheduled_at } = parsed.data.args;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const runResult = await client.query(
          `SELECT rs.id,rs.status
             FROM lovable_legacy.organic_run_schedule rs
             LEFT JOIN lovable_legacy.engagement_order_items eoi
               ON eoi.id=rs.engagement_order_item_id
             LEFT JOIN lovable_legacy.engagement_orders eo
               ON eo.id=eoi.engagement_order_id
            WHERE rs.id=$1::uuid AND eo.user_id=$2::uuid
            FOR UPDATE OF rs`,
          [p_run_id, legacyId],
        );
        const run = runResult.rows[0];
        if (!run) throw new Error("Run not found or you do not have permission to edit it.");
        if (["completed", "partial", "sent", "cancelled"].includes(String(run.status).toLowerCase())) {
          throw new Error("Cannot reschedule a completed or cancelled run.");
        }

        await client.query(
          `UPDATE lovable_legacy.organic_run_schedule
              SET quantity_to_send=$1,
                  base_quantity=$1,
                  variance_applied=0,
                  scheduled_at=$2::timestamptz,
                  status='pending',
                  error_message=NULL,
                  retry_count=0,
                  provider_order_id=NULL,
                  provider_response=NULL,
                  provider_status=NULL,
                  provider_start_count=NULL,
                  provider_remains=NULL,
                  provider_charge=NULL,
                  last_status_check=NULL,
                  started_at=NULL,
                  completed_at=NULL,
                  provider_account_id=NULL,
                  provider_account_name=NULL,
                  user_provider_account_id=NULL,
                  user_provider_account_name=NULL,
                  rotation_lock_key=NULL,
                  updated_at=now()
            WHERE id=$3::uuid`,
          [p_quantity, p_scheduled_at, p_run_id],
        );
        await client.query("COMMIT");
        res.json({
          data: {
            success: true,
            run_id: p_run_id,
            quantity_to_send: p_quantity,
            scheduled_at: p_scheduled_at,
            extra_charged: 0,
            new_balance: 0,
          },
          error: null,
        });
        return;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    await requireLegacyAdmin(req as AuthenticatedRequest);
    // Each related relation is read in an independent lateral subquery. This
    // preserves profiles as the base relation and prevents aggregate joins
    // from multiplying user rows.
    const result = await pool.query<Record<string, unknown>>(
      `SELECT
         p.id,
         p.user_id,
         p.email,
         p.full_name,
         p.currency,
         p.created_at,
         COALESCE(p.is_banned, false) AS is_banned,
         p.banned_at,
         p.banned_reason,
         COALESCE(wallet.balance, 0)::double precision AS balance,
         COALESCE(wallet.total_deposited, 0)::double precision AS total_deposited,
         COALESCE(wallet.total_spent, 0)::double precision AS total_spent,
         COALESCE(user_role.role, 'user') AS role,
         COALESCE(subscription.plan_type, 'none') AS plan_type,
         COALESCE(subscription.status, 'inactive') AS subscription_status,
         subscription.expires_at AS subscription_expires,
         COALESCE(single_orders.active_count, 0)::integer AS active_single_orders,
         COALESCE(single_orders.paused_count, 0)::integer AS paused_single_orders,
         COALESCE(engagement_orders.active_count, 0)::integer AS active_engagement_orders,
         COALESCE(engagement_orders.paused_count, 0)::integer AS paused_engagement_orders
       FROM lovable_legacy.profiles p
       LEFT JOIN LATERAL (
         SELECT w.balance, w.total_deposited, w.total_spent
           FROM lovable_legacy.wallets w
          WHERE w.user_id = p.user_id
          LIMIT 1
       ) wallet ON true
       LEFT JOIN LATERAL (
         SELECT ur.role::text AS role
           FROM lovable_legacy.user_roles ur
          WHERE ur.user_id = p.user_id
          ORDER BY ur.created_at DESC
          LIMIT 1
       ) user_role ON true
       LEFT JOIN LATERAL (
         SELECT s.plan_type, s.status, s.expires_at
           FROM lovable_legacy.subscriptions s
          WHERE s.user_id = p.user_id
          ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
          LIMIT 1
       ) subscription ON true
       LEFT JOIN LATERAL (
         SELECT
           count(*) FILTER (WHERE o.status IN ('pending', 'processing'))::integer AS active_count,
           count(*) FILTER (WHERE o.status = 'paused')::integer AS paused_count
           FROM lovable_legacy.orders o
          WHERE o.user_id = p.user_id
       ) single_orders ON true
       LEFT JOIN LATERAL (
         SELECT
           count(*) FILTER (WHERE eo.status IN ('pending', 'processing'))::integer AS active_count,
           count(*) FILTER (WHERE eo.status = 'paused')::integer AS paused_count
           FROM lovable_legacy.engagement_orders eo
          WHERE eo.user_id = p.user_id
       ) engagement_orders ON true
       ORDER BY p.created_at DESC`,
    );
    res.json({ data: result.rows, error: null });
  } catch (error) {
    const status = (error as Error & { status?: number }).status
      ?? (error instanceof Error && error.message.includes("not linked") ? 401 : 500);
    if (status >= 500) console.warn(`[legacy-rpc] ${parsed.success ? parsed.data.name : "unknown"} failed`);
    res.status(status).json({
      data: null,
      error: error instanceof Error ? error.message : "Legacy RPC failed",
    });
  }
});

export default router;