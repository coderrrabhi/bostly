import { Router, type IRouter } from "express";
import { pool } from "../db";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { resolveIdentity, resolveLegacyId } from "../lib/identity";

const router: IRouter = Router(); router.use(requireAuth);
const schema = z.object({ table: z.enum(["user_provider_accounts", "user_services", "user_bundles", "user_bundle_items", "user_bundle_item_providers", "subscriptions", "subscription_requests", "engagement_orders", "engagement_order_items", "organic_run_schedule"]), action: z.enum(["insert", "update", "delete", "upsert"]), values: z.any().optional(), filters: z.array(z.object({ operator: z.enum(["eq", "neq", "in", "is", "notIn", "lt"]).optional(), column: z.string(), value: z.any() })).default([]) });
const columns: Record<string, string[]> = {
  user_provider_accounts: [], user_services: ["name", "category", "type", "rate", "min_quantity", "max_quantity", "refill", "cancel_allowed", "is_active"],
  user_bundles: ["name", "description", "platform"], user_bundle_items: ["engagement_type", "quantity"],
  user_bundle_item_providers: ["enabled", "provider_service_id", "priority"],
};
function user(req: AuthenticatedRequest): Promise<string> {
  return resolveLegacyId(req.userId);
}
function identity(req: AuthenticatedRequest): Promise<{ legacyId: string; isAdmin: boolean }> {
  return resolveIdentity(req.userId);
}
function uuidFilter(filters: { column: string; value?: unknown }[]): string | undefined { const id = filters.find((f) => f.column === "id")?.value; return typeof id === "string" ? id : undefined; }
const uuid = z.string().uuid();
const subscriptionPlan = z.enum(["none", "monthly", "yearly", "lifetime"]);
const subscriptionStatus = z.enum(["inactive", "active", "expired", "cancelled"]);
const requestPlan = z.enum(["monthly", "yearly", "lifetime"]);
const requestStatus = z.enum(["pending", "approved", "rejected"]);
const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid timestamp");
const requestInsert = z.object({
  // Legacy callers send these, but authority comes exclusively from the session.
  user_id: z.unknown().optional(),
  status: z.unknown().optional(),
  full_name: z.string().trim().min(1, "Full name is required.").max(100),
  email: z.string().trim().email("A valid email is required.").max(254),
  phone: z.string().trim().min(7, "A valid phone number is required.").max(30)
    .regex(/^\+?[\d\s()\-]+$/, "A valid phone number is required."),
  plan_type: requestPlan,
  message: z.string().trim().max(300).nullable().optional(),
});
const subscriptionWrite = z.object({
  user_id: z.string().optional(),
  // Never trust this client field; the authenticated admin is written instead.
  activated_by: z.unknown().optional(),
  plan_type: subscriptionPlan.optional(),
  status: subscriptionStatus.optional(),
  activated_at: timestamp.nullable().optional(),
  expires_at: timestamp.nullable().optional(),
});
const requestUpdate = z.object({
  status: requestStatus.optional(),
  reviewed_at: timestamp.nullable().optional(),
  admin_notes: z.string().trim().max(2000).nullable().optional(),
});

