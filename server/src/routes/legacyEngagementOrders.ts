import { pool } from "../db";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { resolveLegacyId } from "../lib/identity";
import { kickRotationExecutor } from "../workers/multiProviderRotationWorker";

const router: IRouter = Router();
router.use(requireAuth);

function generateRandomVaryingRunsServer(total: number, min: number, maxSlots: number): number[] {
  if (total <= 0) return [];
  const effectiveMin = Math.max(1, min);
  if (total <= effectiveMin) return [total];

  const absoluteMaxRuns = Math.floor(total / effectiveMin);
  if (absoluteMaxRuns <= 1) return [total];

  const idealRuns = Math.max(2, Math.floor(total / (effectiveMin * 1.35)));
  let targetRuns = Math.max(2, Math.min(maxSlots, absoluteMaxRuns, idealRuns));

  if (targetRuns > 2 && targetRuns * effectiveMin === total) {
    targetRuns = targetRuns - 1;
  }

  const runQuantities = new Array(targetRuns).fill(effectiveMin);
  let remaining = total - (targetRuns * effectiveMin);

  if (remaining > 0) {
    const randWeights = Array.from({ length: targetRuns }, (_, i) => {
      const pos = i / Math.max(1, targetRuns - 1);
      const wave = Math.sin(pos * Math.PI) * 0.8 + 0.6;
      const noise = 0.4 + Math.random() * 1.2;
      return Math.max(0.1, wave * noise);
    });
    const sumW = randWeights.reduce((a, b) => a + b, 0);

    let distributed = 0;
    for (let i = 0; i < targetRuns; i++) {
      const share = Math.floor((remaining * randWeights[i]) / sumW);
      runQuantities[i] += share;
      distributed += share;
    }

    let leftover = remaining - distributed;
    while (leftover > 0) {
      const idx = Math.floor(Math.random() * targetRuns);
      runQuantities[idx] += 1;
      leftover -= 1;
    }
  }

  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < targetRuns - 1; i++) {
      if (runQuantities[i] === runQuantities[i + 1]) {
        if (runQuantities[i] > effectiveMin + 1) {
          runQuantities[i] -= 1;
          runQuantities[i + 1] += 1;
        } else {
          const donorIdx = runQuantities.findIndex((q, idx) => idx !== i && idx !== i + 1 && q > effectiveMin + 1);
          if (donorIdx !== -1) {
            runQuantities[donorIdx] -= 1;
            runQuantities[i] += 1;
          }
        }
      }
    }
  }

  let currentSum = runQuantities.reduce((a, b) => a + b, 0);
  if (currentSum !== total) {
    let diff = total - currentSum;
    for (let i = 0; i < runQuantities.length && diff !== 0; i++) {
      if (diff > 0) {
        runQuantities[i] += 1;
        diff -= 1;
      } else if (diff < 0 && runQuantities[i] > effectiveMin) {
        runQuantities[i] -= 1;
        diff += 1;
      }
    }
  }

  return runQuantities;
}

const scheduledRunSchema = z.object({
  scheduled_at: z.string().datetime(),
  // nonnegative: the frontend filters zeros before sending, but accept 0 as a
  // safety net — zero-quantity runs are dropped server-side before processing.
  quantity_to_send: z.coerce.number().int().nonnegative(),
  base_quantity: z.coerce.number().int().nonnegative().optional(),
  variance_applied: z.coerce.number().int().optional(),
  peak_multiplier: z.coerce.number().nonnegative().optional(),
  custom_comments: z.string().optional(),
});

const providerMappingSchema = z.object({
  user_provider_account_id: z.string().uuid(),
  provider_service_id: z.coerce.string().min(1),
  priority: z.coerce.number().int().optional(),
});

const engagementSchema = z.object({
  type: z.string().trim().min(1).max(80),
  quantity: z.coerce.number().int().positive(),
  user_service_id: z.string().uuid().nullable().optional(),
  user_bundle_item_id: z.string().uuid().nullable().optional(),
  provider_mappings: z.array(providerMappingSchema).min(1),
  scheduled_runs: z.array(scheduledRunSchema).optional(),
  custom_comments: z.string().optional(),
});

const orderSchema = z.object({
  user_bundle_id: z.string().uuid(),
  link: z.string().trim().url().max(2048),
  base_quantity: z.coerce.number().int().positive(),
  // Minutes to wait before the FIRST run goes to the provider (0 = instant).
  start_delay_minutes: z.coerce.number().int().min(0).max(1440).optional(),
  engagements: z.array(engagementSchema).min(1).max(30),
});

function getLegacyId(req: AuthenticatedRequest): Promise<string> {
  return resolveLegacyId(req.userId);
}

