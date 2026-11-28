import { pool } from "../db";
import { exactPreview } from "../lib/preview-contract";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/auth";
import { resolveLegacyId } from "../lib/identity";
import { kickRotationExecutor } from "../workers/multiProviderRotationWorker";
import { runSpacing } from "../lib/runSpacing";
import { validateCommentOrder } from "../lib/commentDelivery";
import { paceRunsToViews } from "../lib/ratioPacing";
import { runMaximum, runMinimum, shapeEngagementRuns } from "../lib/runShaping";
import { alignPreviewToViews, distinctGaps, isLinkedEngagement, linkRunsToViews, smoothViewsSpikes } from "../lib/viewLinkedRuns";
import { assertWithinBundleMaximum, bundleMaximum } from "../lib/bundleQuantityLimit";
import { planningProviderLimits } from '../lib/planningProviderLimits';
import { decryptProviderCredential } from '../lib/providerCredentials';

export function normalizeReelLink(raw: string): string {
  try {
    const url = new URL(raw);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return raw;
    const path = url.pathname.replace(/\/+$/, "");
    return `https://www.instagram.com${path}/`;
  } catch {
    return raw;
  }
}

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
  provider_mappings: z.array(providerMappingSchema).default([]),
  scheduled_runs: z.array(scheduledRunSchema).optional(),
  custom_comments: z.string().optional(),
});

