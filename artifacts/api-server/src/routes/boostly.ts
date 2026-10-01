import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  pool,
  ordersTable,
  profilesTable,
  servicesTable,
  supportTicketsTable,
  transactionsTable,
  userRolesTable,
  walletsTable,
} from "@workspace/db";
import { z } from "zod";
import { clerkClient } from "@clerk/express";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth);

function userId(req: AuthenticatedRequest): string {
  return req.userId;
}

/** JIT provisioning replaces the former Supabase auth.users trigger. */
const accountCache = new Map<string, { expiresAt: number; value: Promise<string | null> }>();

// Sign-up stores the chosen name in unsafe metadata because the Clerk
// instance has no first/last name attribute; it becomes the profile name.
function signUpFullName(user: { unsafeMetadata?: Record<string, unknown> | null }): string | null {
  const value = user.unsafeMetadata?.fullName;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

async function provisionAccount(id: string): Promise<string | null> {
  const clerkUser = await clerkClient.users.getUser(id);
  const clerkName = clerkUser.fullName ?? signUpFullName(clerkUser);
  const email =
    clerkUser.emailAddresses.find((address) => address.id === clerkUser.primaryEmailAddressId)?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    `${id}@clerk.local`;
  const legacyId = clerkUser.externalId ?? null;
  const legacy = legacyId
    ? await pool.query<{
        full_name: string | null;
        currency: string | null;
        balance: string | null;
        total_deposited: string | null;
        total_spent: string | null;
        role: "admin" | "moderator" | "user" | null;
      }>(
        `SELECT p.full_name, p.currency, w.balance, w.total_deposited, w.total_spent, r.role::text AS role
           FROM lovable_legacy.profiles p
           LEFT JOIN lovable_legacy.wallets w ON w.user_id = p.user_id
           LEFT JOIN lovable_legacy.user_roles r ON r.user_id = p.user_id
          WHERE p.user_id = $1::uuid
          LIMIT 1`,
        [legacyId],
      )
    : { rows: [] };
  const old = legacy.rows[0];
  await db.transaction(async (tx) => {
    const [profile] = await tx.select({ id: profilesTable.id }).from(profilesTable).where(eq(profilesTable.userId, id)).limit(1);
    if (!profile) {
      await tx.insert(profilesTable).values({ userId: id, email, fullName: old?.full_name ?? clerkName, currency: old?.currency ?? "USD" }).onConflictDoNothing();
      await tx.insert(walletsTable).values({ userId: id, balance: old?.balance ?? "0", totalDeposited: old?.total_deposited ?? "0", totalSpent: old?.total_spent ?? "0" }).onConflictDoNothing();
      await tx.insert(userRolesTable).values({ userId: id, role: old?.role ?? "user" }).onConflictDoNothing();
    } else if (old) {
      await tx.update(profilesTable).set({ email, fullName: old.full_name ?? clerkName, currency: old.currency ?? "USD" }).where(eq(profilesTable.userId, id));
      await tx.update(walletsTable).set({ balance: old.balance ?? "0", totalDeposited: old.total_deposited ?? "0", totalSpent: old.total_spent ?? "0" }).where(eq(walletsTable.userId, id));
      await tx.update(userRolesTable).set({ role: old.role ?? "user" }).where(eq(userRolesTable.userId, id));
    }
  });
  return legacyId;
}

async function ensureAccount(id: string): Promise<string | null> {
  const cached = accountCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = provisionAccount(id).catch((error) => {
    accountCache.delete(id);
    throw error;
  });
  accountCache.set(id, { expiresAt: Date.now() + 15 * 60_000, value });
  return value;
}

// Lightweight identity payload for the auth provider: what every page needs
// before it can render, without the dashboard aggregates.
router.get("/session", async (req, res): Promise<void> => {
  const id = userId(req as AuthenticatedRequest);
  const legacyId = await ensureAccount(id);
  const [[profile], [wallet], [role]] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.userId, id)).limit(1),
    db.select().from(walletsTable).where(eq(walletsTable.userId, id)).limit(1),
    db.select().from(userRolesTable).where(eq(userRolesTable.userId, id)).limit(1),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ profile, wallet, role: role?.role ?? "user", legacyId });
});