router.post("/functions/process-engagement-order", async (req, res): Promise<void> => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid order." });
    return;
  }

  const client = await pool.connect();
  try {
    const userId = await getLegacyId(req as AuthenticatedRequest);
    const input = parsed.data;
    await client.query("BEGIN");

    const bundle = await client.query(
      `SELECT id FROM lovable_legacy.user_bundles
       WHERE id=$1::uuid AND user_id=$2::uuid AND is_active=true
       FOR UPDATE`,
      [input.user_bundle_id, userId],
    );
    if (!bundle.rows[0]) throw new Error("Your selected bundle is unavailable.");

    const prepared: Array<{
      engagement: z.infer<typeof engagementSchema>;
      bundleItemId: string;
      userServiceId: string | null;
      providerAccountId: string;
      mappings: Array<{ user_provider_account_id: string; provider_service_id: string; priority: number }>;
      price: number;
      providerMin: number;
      providerMax: number;
    }> = [];
    let totalPrice = 0;

    for (const engagement of input.engagements) {
      const bundleItem = await client.query(
        `SELECT id FROM lovable_legacy.user_bundle_items
         WHERE user_bundle_id=$1::uuid AND user_id=$2::uuid
           AND ($3::uuid IS NULL OR id=$3::uuid)
           AND engagement_type=$4
         LIMIT 1`,
        [input.user_bundle_id, userId, engagement.user_bundle_item_id ?? null, engagement.type],
      );
      if (!bundleItem.rows[0]) throw new Error(`Bundle service not found for ${engagement.type}.`);

      const allowed = await client.query(
        `SELECT m.user_provider_account_id, m.provider_service_id, m.priority,
                s.id AS user_service_id, s.rate, s.min_quantity, s.max_quantity
         FROM lovable_legacy.user_bundle_item_providers m
         JOIN lovable_legacy.user_provider_accounts a
           ON a.id=m.user_provider_account_id AND a.user_id=m.user_id
         LEFT JOIN lovable_legacy.user_services s
           ON s.user_id=m.user_id
          AND s.user_provider_account_id=m.user_provider_account_id
          AND s.provider_service_id=m.provider_service_id
          AND s.is_active=true
         WHERE m.user_bundle_item_id=$1::uuid AND m.user_id=$2::uuid AND m.enabled=true
         ORDER BY m.priority ASC`,
        [bundleItem.rows[0].id, userId],
      );
      const requested = new Set(
        engagement.provider_mappings.map(
          (mapping) => `${mapping.user_provider_account_id}:${mapping.provider_service_id}`,
        ),
      );
      const matched = allowed.rows.filter((row) =>
        requested.has(`${row.user_provider_account_id}:${row.provider_service_id}`),
      );
      if (!matched.length) throw new Error(`${engagement.type} has no active provider mapping.`);

      const services = matched.filter((row) => row.user_service_id);
      const pricedServices = services.filter((row) => Number(row.rate) > 0);
      const cheapest = (pricedServices.length ? pricedServices : services).reduce(
        (best, row) => !best || Number(row.rate || 0) < Number(best.rate || 0) ? row : best,
        null,
      );
      const providerMin = services.length
        ? Math.min(...services.map((row) => Number(row.min_quantity) || 1))
        : 1;
      const providerMax = services.length
        ? Math.max(...services.map((row) => Number(row.max_quantity) || 0))
        : 0;
      // Build runs: if scheduled_runs is empty, or collapsed to 1 run while quantity allows multiple runs,
      // generate multiple organic runs distributed run-wise!
      let inputRuns = (engagement.scheduled_runs?.length ? engagement.scheduled_runs : []).filter(r => r.quantity_to_send > 0);
      if (inputRuns.length === 0 || (inputRuns.length === 1 && engagement.quantity >= providerMin * 2)) {
        const effectiveMin = Math.max(1, providerMin);
        const maxSlots = Math.min(10, Math.max(2, Math.floor(engagement.quantity / effectiveMin)));
        const qtys = generateRandomVaryingRunsServer(engagement.quantity, effectiveMin, maxSlots);
        const startTime = Date.now() + 5 * 60_000;
        const totalDurationMs = Math.min(24, Math.max(2, Math.ceil(engagement.quantity / (effectiveMin * 2)))) * 60 * 60_000;
        const intervalMs = qtys.length > 1 ? totalDurationMs / (qtys.length - 1) : 30 * 60_000;

        inputRuns = qtys.map((qty, idx) => ({
          scheduled_at: new Date(startTime + idx * intervalMs + Math.round((Math.random() - 0.5) * intervalMs * 0.25)).toISOString(),
          quantity_to_send: qty,
          base_quantity: qty,
          variance_applied: 0,
          peak_multiplier: 1,
        }));
      }
      const rawRuns = inputRuns.length > 0 ? inputRuns : [{
        scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        quantity_to_send: engagement.quantity,
        base_quantity: engagement.quantity,
        variance_applied: 0,
        peak_multiplier: 1,
      }];
      const nonZeroRuns = rawRuns.filter((r) => r.quantity_to_send > 0);
      const lostQty = rawRuns.reduce((s, r) => s + r.quantity_to_send, 0)
                    - nonZeroRuns.reduce((s, r) => s + r.quantity_to_send, 0);
      const runs = nonZeroRuns.length > 0
        ? nonZeroRuns.map((r, i) =>
            i === nonZeroRuns.length - 1 && lostQty > 0
              ? { ...r, quantity_to_send: r.quantity_to_send + lostQty }
              : r
          )
        : [{ // all runs were zero — fall back to a single run
            scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            quantity_to_send: engagement.quantity,
            base_quantity: engagement.quantity,
            variance_applied: 0,
            peak_multiplier: 1,
          }];
      const scheduledTotal = runs.reduce((sum, run) => sum + run.quantity_to_send, 0);
      if (scheduledTotal !== engagement.quantity) {
        throw new Error(`${engagement.type} schedule quantity does not match its order quantity.`);
      }
      if (runs.some((run) => run.quantity_to_send < providerMin)) {
        throw new Error(`${engagement.type} has a run below provider minimum ${providerMin}.`);
      }
      if (providerMax > 0 && runs.some((run) => run.quantity_to_send > providerMax)) {
        throw new Error(`${engagement.type} has a run above provider maximum ${providerMax}.`);
      }

      const price = Math.round((engagement.quantity / 1000) * Number(cheapest?.rate || 0) * 10_000) / 10_000;
      totalPrice += price;
      prepared.push({
        engagement: { ...engagement, scheduled_runs: runs },
        bundleItemId: bundleItem.rows[0].id,
        userServiceId: cheapest?.user_service_id ?? engagement.user_service_id ?? null,
        providerAccountId: matched[0].user_provider_account_id,
        mappings: matched.map((row) => ({
          user_provider_account_id: row.user_provider_account_id,
          provider_service_id: String(row.provider_service_id),
          priority: Number(row.priority) || 999,
        })),
        price,
        providerMin,
        providerMax,
      });
    }

    // Honor the user's delivery start time: shift every run of every
    // engagement by the same offset so the earliest run of the whole order
    // starts at now + start_delay_minutes (0 = instant). Relative spacing
    // between runs (the organic curve) is preserved.
    const startDelayMs = Math.min(1440, Math.max(0, input.start_delay_minutes ?? 0)) * 60_000;
    const allScheduledRuns = prepared.flatMap((item) => item.engagement.scheduled_runs ?? []);
    const earliestRunAt = Math.min(...allScheduledRuns.map((run) => new Date(run.scheduled_at).getTime()));
    if (allScheduledRuns.length > 0 && Number.isFinite(earliestRunAt)) {
      const shiftMs = Date.now() + startDelayMs - earliestRunAt;
      if (shiftMs !== 0) {
        for (const item of prepared) {
          item.engagement.scheduled_runs = (item.engagement.scheduled_runs ?? []).map((run) => ({
            ...run,
            scheduled_at: new Date(new Date(run.scheduled_at).getTime() + shiftMs).toISOString(),
          }));
        }
      }
    }

    totalPrice = Math.round(totalPrice * 10_000) / 10_000;
    const orderResult = await client.query(
      `INSERT INTO lovable_legacy.engagement_orders
         (user_id,user_bundle_id,link,base_quantity,total_price,is_organic_mode,status)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,true,'processing')
       RETURNING id,order_number`,
      [userId, input.user_bundle_id, input.link, input.base_quantity, totalPrice],
    );
    const order = orderResult.rows[0];

    for (const item of prepared) {
      const itemResult = await client.query(
        `INSERT INTO lovable_legacy.engagement_order_items
           (engagement_order_id,engagement_type,user_service_id,user_provider_account_id,
            user_bundle_item_id,provider_mappings,quantity,price,status,custom_comments)
         VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5::uuid,$6::jsonb,$7,$8,'pending',$9)
         RETURNING id`,
        [
          order.id, item.engagement.type, item.userServiceId, item.providerAccountId,
          item.bundleItemId, JSON.stringify(item.mappings), item.engagement.quantity, item.price,
          item.engagement.custom_comments ?? null,
        ],
      );
      const itemId = itemResult.rows[0].id;
      const runs = item.engagement.scheduled_runs ?? [];
      const commentLines = (item.engagement.custom_comments ?? '')
        .split(/\r?\n/)
        .map((c: string) => c.trim())
        .filter(Boolean);
      let commentOffset = 0;

      for (let index = 0; index < runs.length; index += 1) {
        const run = runs[index];
        let runComments: string | null = null;
        if (commentLines.length > 0) {
          const runQty = run.quantity_to_send;
          const slice = commentLines.slice(commentOffset, commentOffset + runQty);
          commentOffset += runQty;
          if (slice.length > 0) {
            runComments = slice.join("\n");
          }
        }
        await client.query(
          `INSERT INTO lovable_legacy.organic_run_schedule
             (order_id,engagement_order_item_id,run_number,scheduled_at,quantity_to_send,
              base_quantity,variance_applied,peak_multiplier,status,custom_comments)
           VALUES ($1::uuid,$2::uuid,$3,$4::timestamptz,$5,$6,$7,$8,'pending',$9)`,
          [
            order.id, itemId, index + 1, run.scheduled_at, run.quantity_to_send,
            run.base_quantity ?? run.quantity_to_send, run.variance_applied ?? 0,
            run.peak_multiplier ?? 1, runComments,
          ],
        );
      }
    }

    await client.query("COMMIT");
    // Dispatch the first due run right away instead of waiting for the
    // next 60-second worker tick, so instant orders reach the provider now.
    kickRotationExecutor();
    res.status(201).json({
      success: true,
      order_id: order.id,
      order_number: Number(order.order_number),
      total_price: totalPrice,
      new_balance: 0,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.warn({ err: error }, "engagement order placement failed");
    res.status(400).json({ error: error instanceof Error ? error.message : "Order placement failed." });
  } finally {
    client.release();
  }
});