function oneObject(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? value.length === 1 ? value[0] : null : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("A single mutation object is required.");
  return row as Record<string, unknown>;
}
function legacyUuid(value: unknown, clerkId: string, legacyId: string): string {
  if (value === clerkId) return legacyId;
  return uuid.parse(value);
}
async function profileExists(userId: string): Promise<boolean> {
  return !!(await pool.query("SELECT 1 FROM lovable_legacy.profiles WHERE user_id=$1::uuid LIMIT 1", [userId])).rows[0];
}
async function upsertSubscriptionWithoutUniqueConstraint(values: [string, string, string, string | null, string | null, string]) {
  // The imported legacy schema currently has no unique index on subscriptions.user_id,
  // despite the original table definition. Serialize this compatibility fallback so it
  // retains one-row-per-user upsert behavior until the schema is repaired.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [values[0]]);
    const updated = await client.query(`UPDATE lovable_legacy.subscriptions SET plan_type=$2, status=$3,
      activated_at=$4::timestamptz, expires_at=$5::timestamptz, activated_by=$6::uuid, updated_at=now()
      WHERE user_id=$1::uuid RETURNING *`, values);
    if (updated.rows.length) { await client.query("COMMIT"); return updated; }
    const inserted = await client.query(`INSERT INTO lovable_legacy.subscriptions
      (user_id,plan_type,status,activated_at,expires_at,activated_by)
      VALUES ($1::uuid,$2,$3,$4::timestamptz,$5::timestamptz,$6::uuid) RETURNING *`, values);
    await client.query("COMMIT");
    return inserted;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
function targetFilter(filters: { column: string; value?: unknown }[], clerkId: string, legacyId: string): { column: "id" | "user_id"; value: string } {
  const id = filters.find((filter) => filter.column === "id")?.value;
  const userId = filters.find((filter) => filter.column === "user_id")?.value;
  if (id !== undefined) return { column: "id", value: uuid.parse(id) };
  if (userId !== undefined) return { column: "user_id", value: legacyUuid(userId, clerkId, legacyId) };
  throw new Error("An id or user_id filter is required.");
}
async function mutateSubscriptions(req: AuthenticatedRequest, table: "subscriptions" | "subscription_requests", action: string, rawValues: unknown, filters: { column: string; value?: unknown }[], res: import("express").Response): Promise<void> {
  const actor = await identity(req);
  const values = oneObject(rawValues ?? {});
  if (table === "subscriptions") {
    if (!actor.isAdmin) { res.status(403).json({ data: null, error: "Administrator access is required to manage subscriptions." }); return; }
    if (!["insert", "upsert", "update"].includes(action)) { res.status(400).json({ data: null, error: "Unsupported subscription mutation." }); return; }
    const write = subscriptionWrite.parse(values);
    if (action === "insert" || action === "upsert") {
      if (!write.user_id || !write.plan_type || !write.status) throw new Error("user_id, plan_type, and status are required.");
      const targetUserId = legacyUuid(write.user_id, req.userId, actor.legacyId);
      if (!(await profileExists(targetUserId))) throw new Error("The subscription user must have a profile.");
      const queryValues: [string, string, string, string | null, string | null, string] = [targetUserId, write.plan_type, write.status, write.activated_at ?? null, write.expires_at ?? null, actor.legacyId];
      let result;
      if (action === "insert") {
        result = await pool.query(`INSERT INTO lovable_legacy.subscriptions
            (user_id,plan_type,status,activated_at,expires_at,activated_by)
            VALUES ($1::uuid,$2,$3,$4::timestamptz,$5::timestamptz,$6::uuid) RETURNING *`, queryValues);
      } else {
        try {
          result = await pool.query(`INSERT INTO lovable_legacy.subscriptions
            (user_id,plan_type,status,activated_at,expires_at,activated_by)
            VALUES ($1::uuid,$2,$3,$4::timestamptz,$5::timestamptz,$6::uuid)
            ON CONFLICT (user_id) DO UPDATE SET plan_type=EXCLUDED.plan_type, status=EXCLUDED.status,
              activated_at=EXCLUDED.activated_at, expires_at=EXCLUDED.expires_at,
              activated_by=EXCLUDED.activated_by, updated_at=now() RETURNING *`, queryValues);
        } catch (error) {
          if ((error as { code?: string }).code !== "42P10") throw error;
          result = await upsertSubscriptionWithoutUniqueConstraint(queryValues);
        }
      }
      res.status(action === "insert" ? 201 : 200).json({ data: result.rows, error: null }); return;
    }
    const target = targetFilter(filters, req.userId, actor.legacyId);
    if (target.column === "user_id" && !(await profileExists(target.value))) throw new Error("The subscription user must have a profile.");
    const data = Object.fromEntries(Object.entries(write).filter(([key]) => key !== "user_id" && key !== "activated_by"));
    if (!Object.keys(data).length) throw new Error("No writable fields supplied.");
    const keys = Object.keys(data);
    const result = await pool.query(`UPDATE lovable_legacy.subscriptions SET ${keys.map((key, index) => `${key}=$${index + 1}`).join(",")}, activated_by=$${keys.length + 1}::uuid, updated_at=now() WHERE ${target.column}=$${keys.length + 2}::uuid RETURNING *`,
      [...Object.values(data), actor.legacyId, target.value]);
    res.json({ data: result.rows, error: null }); return;
  }

  if (action === "insert") {
    const insert = requestInsert.parse(values);
    // The caller's user_id is deliberately ignored: Clerk IDs are never stored in UUID columns.
    if (!(await profileExists(actor.legacyId))) throw new Error("Your account does not have a legacy profile.");
    const result = await pool.query(`INSERT INTO lovable_legacy.subscription_requests
      (user_id,full_name,email,phone,plan_type,message,status)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,'pending') RETURNING *`,
    [actor.legacyId, insert.full_name, insert.email, insert.phone, insert.plan_type, insert.message ?? null]);
    res.status(201).json({ data: result.rows, error: null }); return;
  }
  if (action !== "update") { res.status(400).json({ data: null, error: "Unsupported subscription request mutation." }); return; }
  if (!actor.isAdmin) { res.status(403).json({ data: null, error: "Administrator access is required to review subscription requests." }); return; }
  const update = requestUpdate.parse(values);
  if (!Object.keys(update).length) throw new Error("No writable fields supplied.");
  const target = targetFilter(filters, req.userId, actor.legacyId);
  if (target.column === "user_id" && !(await profileExists(target.value))) throw new Error("The request user must have a profile.");
  const keys = Object.keys(update);
  const result = await pool.query(`UPDATE lovable_legacy.subscription_requests SET ${keys.map((key, index) => `${key}=$${index + 1}`).join(",")}, reviewed_by=$${keys.length + 1}::uuid, updated_at=now() WHERE ${target.column}=$${keys.length + 2}::uuid RETURNING *`,
    [...Object.values(update), actor.legacyId, target.value]);
  res.json({ data: result.rows, error: null });
}
async function owns(client: typeof pool, table: string, id: string, uid: string): Promise<boolean> {
  const q = table === "user_bundle_items"
    ? "SELECT 1 FROM lovable_legacy.user_bundle_items WHERE id=$1::uuid AND user_id=$2::uuid"
    : table === "user_bundle_item_providers"
      ? "SELECT 1 FROM lovable_legacy.user_bundle_item_providers WHERE id=$1::uuid AND user_id=$2::uuid"
      : `SELECT 1 FROM lovable_legacy.${table} WHERE id=$1::uuid AND user_id=$2::uuid`;
  return !!(await client.query(q, [id, uid])).rows[0];
}
router.post("/legacy/mutate", async (req, res): Promise<void> => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid mutation" }); return; }
  const { table, action, filters } = parsed.data;
  try {
      if (table === "subscriptions" || table === "subscription_requests") {
        await mutateSubscriptions(req as AuthenticatedRequest, table, action, parsed.data.values, filters, res);
        return;
      }
    const uid = await user(req as AuthenticatedRequest); const values = parsed.data.values ?? {};
    if (table === "engagement_orders") {
      const id = uuid.parse(filters.find((filter) => filter.column === "id" && filter.operator === "eq")?.value);
      const status = z.enum(["paused", "processing", "cancelled", "partial", "failed"]).parse(
        typeof values === "object" && values !== null ? (values as Record<string, unknown>).status : undefined,
      );
      if (action !== "update") {
        res.status(400).json({ error: "Only order status updates are supported." });
        return;
      }
      const result = await pool.query(
        "UPDATE lovable_legacy.engagement_orders SET status=$1, updated_at=now() WHERE id=$2::uuid AND user_id=$3::uuid RETURNING *",
        [status, id, uid],
      );
      res.json({ data: result.rows, error: null });
      return;
    }
    if (table === "engagement_order_items") {
      if (action !== "update") {
        res.status(400).json({ error: "Only item status updates are supported." });
        return;
      }
      const status = z.enum(["paused", "processing", "cancelled"]).parse(
        typeof values === "object" && values !== null ? (values as Record<string, unknown>).status : undefined,
      );
      const idFilter = filters.find((filter) => filter.column === "id" && filter.operator === "eq");
      const orderFilter = filters.find((filter) => filter.column === "engagement_order_id" && filter.operator === "eq");
      if (!idFilter && !orderFilter) throw new Error("An item or order id is required.");
      const targetId = uuid.parse((idFilter ?? orderFilter)?.value);
      const result = await pool.query(
        `UPDATE lovable_legacy.engagement_order_items item
         SET status=$1, updated_at=now()
         FROM lovable_legacy.engagement_orders orders
         WHERE item.engagement_order_id=orders.id
           AND orders.user_id=$2::uuid
           AND ${idFilter ? "item.id" : "item.engagement_order_id"}=$3::uuid
           AND item.status NOT IN ('completed','cancelled','failed')
         RETURNING item.*`,
        [status, uid, targetId],
      );
      res.json({ data: result.rows, error: null });
      return;
    }
    if (table === "organic_run_schedule") {
      const idFilter = filters.find((filter) => filter.column === "id" && filter.operator === "in");
      if (action !== "update") {
        res.status(400).json({ error: "Only run status updates are supported." });
        return;
      }
      const requestedStatus = typeof values === "object" && values !== null && "status" in values
        ? (values as Record<string, unknown>).status
        : undefined;
      if (requestedStatus !== "pending" && requestedStatus !== "cancelled") throw new Error("Unsupported run status.");
      const ids = idFilter ? z.array(uuid).min(1).max(500).parse(idFilter.value) : null;
      const itemId = !ids
        ? uuid.parse(filters.find((filter) => filter.column === "engagement_order_item_id" && filter.operator === "eq")?.value)
        : null;
      const before = filters.find((filter) => filter.column === "scheduled_at" && filter.operator === "lt")?.value;
      const beforeTimestamp = before === undefined ? null : timestamp.parse(before);
      const result = await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule run
         SET status=$1, error_message=${requestedStatus === "pending" ? "NULL" : "'Cancelled by user'"},
             provider_order_id=${requestedStatus === "pending" ? "NULL" : "run.provider_order_id"},
             provider_response=NULL, provider_status=NULL, started_at=NULL,
             completed_at=${requestedStatus === "pending" ? "NULL" : "now()"},
             retry_count=${requestedStatus === "pending" ? "0" : "retry_count"}, updated_at=now()
         FROM lovable_legacy.engagement_order_items item
         JOIN lovable_legacy.engagement_orders orders ON orders.id=item.engagement_order_id
         WHERE run.engagement_order_item_id=item.id
           AND orders.user_id=$2::uuid
           AND (${ids ? "run.id=ANY($3::uuid[])" : "run.engagement_order_item_id=$3::uuid"})
           AND run.status ${requestedStatus === "pending" ? "='failed'" : "IN ('pending','failed','started')"}
           AND ($4::timestamptz IS NULL OR run.scheduled_at < $4::timestamptz)
         RETURNING run.*`,
        [requestedStatus, uid, ids ?? itemId, beforeTimestamp],
      );
      res.json({ data: result.rows, error: null });
      return;
    }
    const allowed = columns[table]; const data = Object.fromEntries(Object.entries(values).filter(([k]) => allowed.includes(k)));
    const id = uuidFilter(filters);
    if (table === "user_provider_accounts") {
      if (action !== "delete" || !id || !(await owns(pool, table, id, uid))) { res.status(403).json({ error: "Provider accounts must be created and changed through the provider endpoint." }); return; }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM lovable_legacy.user_bundle_item_providers WHERE user_provider_account_id=$1::uuid AND user_id=$2::uuid", [id, uid]);
        await client.query("DELETE FROM lovable_legacy.user_services WHERE user_provider_account_id=$1::uuid AND user_id=$2::uuid", [id, uid]);
        await client.query("DELETE FROM lovable_legacy.user_provider_accounts WHERE id=$1::uuid AND user_id=$2::uuid", [id, uid]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      res.json({ data: [], error: null }); return;
    }
    if ((action === "update" || action === "delete") && (!id || !(await owns(pool, table, id, uid)))) { res.status(404).json({ error: "Record not found" }); return; }
    if (action === "insert") {
      if (table === "user_services") {
        const account = typeof values.user_provider_account_id === "string" ? values.user_provider_account_id : "";
        const serviceId = typeof values.provider_service_id === "string" ? values.provider_service_id.trim() : "";
        if (!account || !serviceId || !(await owns(pool, "user_provider_accounts", account, uid)) || typeof data.name !== "string") throw new Error("An owned provider, service ID, and service name are required.");
        const r = await pool.query(`INSERT INTO lovable_legacy.user_services
          (user_id,user_provider_account_id,provider_service_id,name,category,type,rate,min_quantity,max_quantity,refill,cancel_allowed,is_active)
          VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [uid,account,serviceId,data.name,data.category ?? null,data.type ?? null,data.rate ?? 0,data.min_quantity ?? 1,data.max_quantity ?? 1000000,data.refill ?? false,data.cancel_allowed ?? false,data.is_active ?? true]);
        res.status(201).json({ data: r.rows, error: null }); return;
      }
      if (table === "user_bundles") {
        if (!data.name || typeof data.name !== "string") throw new Error("Bundle name is required.");
        const r = await pool.query("INSERT INTO lovable_legacy.user_bundles (user_id,name,description,platform) VALUES ($1::uuid,$2,$3,$4) RETURNING *", [uid, data.name.trim(), data.description ?? null, data.platform ?? "instagram"]); res.status(201).json({ data: r.rows, error: null }); return;
      }
      if (table === "user_bundle_items") {
        const bundle = typeof values.user_bundle_id === "string" ? values.user_bundle_id : "";
        if (!bundle || !(await owns(pool, "user_bundles", bundle, uid)) || !data.engagement_type) throw new Error("A valid bundle and engagement type are required.");
        const r = await pool.query("INSERT INTO lovable_legacy.user_bundle_items (user_id,user_bundle_id,engagement_type,quantity) VALUES ($1::uuid,$2::uuid,$3,$4) RETURNING *", [uid,bundle,data.engagement_type,data.quantity ?? 100]); res.status(201).json({ data:r.rows,error:null }); return;
      }
      if (table === "user_bundle_item_providers") {
        const item = typeof values.user_bundle_item_id === "string" ? values.user_bundle_item_id : ""; const account = typeof values.user_provider_account_id === "string" ? values.user_provider_account_id : "";
        if (!item || !account || !(await owns(pool,"user_bundle_items",item,uid)) || !(await owns(pool,"user_provider_accounts",account,uid))) throw new Error("A valid owned bundle item and provider account are required.");
        const r = await pool.query("INSERT INTO lovable_legacy.user_bundle_item_providers (user_id,user_bundle_item_id,user_provider_account_id,enabled,provider_service_id,priority) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6) RETURNING *",[uid,item,account,data.enabled ?? false,data.provider_service_id ?? null,data.priority ?? 1]); res.status(201).json({data:r.rows,error:null}); return;
      }
      res.status(403).json({ error: "This service cannot be created locally." }); return;
    }
    if (action === "delete") { await pool.query(`DELETE FROM lovable_legacy.${table} WHERE id=$1::uuid AND user_id=$2::uuid`,[id,uid]); res.json({data:[],error:null}); return; }
    if (action === "update") {
      const pairs = Object.keys(data); if (!pairs.length) { res.status(400).json({error:"No writable fields supplied."}); return; }
      const params = [...Object.values(data), id, uid]; const sets = pairs.map((k,i) => `${k}=$${i+1}`).join(",");
      const r = await pool.query(`UPDATE lovable_legacy.${table} SET ${sets},updated_at=now() WHERE id=$${pairs.length+1}::uuid AND user_id=$${pairs.length+2}::uuid RETURNING *`,params);
      res.json({data:r.rows,error:null}); return;
    }
    res.status(400).json({error:"Unsupported mutation."});
  } catch (error) { req.log.warn({err:error instanceof Error ? error.message : "mutation failed"},"Legacy mutation failed"); res.status(400).json({error:error instanceof Error ? error.message : "Legacy mutation failed"}); }
});
export default router;