router.get("/dashboard", async (req, res): Promise<void> => {
  const id = userId(req as AuthenticatedRequest);
  const legacyId = await ensureAccount(id);
  const [[profile], [wallet], [role], recentOrders, services] = await Promise.all([
    db.select().from(profilesTable).where(eq(profilesTable.userId, id)).limit(1),
    db.select().from(walletsTable).where(eq(walletsTable.userId, id)).limit(1),
    db.select().from(userRolesTable).where(eq(userRolesTable.userId, id)).limit(1),
    db.select().from(ordersTable).where(eq(ordersTable.userId, id)).orderBy(desc(ordersTable.createdAt)).limit(5),
    db.select({ count: servicesTable.id }).from(servicesTable).where(eq(servicesTable.isActive, true)),
  ]);
  const [engagementOrders, legacyStats] = legacyId
    ? await Promise.all([
        pool.query(
          `SELECT o.id, o.order_number, o.status, o.total_price, o.link, o.created_at, o.base_quantity,
                  COALESCE(json_agg(json_build_object('engagement_type', i.engagement_type, 'quantity', i.quantity, 'status', i.status))
                    FILTER (WHERE i.id IS NOT NULL), '[]') AS items
             FROM lovable_legacy.engagement_orders o
             LEFT JOIN lovable_legacy.engagement_order_items i ON i.engagement_order_id = o.id
            WHERE o.user_id = $1::uuid
            GROUP BY o.id, o.order_number, o.status, o.total_price, o.link, o.created_at, o.base_quantity
            ORDER BY o.created_at DESC
            LIMIT 5`,
          [legacyId],
        ),
        pool.query(
          `SELECT count(*)::int AS total_orders,
                  count(*) FILTER (WHERE status = 'completed')::int AS completed_orders,
                  count(*) FILTER (WHERE status IN ('processing','pending'))::int AS active_orders,
                  COALESCE(sum(total_price), 0)::text AS total_spent
             FROM lovable_legacy.engagement_orders
            WHERE user_id = $1::uuid`,
          [legacyId],
        ),
      ])
    : [{ rows: [] }, { rows: [{ total_orders: 0, completed_orders: 0, active_orders: 0, total_spent: "0" }] }];
  res.json({
    profile,
    wallet,
    role: role?.role ?? "user",
    recentOrders,
    engagementOrders: engagementOrders.rows,
    stats: legacyStats.rows[0],
    activeServices: services.length,
  });
});

router.get("/admin/status", async (req, res): Promise<void> => {
  const id = userId(req as AuthenticatedRequest);
  await ensureAccount(id);
  const [role] = await db.select().from(userRolesTable).where(eq(userRolesTable.userId, id)).limit(1);
  res.json({ isAdmin: role?.role === "admin" });
});

router.get("/services", async (_req, res): Promise<void> => {
  const services = await db.select().from(servicesTable).where(eq(servicesTable.isActive, true)).orderBy(servicesTable.category, servicesTable.name);
  res.json(services);
});

router.get("/orders", async (req, res): Promise<void> => {
  const id = userId(req as AuthenticatedRequest);
  await ensureAccount(id);
  const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, id)).orderBy(desc(ordersTable.createdAt));
  res.json(orders);
});

router.post("/orders", (_req, res): void => {
  res.status(503).json({
    error: "Order placement is paused until a verified fulfillment provider is configured. No wallet funds were charged.",
  });
});

router.get("/wallet", async (req, res): Promise<void> => {
  const id = userId(req as AuthenticatedRequest);
  await ensureAccount(id);
  const [[wallet], transactions] = await Promise.all([
    db.select().from(walletsTable).where(eq(walletsTable.userId, id)).limit(1),
    db.select().from(transactionsTable).where(eq(transactionsTable.userId, id)).orderBy(desc(transactionsTable.createdAt)).limit(100),
  ]);
  res.json({ wallet, transactions });
});

router.post("/wallet/deposits", async (_req, res): Promise<void> => {
  // Payment gateways are intentionally not emulated. Credentials must be
  // configured along with a verified webhook implementation before enabling one.
  res.status(501).json({ error: "No payment provider is configured. Wallet deposits are unavailable." });
});

router.get("/support/tickets", async (req, res): Promise<void> => {
  const tickets = await db.select().from(supportTicketsTable).where(eq(supportTicketsTable.userId, userId(req as AuthenticatedRequest))).orderBy(desc(supportTicketsTable.updatedAt));
  res.json(tickets);
});

const createTicket = z.object({ subject: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(10000), category: z.string().max(80).optional(), priority: z.enum(["low", "medium", "high"]).optional(), orderId: z.string().uuid().optional() });
router.post("/support/tickets", async (req, res): Promise<void> => {
  const parsed = createTicket.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid ticket" });
    return;
  }
  const [ticket] = await db.insert(supportTicketsTable).values({ userId: userId(req as AuthenticatedRequest), ...parsed.data }).returning();
  res.status(201).json(ticket);
});

router.get("/settings", async (req, res): Promise<void> => {
  const id = userId(req as AuthenticatedRequest);
  await ensureAccount(id);
  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, id)).limit(1);
  res.json(profile);
});

const updateSettings = z.object({ fullName: z.string().trim().max(200).nullable().optional(), currency: z.string().trim().length(3).optional() });
router.patch("/settings", async (req, res): Promise<void> => {
  const parsed = updateSettings.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
    return;
  }
  const id = userId(req as AuthenticatedRequest);
  await ensureAccount(id);
  const [profile] = await db.update(profilesTable).set(parsed.data).where(eq(profilesTable.userId, id)).returning();
  res.json(profile);
});

export default router;