const orderSchema = z.object({
  order_name: z.string().trim().max(120).optional(),
  curve_name: z.string().trim().max(160).optional(),
  user_bundle_id: z.string().uuid(),
  // Strip share/tracking query text (e.g. ?psln=, ?igsh=) so providers get the
  // canonical Reel URL; some providers fail to resolve links with extra params.
  link: z.string().trim().url().max(2048).transform(normalizeReelLink),
  base_quantity: z.coerce.number().int().positive(),
  // Minutes to wait before the FIRST run goes to the provider (0 = instant).
  start_delay_minutes: z.coerce.number().int().min(0).max(1440).optional(),
  // Explicit opt-in only. Older clients and omitted flags always save OFF.
  peak_hours_enabled: z.boolean().optional().default(false),
  preview_required: z.boolean().optional().default(false),
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
      previewRuns?: z.infer<typeof engagementSchema>["scheduled_runs"];
      previewExact: boolean;
      bundleItemId: string;
      userServiceId: string | null;
      providerAccountId: string;
      mappings: Array<{ user_provider_account_id: string; provider_service_id: string; priority: number }>;
      price: number;
      providerMin: number;
      providerMax: number;
      runMax: number;
    }> = [];
    let totalPrice = 0;

    // Starting quantities used on this customer's recent Reels, per engagement,
    // so every new Reel starts with a different first-run quantity. The bundle
    // row lock above serializes mass orders, so each sees the previous one.
    const recentStartRows = await client.query(
      `SELECT i.engagement_type, r.quantity_to_send
         FROM lovable_legacy.engagement_orders o
         JOIN lovable_legacy.engagement_order_items i ON i.engagement_order_id=o.id
         JOIN lovable_legacy.organic_run_schedule r ON r.engagement_order_item_id=i.id AND r.run_number=1
        WHERE o.user_id=$1::uuid
        ORDER BY o.order_number DESC
        LIMIT 600`,
      [userId],
    );
    const recentStarts = new Map<string, number[]>();
    for (const row of recentStartRows.rows) {
      const list = recentStarts.get(row.engagement_type) ?? [];
      if (list.length < 25) list.push(Number(row.quantity_to_send));
      recentStarts.set(row.engagement_type, list);
    }

    for (const engagement of input.engagements) {
      const bundleItem = await client.query(
        `SELECT id, min_quantity, max_quantity FROM lovable_legacy.user_bundle_items
         WHERE user_bundle_id=$1::uuid AND user_id=$2::uuid
           AND ($3::uuid IS NULL OR id=$3::uuid)
           AND engagement_type=$4
         LIMIT 1`,
        [input.user_bundle_id, userId, engagement.user_bundle_item_id ?? null, engagement.type],
      );
      if (!bundleItem.rows[0]) throw new Error(`Bundle service not found for ${engagement.type}.`);

      const bundleMax = assertWithinBundleMaximum(
        engagement.type,
        engagement.quantity,
        bundleItem.rows[0].max_quantity,
      );
      const configuredMin = bundleMaximum(bundleItem.rows[0].min_quantity);
      if (bundleMax > 0 && configuredMin > bundleMax) {
        throw new Error(`${engagement.type}: My Bundles Min cannot be greater than Max.`);
      }
      validateCommentOrder(engagement.type, engagement.custom_comments, engagement.quantity);

      const allowed = await client.query(
        `SELECT m.user_provider_account_id, m.provider_service_id, m.priority,
                s.id AS user_service_id, s.rate, s.min_quantity, s.max_quantity,
                a.api_url, a.api_key_ciphertext
         FROM lovable_legacy.user_bundle_item_providers m
         JOIN lovable_legacy.user_provider_accounts a
           ON a.id=m.user_provider_account_id AND a.user_id=m.user_id
         LEFT JOIN lovable_legacy.user_services s
           ON s.user_id=m.user_id
          AND s.user_provider_account_id=m.user_provider_account_id
          AND s.provider_service_id=m.provider_service_id
          AND s.is_active=true
         WHERE m.user_bundle_item_id=$1::uuid AND m.user_id=$2::uuid AND m.enabled=true AND a.is_active=true
         ORDER BY m.priority ASC`,
        [bundleItem.rows[0].id, userId],
      );
      const requested = new Set(
        engagement.provider_mappings.map(
          (mapping) => `${mapping.user_provider_account_id}:${mapping.provider_service_id}`,
        ),
      );
      // The order page may hold a stale provider list (My Bundles edited after
      // load). Live enabled My Bundles mappings are the source of truth.
      const picked = allowed.rows.filter((row) =>
        requested.has(`${row.user_provider_account_id}:${row.provider_service_id}`),
      );
      const candidates = picked.length ? picked : allowed.rows;
      if (!candidates.length) throw new Error(`${engagement.type} has no enabled provider in My Bundles. Enable one provider for ${engagement.type} and try again.`);
      const matched = await planningProviderLimits(candidates, async (accountId) => {
        const account = candidates.find(row => row.user_provider_account_id === accountId);
        if (!account) return [];
        const url = new URL(account.api_url);
        if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.endsWith('.internal') || url.hostname.endsWith('.local')) throw new Error('Invalid provider URL.');
        const response = await fetch(url, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ key: decryptProviderCredential(account.api_key_ciphertext), action: 'services' }),
        });
        const body = response.ok ? await response.json() : null;
        return Array.isArray(body) ? body : [];
      });

      const services = matched.filter((row) => row.user_service_id);
      const pricedServices = services.filter((row) => Number(row.rate) > 0);
      const cheapest = (pricedServices.length ? pricedServices : services).reduce(
        (best, row) => !best || Number(row.rate || 0) < Number(best.rate || 0) ? row : best,
        null,
      );
      const serviceMin = Math.min(...matched.map((row) => row.min_quantity));
      // Bundle settings can raise, but never lower, a verified provider minimum.
      const providerMin = runMinimum(bundleItem.rows[0].min_quantity, serviceMin);
      const providerMax = Math.max(...matched.map((row) => row.max_quantity));
      // Build runs: if scheduled_runs is empty, or collapsed to 1 run while quantity allows multiple runs,
      // generate multiple organic runs distributed run-wise!
      let inputRuns = (engagement.scheduled_runs?.length ? engagement.scheduled_runs : []).filter(r => r.quantity_to_send > 0);
      const suppliedPreview = engagement.scheduled_runs !== undefined;
      const previewMax = runMaximum(bundleItem.rows[0].max_quantity, providerMax);
      if (input.preview_required || suppliedPreview) {
        inputRuns = exactPreview(engagement.scheduled_runs ?? [], engagement.quantity, providerMin, previewMax,
          q => matched.some(provider => q >= provider.min_quantity && (provider.max_quantity <= 0 || q <= provider.max_quantity)));
      }
      if (inputRuns.length === 0) {
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
      const builtRuns = nonZeroRuns.length > 0
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
      // Small start + mixed run sizes (non-view engagements) and a starting
      // quantity different from recent Reels (all engagements).
      // A valid customer preview is placed exactly as shown (quantities and run count).
      const runMaxLimit = runMaximum(bundleItem.rows[0].max_quantity, providerMax);
      const previewExact = suppliedPreview && inputRuns.length > 0 && builtRuns.length === inputRuns.length
        && builtRuns.reduce((s, r) => s + r.quantity_to_send, 0) === engagement.quantity
        && builtRuns.every((r) => Number.isInteger(r.quantity_to_send) && r.quantity_to_send >= providerMin
          && (!(runMaxLimit > 0) || r.quantity_to_send <= runMaxLimit));
      const runs = previewExact ? builtRuns.map((r) => ({ ...r, base_quantity: r.quantity_to_send })) : shapeEngagementRuns({
        type: engagement.type,
        runs: builtRuns,
        min: providerMin,
        max: runMaximum(bundleItem.rows[0].max_quantity, providerMax),
        recentStarts: recentStarts.get(engagement.type) ?? [],
      });
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
        previewRuns: builtRuns,
        previewExact,
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
        runMax: runMaximum(bundleItem.rows[0].max_quantity, providerMax),
      });
    }

    // Honor the user's delivery start time per engagement: the first run of
    // EVERY engagement (views, likes, comments...) starts at
    // now + start_delay_minutes (0 = instant). Each engagement keeps its own
    // relative run spacing (the organic curve).
    const startDelayMs = Math.min(1440, Math.max(0, input.start_delay_minutes ?? 0)) * 60_000;
    const startAt = Date.now() + startDelayMs;
    const previewStart = Math.min(...prepared.filter(item => item.previewExact)
      .flatMap(item => (item.engagement.scheduled_runs ?? []).map(run => Date.parse(run.scheduled_at))));
    for (const item of prepared) {
      const runs = item.engagement.scheduled_runs ?? [];
      const earliest = Math.min(...runs.map((run) => new Date(run.scheduled_at).getTime()));
      if (!runs.length || !Number.isFinite(earliest)) continue;
      const shiftMs = startAt - (item.previewExact && Number.isFinite(previewStart) ? previewStart : earliest);
      item.engagement.scheduled_runs = runs.map((run) => ({
        ...run,
        scheduled_at: new Date(new Date(run.scheduled_at).getTime() + shiftMs).toISOString(),
      }));
    }

    // Keep every engagement at its bundle % of views: delay non-view runs
    // until the views scheduled before them reach the same share.
    // Views-linked sizing: likes/saves/shares/reposts runs are built from the
    // Views runs (bundle % of each Views run, after it), so they follow the
    // selected curve. Comments keep their own pacing.
    const linkedItems = new Set<number>();
    const viewsItem = prepared.find((item) => /views?$/i.test(item.engagement.type));
    if (viewsItem?.engagement.scheduled_runs?.length) {
      if (!viewsItem.previewExact) viewsItem.engagement.scheduled_runs = smoothViewsSpikes(viewsItem.engagement.scheduled_runs, viewsItem.providerMin, viewsItem.runMax);
      prepared.forEach((item, i) => {
        if (item.previewExact || item === viewsItem || !isLinkedEngagement(item.engagement.type)) return;
        const first = item.engagement.scheduled_runs?.[0];
        if (!first) return;
        const linked = alignPreviewToViews({
          views: viewsItem.engagement.scheduled_runs ?? [], runs: (() => {
            // Runs exactly as shown in the order preview, moved to the chosen start time.
            const pr = item.previewRuns ?? [];
            const e = Math.min(...pr.map((r) => Date.parse(r.scheduled_at)));
            return Number.isFinite(e) ? pr.map((r) => ({ ...first, ...r, scheduled_at: new Date(Date.parse(r.scheduled_at) + startAt - e).toISOString() })) : [];
          })(),
          total: item.engagement.quantity, min: item.providerMin, max: item.runMax,
        }) ?? linkRunsToViews({
          views: viewsItem.engagement.scheduled_runs ?? [], template: first,
          total: item.engagement.quantity, min: item.providerMin, max: item.runMax,
        });
        if (!linked || linked.reduce((a, r) => a + r.quantity_to_send, 0) !== item.engagement.quantity
          || linked.some((r) => r.quantity_to_send < item.providerMin || (item.runMax > 0 && r.quantity_to_send > item.runMax))) return;
        item.engagement.scheduled_runs = linked;
        linkedItems.add(i);
      });
    }

    const paced = paceRunsToViews(prepared.map((item) => ({
      type: item.engagement.type,
      quantity: item.engagement.quantity,
      runs: item.engagement.scheduled_runs ?? [],
    })));
    prepared.forEach((item, i) => {
      if (item.previewExact || linkedItems.has(i)) return;
      item.engagement.scheduled_runs = [...paced[i]].sort(
        (a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at),
      );
    });

    // Every gap between a type's runs is different (never a fixed interval).
    for (const item of prepared) {
      if (!item.previewExact && item.engagement.scheduled_runs?.length) item.engagement.scheduled_runs = distinctGaps(item.engagement.scheduled_runs);
      if (item.engagement.scheduled_runs?.some(run => run.quantity_to_send < item.providerMin)) {
        throw new Error(`${item.engagement.type} has a final run below provider minimum ${item.providerMin}.`);
      }
    }

    totalPrice = Math.round(totalPrice * 10_000) / 10_000;
    const orderResult = await client.query(
      `INSERT INTO lovable_legacy.engagement_orders
         (user_id,user_bundle_id,link,base_quantity,total_price,is_organic_mode,status,order_name,curve_name,peak_hours_enabled)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,true,'processing',$6,$7,$8)
       RETURNING id,order_number`,
      [userId, input.user_bundle_id, input.link, input.base_quantity, totalPrice,
        input.order_name || null, input.curve_name || null, input.peak_hours_enabled],
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
      const runs = runSpacing(item.engagement.scheduled_runs ?? []);
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
              base_quantity,variance_applied,peak_multiplier,status,custom_comments,planned_at,planned_gap_seconds)
           VALUES ($1::uuid,$2::uuid,$3,$4::timestamptz,$5,$6,$7,$8,'pending',$9,$10::timestamptz,$11)`,
          [
            order.id, itemId, index + 1, run.scheduled_at, run.quantity_to_send,
            run.base_quantity ?? run.quantity_to_send, run.variance_applied ?? 0,
            run.peak_multiplier ?? 1, runComments, run.planned_at, run.planned_gap_seconds,
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
    const ownedIds = owned.rows.filter((row) => row.status !== 'deleted').map((row) => row.id as string);
    if (ownedIds.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "No matching orders found." });
      return;
    }

    let updated = 0;
    if (action === "pause") {
      // Pause exactly the selected Reel(s): any owned order that still has
      // unsent runs (status may read 'partial' when some runs under-delivered).
      const result = await client.query(
        `UPDATE lovable_legacy.engagement_orders o
            SET status='paused',updated_at=now()
          WHERE o.id=ANY($1::uuid[]) AND o.status IN ('pending','processing','started','partial')
            AND EXISTS (SELECT 1 FROM lovable_legacy.engagement_order_items i
                          JOIN lovable_legacy.organic_run_schedule r ON r.engagement_order_item_id=i.id
                         WHERE i.engagement_order_id=o.id AND r.status='pending' AND r.provider_order_id IS NULL)
          RETURNING o.id`,
        [ownedIds],
      );
      const pausedIds = result.rows.map((row) => row.id as string);
      await client.query(
        `UPDATE lovable_legacy.engagement_order_items i
            SET status='paused',updated_at=now()
          WHERE i.engagement_order_id=ANY($1::uuid[])
            AND EXISTS (SELECT 1 FROM lovable_legacy.organic_run_schedule r
                         WHERE r.engagement_order_item_id=i.id AND r.status='pending' AND r.provider_order_id IS NULL)`,
        [pausedIds],
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