const orderActionSchema = z.object({
  order_ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(["pause", "resume", "delete"]),
});

router.post("/functions/engagement-order-action", async (req, res): Promise<void> => {
  const parsed = orderActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  const { order_ids: orderIds, action } = parsed.data;
  const client = await pool.connect();
  try {
    const userId = await getLegacyId(req as AuthenticatedRequest);
    await client.query("BEGIN");

    const owned = await client.query(
      `SELECT id, status FROM lovable_legacy.engagement_orders
        WHERE id=ANY($1::uuid[]) AND user_id=$2::uuid
        FOR UPDATE`,
      [orderIds, userId],
    );
    const ownedIds = owned.rows.map((row) => row.id as string);
    if (ownedIds.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "No matching orders found." });
      return;
    }

    let updated = 0;
    if (action === "pause") {
      const result = await client.query(
        `UPDATE lovable_legacy.engagement_orders
            SET status='paused',updated_at=now()
          WHERE id=ANY($1::uuid[]) AND status IN ('pending','processing')`,
        [ownedIds],
      );
      await client.query(
        `UPDATE lovable_legacy.engagement_order_items
            SET status='paused',updated_at=now()
          WHERE engagement_order_id=ANY($1::uuid[])
            AND status NOT IN ('completed','cancelled','failed')`,
        [ownedIds],
      );
      updated = result.rowCount ?? 0;
    } else if (action === "resume") {
      const result = await client.query(
        `UPDATE lovable_legacy.engagement_orders
            SET status='processing',updated_at=now()
          WHERE id=ANY($1::uuid[]) AND status='paused'`,
        [ownedIds],
      );
      await client.query(
        `UPDATE lovable_legacy.engagement_order_items
            SET status='processing',updated_at=now()
          WHERE engagement_order_id=ANY($1::uuid[]) AND status='paused'`,
        [ownedIds],
      );
      updated = result.rowCount ?? 0;
    } else {
      // delete: stop every run that has not reached a provider yet, then hide
      // the order. Runs already sent to a provider cannot be pulled back.
      await client.query(
        `UPDATE lovable_legacy.organic_run_schedule run
            SET status='cancelled',error_message='Cancelled by user',completed_at=now(),updated_at=now()
          FROM lovable_legacy.engagement_order_items item
          WHERE run.engagement_order_item_id=item.id
            AND item.engagement_order_id=ANY($1::uuid[])
            AND run.status IN ('pending','failed','dispatching')
            AND run.provider_order_id IS NULL`,
        [ownedIds],
      );
      await client.query(
        `UPDATE lovable_legacy.engagement_order_items
            SET status='cancelled',updated_at=now()
          WHERE engagement_order_id=ANY($1::uuid[])
            AND status NOT IN ('completed','cancelled','failed')`,
        [ownedIds],
      );
      const result = await client.query(
        `UPDATE lovable_legacy.engagement_orders
            SET status='deleted',updated_at=now()
          WHERE id=ANY($1::uuid[]) AND status<>'deleted'`,
        [ownedIds],
      );
      updated = result.rowCount ?? 0;
    }

    await client.query("COMMIT");
    if (action === "resume") kickRotationExecutor();
    res.json({ success: true, updated });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.warn({ err: error }, "engagement order action failed");
    res.status(400).json({ error: error instanceof Error ? error.message : "Action failed." });
  } finally {
    client.release();
  }
});

export default router;
