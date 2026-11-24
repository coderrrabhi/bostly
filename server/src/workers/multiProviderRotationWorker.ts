import { createHash, randomUUID } from "node:crypto";
// Background ticks use their own small pool so they never hold connections
// that interactive requests are waiting for.
import { workerPool as pool } from "../db";
import { decryptProviderCredential } from "../lib/providerCredentials";
import { logger } from "../lib/logger";
import { addOnCap, driftAdjustment, nearestUnused } from "../lib/viewsDrift";
import { appendCancelledProviderMark, commentRetryMinutes, isCommentEngagement, preferOtherProvider, runCommentText, shouldFailoverCancelledRun } from "../lib/commentDelivery";
import { failedRunFailoverBlock, failoverWindowBlock } from "../lib/failoverPolicy";
import { speedupTicketDelayMinutes, speedupTicketEligible, speedupTicketMessage } from "../lib/deliverySpeedup";
import { engagementViewsAllowed, eligibleProviders } from "../lib/dispatchEligibility";
import { requestNeverReachedProvider } from "../lib/providerNetwork";

type Mapping = {
  user_provider_account_id: string;
  provider_service_id: string;
  priority?: number;
  min_quantity?: number | null;
  max_quantity?: number | null;
};

type ProviderAccount = {
  id: string;
  name: string;
  api_url: string;
  api_key_ciphertext: string;
  priority: number;
};

let executorRunning = false;
let executorStartedAt = 0;
/** A hung tick must never stop all deliveries; unsent claims expire safely after 2 minutes. */
const EXECUTOR_STALL_MS = 3 * 60_000;
const RUN_STEP_TIMEOUT_MS = 90_000;
export function executorStalled(running: boolean, startedAt: number, now = Date.now()): boolean {
  return running && now - startedAt > EXECUTOR_STALL_MS;
}
let checkerRunning = false;
let checkerStartedAt = 0;

function boundedPositiveInt(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

const EXECUTOR_CONCURRENCY = boundedPositiveInt(process.env.ROTATION_EXECUTOR_CONCURRENCY, 8, 20);
const RUNS_PER_EXECUTOR = boundedPositiveInt(process.env.ROTATION_RUNS_PER_EXECUTOR, 12, 25);

function retryDelayMinutes(retryCount: number, baseMinutes = 2): number {
  return Math.min(60, baseMinutes * (2 ** Math.min(5, Math.max(0, retryCount))));
}

function safePanelUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("Provider API URL must be a public HTTPS URL.");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeLink(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

function rotationLockKey(run: any, providerAccountId: string): string {
  const linkHash = createHash("sha256").update(normalizeLink(run.link)).digest("hex");
  return `${run.user_id}:${providerAccountId}:${String(run.engagement_type).toLowerCase()}:${linkHash}`;
}

function isMinimumQuantityMessage(message: string): boolean {
  const value = message.toLowerCase();
  return value.includes("less than minimal")
    || value.includes("minimum quantity")
    || (value.includes("quantity") && value.includes("minimal"));
}

/** Add a too-small run's quantity to the next pending run of the same item. */
async function mergeRunIntoNextRun(run: any): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const next = await client.query(
      `SELECT id, quantity_to_send FROM lovable_legacy.organic_run_schedule
        WHERE engagement_order_item_id=$1::uuid AND run_number>$2 AND status='pending'
          AND provider_order_id IS NULL
        ORDER BY run_number LIMIT 1 FOR UPDATE`,
      [run.engagement_order_item_id, run.run_number],
    );
    const target = next.rows[0];
    if (!target) { await client.query("ROLLBACK"); return false; }
    const mergedQuantity = Number(target.quantity_to_send) + Number(run.quantity_to_send);
    await client.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET quantity_to_send=$1, base_quantity=$1, updated_at=now() WHERE id=$2::uuid`,
      [mergedQuantity, target.id],
    );
    const closed = await client.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET status='merged', claim_token=NULL, claimed_at=NULL, rotation_lock_key=NULL,
              user_provider_account_id=NULL, user_provider_account_name=NULL,
              error_message=$1, completed_at=now(), updated_at=now()
        WHERE id=$2::uuid AND status='dispatching' AND claim_token=$3::uuid AND provider_order_id IS NULL
        RETURNING id`,
      [`Run below every mapped provider's minimum; its quantity was merged into the next run.`, run.id, run.claim_token],
    );
    if (!closed.rows[0]) { await client.query("ROLLBACK"); return false; }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function isBusyMessage(message: string): boolean {
  const value = message.toLowerCase();
  return [
    "already active",
    "already in progress",
    "duplicate",
    "active order",
    "order exists",
    "same link",
    "link is currently",
    "another order",
  ].some((phrase) => value.includes(phrase));
}

async function audit(
  run: any,
  event: string,
  account?: ProviderAccount,
  details: { providerOrderId?: string; request?: unknown; response?: unknown; error?: string } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO lovable_legacy.provider_dispatch_logs
      (run_id,engagement_order_id,user_id,provider_account_id,provider_account_name,event,
       provider_order_id,request_payload,response_payload,error_message)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
    [
      run.id,
      run.engagement_order_id,
      run.user_id,
      account?.id ?? null,
      account?.name ?? null,
      event,
      details.providerOrderId ?? null,
      details.request ? JSON.stringify(details.request) : null,
      details.response ? JSON.stringify(details.response) : null,
      details.error ?? null,
    ],
  );
}

async function claimRun(): Promise<any | null> {
  const claimToken = randomUUID();
  const result = await pool.query(
    `WITH candidate AS (
       SELECT rs.id, rs.error_message AS prev_error
         FROM lovable_legacy.organic_run_schedule rs
         JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=rs.engagement_order_item_id
         JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id
        WHERE rs.status='pending'
          AND rs.scheduled_at<=now()
          AND eo.status IN ('pending','processing')
          AND COALESCE(eoi.status,'pending') NOT IN ('paused','cancelled','canceled')
          AND rs.provider_order_id IS NULL
          AND COALESCE(rs.dispatch_uncertain,false)=false
         -- Earliest due run wins regardless of the order's age. New orders
         -- must not starve a live 48-hour curve after its 24-hour birthday.
         ORDER BY rs.scheduled_at,rs.run_number,rs.created_at,rs.id
        FOR UPDATE OF rs SKIP LOCKED
        LIMIT 1
     ), claimed AS (
       UPDATE lovable_legacy.organic_run_schedule rs
          SET status='dispatching',claim_token=$1::uuid,claimed_at=now(),
              error_message=NULL,updated_at=now()
         FROM candidate
        WHERE rs.id=candidate.id AND rs.status='pending'
        RETURNING rs.*, candidate.prev_error
     )
     SELECT claimed.*,eoi.provider_mappings,eoi.user_provider_account_id,eoi.user_bundle_item_id,
            eoi.engagement_type,eo.link,eo.id AS engagement_order_id,eo.user_id,
            eoi.custom_comments AS item_comments,
            (SELECT COALESCE(SUM(previous.quantity_to_send),0)
               FROM lovable_legacy.organic_run_schedule previous
              WHERE previous.engagement_order_item_id=claimed.engagement_order_item_id
                AND previous.run_number<claimed.run_number) AS comment_offset
       FROM claimed
       JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=claimed.engagement_order_item_id
       JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id`,
    [claimToken],
  );
  return result.rows[0] ?? null;
}

// Provider order comes from the bundle's CURRENT My Bundles settings at the
// moment each run is sent, so a priority/enable change applies to the very
// next run of every live order. The order-time snapshot is only a fallback
// when the bundle service no longer exists.
export async function currentMappings(run: any): Promise<Mapping[]> {
  const snapshot = (Array.isArray(run.provider_mappings) ? run.provider_mappings : []) as Mapping[];
  if (!run.user_bundle_item_id) return snapshot;
  const item = await pool.query(
    `SELECT 1 FROM lovable_legacy.user_bundle_items WHERE id=$1::uuid`,
    [run.user_bundle_item_id],
  );
  if (!item.rows[0]) return snapshot;
  const live = await pool.query(
    `SELECT user_provider_account_id, provider_service_id::text AS provider_service_id, priority
       FROM lovable_legacy.user_bundle_item_providers
      WHERE user_bundle_item_id=$1::uuid AND enabled=true
        AND COALESCE(provider_service_id::text,'')<>''
      ORDER BY priority ASC`,
    [run.user_bundle_item_id],
  );
  return live.rows.map((row) => ({
    user_provider_account_id: row.user_provider_account_id,
    provider_service_id: String(row.provider_service_id),
    priority: Number(row.priority) || 999,
  }));
}

async function loadAccounts(mappings: Mapping[]): Promise<Map<string, ProviderAccount>> {
  const ids = [...new Set(mappings.map((mapping) => mapping.user_provider_account_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const result = await pool.query<ProviderAccount>(
    `SELECT id,name,api_url,api_key_ciphertext,priority
       FROM lovable_legacy.user_provider_accounts
      WHERE id=ANY($1::uuid[]) AND is_active=true`,
    [ids],
  );
  return new Map(result.rows.map((account) => [account.id, account]));
}

async function releaseAttempt(runId: string): Promise<void> {
  await pool.query(
    `UPDATE lovable_legacy.organic_run_schedule
        SET rotation_lock_key=NULL,user_provider_account_id=NULL,user_provider_account_name=NULL,
            updated_at=now()
      WHERE id=$1::uuid AND status='dispatching' AND provider_order_id IS NULL`,
    [runId],
  );
}

// Like/save/share/repost runs follow the Reel's REAL views: when providers
// delivered extra (or fewer) views, this run carries its % of views share of
// that difference, limited per run so the selected curve stays smooth.
// Comments and views runs are never changed. Re-dispatch is idempotent.
async function applyViewsDrift(run: any): Promise<void> {
  const type = String(run.engagement_type ?? "");
  if (/views?$/i.test(type) || isCommentEngagement(type)) return;
  try {
    const own = Number(run.drift_adjustment ?? 0);
    const planned = Number(run.quantity_to_send) - own;
    const info = await pool.query(
      `SELECT vi.quantity AS views_total, me.quantity AS item_quantity,
              COALESCE(ubi.min_quantity,0) AS min_q, COALESCE(ubi.max_quantity,0) AS max_q,
              (SELECT COALESCE(SUM(o.drift_adjustment),0) FROM lovable_legacy.organic_run_schedule o
                WHERE o.engagement_order_item_id=me.id AND o.id<>$1::uuid
                  AND (o.provider_order_id IS NOT NULL OR o.status IN ('completed','partial','started','processing'))) AS applied,
              NOT EXISTS (SELECT 1 FROM lovable_legacy.organic_run_schedule o
                WHERE o.engagement_order_item_id=me.id AND o.id<>$1::uuid AND o.status='pending') AS last_run,
              (SELECT COALESCE(SUM(GREATEST(0,o.quantity_to_send-COALESCE(o.drift_adjustment,0))),0)
                 FROM lovable_legacy.organic_run_schedule o
                WHERE o.engagement_order_item_id=me.id AND o.id<>$1::uuid
                  AND o.provider_order_id IS NULL AND o.status IN ('pending','dispatching')) AS remaining_base,
              (SELECT COUNT(*) FROM lovable_legacy.organic_run_schedule o
                WHERE o.engagement_order_item_id=me.id AND o.id<>$1::uuid
                  AND o.provider_order_id IS NULL AND o.status IN ('pending','dispatching')) AS remaining_runs,
              vi.id AS views_item
         FROM lovable_legacy.engagement_order_items me
         JOIN lovable_legacy.engagement_order_items vi
           ON vi.engagement_order_id=me.engagement_order_id AND vi.engagement_type ~* 'views?$'
         LEFT JOIN lovable_legacy.user_bundle_items ubi ON ubi.id=me.user_bundle_item_id
        WHERE me.id=$2::uuid LIMIT 1`,
      [run.id, run.engagement_order_item_id],
    );
    const row = info.rows[0];
    if (!row) return;
    const views = await pool.query(
      `SELECT run_number, quantity_to_send, provider_start_count, provider_remains, status
         FROM lovable_legacy.organic_run_schedule
        WHERE engagement_order_item_id=$1::uuid AND provider_order_id IS NOT NULL
          AND status IN ('completed','partial','started','processing','cancelled','canceled')
        ORDER BY run_number`,
      [row.views_item],
    );
    const adj = driftAdjustment({
      views: views.rows.map((v) => {
        const quantity = Number(v.quantity_to_send);
        const completed = v.status === "completed" || v.status === "partial";
        const delivered = v.provider_remains !== null && v.provider_remains !== undefined
          ? Math.max(0, quantity - Number(v.provider_remains))
          : completed ? quantity : null;
        return {
          runNumber: Number(v.run_number), quantity,
          startCount: v.provider_start_count === null ? null : Number(v.provider_start_count),
          completed, observed: delivered !== null, delivered,
        };
      }),
      viewsTotal: Number(row.views_total), itemQuantity: Number(row.item_quantity), appliedSoFar: Number(row.applied),
      runQuantity: planned, min: Number(row.min_q) || 1, max: Number(row.max_q) || 0, lastRun: Boolean(row.last_run),
      remainingBase: Number(row.remaining_base) + planned,
      remainingRuns: Number(row.remaining_runs) + 1,
    });
    const siblings = await pool.query(
      `SELECT quantity_to_send FROM lovable_legacy.organic_run_schedule
        WHERE engagement_order_item_id=$1::uuid AND id<>$2::uuid AND quantity_to_send>0
          AND status NOT IN ('cancelled','failed','merged')`,
      [run.engagement_order_item_id, run.id],
    );
    // Never send the same quantity as another run of this engagement.
    const cap = Math.max(Math.floor(planned * 0.5), addOnCap(planned, adj, Number(row.remaining_base) + planned) , Math.abs(adj));
    const lower = Math.max(Number(row.min_q) || 1, planned - cap);
    const upper = Math.max(lower, Math.min(Number(row.max_q) || Infinity, planned + cap));
    const quantity = nearestUnused(Math.max(lower, Math.min(upper, planned + adj)),
      siblings.rows.map((r) => Number(r.quantity_to_send)), lower, upper, planned);
    const finalAdj = quantity - planned;
    if (finalAdj === own) return;
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule SET quantity_to_send=$1, drift_adjustment=$2, updated_at=now()
        WHERE id=$3::uuid AND status='dispatching' AND provider_order_id IS NULL`,
      [quantity, finalAdj, run.id],
    );
    run.quantity_to_send = quantity;
    run.drift_adjustment = finalAdj;
    await audit(run, "views_drift_adjusted", undefined, { request: { planned, adjustment: finalAdj, quantity } });
  } catch (error) {
    logger.warn({ error, runId: run.id }, "views drift adjustment skipped");
  }
}

async function failoverTiming(run: any): Promise<{ viewsComplete: boolean; nextRunScheduledAt: string | null }> {
  const [next, views] = await Promise.all([
    pool.query(
      `SELECT scheduled_at FROM lovable_legacy.organic_run_schedule
        WHERE engagement_order_item_id=$1::uuid AND run_number>$2
        ORDER BY run_number LIMIT 1`,
      [run.engagement_order_item_id, run.run_number],
    ),
    pool.query(
      `SELECT vi.quantity,vi.status,
              NOT EXISTS (SELECT 1 FROM lovable_legacy.organic_run_schedule vr
                WHERE vr.engagement_order_item_id=vi.id
                  AND vr.status IN ('pending','dispatching','started','processing','dispatch_uncertain')) AS runs_finished,
              COALESCE((SELECT SUM(CASE
                WHEN vr.provider_remains IS NOT NULL THEN GREATEST(0,vr.quantity_to_send-vr.provider_remains)
                WHEN vr.status IN ('completed','partial') THEN vr.quantity_to_send ELSE 0 END)
                FROM lovable_legacy.organic_run_schedule vr WHERE vr.engagement_order_item_id=vi.id),0) AS delivered
         FROM lovable_legacy.engagement_order_items vi
        WHERE vi.engagement_order_id=$1::uuid AND vi.engagement_type ~* 'views?$' LIMIT 1`,
      [run.engagement_order_id],
    ),
  ]);
  const view = views.rows[0];
  return {
    viewsComplete: Boolean(view?.runs_finished) && (
      view?.status === "completed" || Number(view?.delivered ?? 0) >= Number(view?.quantity ?? 0)
    ),
    nextRunScheduledAt: next.rows[0]?.scheduled_at ?? null,
  };
}

/** Revalidate a requeued failover immediately before any paid provider call. */
async function failoverDispatchAllowed(run: any): Promise<boolean> {
  if (!String(run.prev_error ?? "").includes("[failover]")) return true;
  const timing = await failoverTiming(run);
  const block = failoverWindowBlock({ ...timing, now: new Date() });
  if (!block) return true;
  const message = block === "views-complete"
    ? "Failover skipped: all views runs and the ordered views total are already complete."
    : "Failover skipped: the following run is already due; the old order was not duplicated.";
  await pool.query(
    `UPDATE lovable_legacy.organic_run_schedule
        SET status='failed',claim_token=NULL,claimed_at=NULL,rotation_lock_key=NULL,
            user_provider_account_id=NULL,user_provider_account_name=NULL,
            error_message=$1,completed_at=now(),updated_at=now()
      WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL`,
    [message, run.id],
  );
  await audit(run, "failover_skipped", undefined, { error: message });
  return false;
}

async function dispatch(run: any): Promise<void> {
  if (!(await failoverDispatchAllowed(run))) return;
  if (!(await confirmedViewsDispatchAllowed(run))) return;
  await applyViewsDrift(run);
  // Validate before taking a provider lock or making any paid request.
  const comments = runCommentText(run);
  const mappings = await currentMappings(run);
  const accounts = await loadAccounts(mappings);
  const active = mappings
    .filter((mapping) => mapping.user_provider_account_id && mapping.provider_service_id && accounts.has(mapping.user_provider_account_id))
    .sort((left, right) => {
      const mappingPriority = Number(left.priority ?? 999) - Number(right.priority ?? 999);
      if (mappingPriority !== 0) return mappingPriority;
      return Number(accounts.get(left.user_provider_account_id)?.priority ?? 999) -
        Number(accounts.get(right.user_provider_account_id)?.priority ?? 999);
    });
  const checked = await mappingsWithLimits(active, accounts);
  const ordered = preferOtherProvider(eligibleProviders(checked, Number(run.quantity_to_send)), run.prev_error);

  if (active.length && !ordered.length) {
    await holdUnsentRun(run, "Waiting for an enabled provider with verified limits that accept this exact run quantity.");
    return;
  }

  if (!ordered.length) {
    const message = "No active provider account is currently mapped to this service.";
    const retryMinutes = retryDelayMinutes(Number(run.retry_count ?? 0), 2);
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET status='pending',claim_token=NULL,claimed_at=NULL,rotation_lock_key=NULL,
              user_provider_account_id=NULL,user_provider_account_name=NULL,error_message=$1,
              retry_count=retry_count+1,scheduled_at=now()+($3 * interval '1 minute'),updated_at=now()
        WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL`,
      [message, run.id, retryMinutes],
    );
    await audit(run, "no_active_provider_requeued", undefined, { error: message });
    return;
  }

  let busyCount = 0;
  let unavailableCount = 0;
  const failures: string[] = [];

  for (const mapping of ordered) {
    const account = accounts.get(mapping.user_provider_account_id);
    if (!account) continue;
    const lockKey = rotationLockKey(run, account.id);

    try {
      const locked = await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET rotation_lock_key=$1,user_provider_account_id=$2::uuid,user_provider_account_name=$3,updated_at=now()
          WHERE id=$4::uuid AND status='dispatching' AND claim_token=$5::uuid
          RETURNING id`,
        [lockKey, account.id, account.name, run.id, run.claim_token],
      );
      if (!locked.rows[0]) throw new Error("Run claim expired before dispatch.");
    } catch (error: any) {
      if (error?.code === "23505") {
        busyCount += 1;
        await audit(run, "provider_busy_lock", account, { error: "Active rotation lock already exists." });
        continue;
      }
      throw error;
    }

    const requestPayload = {
      service: mapping.provider_service_id,
      link: run.link,
      quantity: run.quantity_to_send,
      ...(comments ? { comments } : {}),
    };

    let key: string;
    try {
      key = decryptProviderCredential(account.api_key_ciphertext);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider credential is unavailable.";
      failures.push(`${account.name}: ${message}`);
      unavailableCount += 1;
      await pool.query(
        `UPDATE lovable_legacy.user_provider_accounts
            SET is_active=false,last_tested_at=now(),last_test_ok=false,last_test_error=$1,updated_at=now()
          WHERE id=$2::uuid`,
        [message, account.id],
      );
      await audit(run, "provider_unavailable", account, { request: requestPayload, error: message });
      await releaseAttempt(run.id);
      continue;
    }

    let response: Response;
    let text: string;
    try {
      const params = new URLSearchParams({
        key,
        action: "add",
        service: mapping.provider_service_id,
        link: run.link,
        quantity: String(run.quantity_to_send),
      });
      if (comments) {
        params.set("comments", comments);
      }
      const apiUrl = safePanelUrl(account.api_url);
      // A crash after sending any paid add request must not cause a duplicate
      // order when stale-claim recovery runs after restart.
      const ready = await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule SET dispatch_uncertain=true,updated_at=now()
          WHERE id=$1::uuid AND status='dispatching' AND claim_token=$2::uuid RETURNING id`,
        [run.id, run.claim_token],
      );
      if (!ready.rows[0]) return;
      run.dispatch_uncertain = true;
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BoostlyPro/1.0 (+api)" },
        body: params,
        signal: AbortSignal.timeout(12_000),
      });
      // Read the response inside the same uncertainty boundary as fetch.
      text = await response.text();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider request failed.";
      if (requestNeverReachedProvider(error)) {
        // Provider site unreachable: no paid request left this server, so try the next priority provider.
        await pool.query(`UPDATE lovable_legacy.organic_run_schedule SET dispatch_uncertain=false WHERE id=$1::uuid`, [run.id]);
        run.dispatch_uncertain = false;
        const code = String((error as any)?.cause?.code ?? (error as any)?.code ?? "unreachable");
        failures.push(`${account.name}: provider unreachable (${code})`);
        unavailableCount += 1;
        await audit(run, "provider_unreachable", account, { request: requestPayload, error: `${message} (${code})` });
        logger.warn({ runId: run.id, providerAccountId: account.id, code }, "Provider unreachable; trying next priority provider");
        await releaseAttempt(run.id);
        continue;
      }
      await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET status='dispatch_uncertain',dispatch_uncertain=true,error_message=$1,updated_at=now()
          WHERE id=$2::uuid AND status='dispatching'`,
        [`[dispatch uncertain] ${message}`, run.id],
      );
      await audit(run, "dispatch_uncertain", account, { request: requestPayload, error: message });
      logger.warn({ runId: run.id, providerAccountId: account.id, err: message }, "Provider dispatch uncertain; automatic resend blocked");
      return;
    }

    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule SET status='dispatch_uncertain',
            dispatch_uncertain=true,error_message=$1,updated_at=now() WHERE id=$2::uuid`,
        [`Provider returned HTTP ${response.status} without a readable order confirmation; verify before resending.`, run.id],
      );
      await audit(run, "dispatch_uncertain", account, { request: requestPayload, error: "Unreadable provider response." });
      return;
    }
    const providerOrderId = body?.order ?? body?.order_id ?? body?.id;

    if (!response.ok || body?.error || !providerOrderId) {
      if (!body?.error) {
        await pool.query(
          `UPDATE lovable_legacy.organic_run_schedule SET status='dispatch_uncertain',
              dispatch_uncertain=true,error_message='Provider confirmation missing; verify before resending.',updated_at=now()
            WHERE id=$1::uuid`, [run.id],
        );
        await audit(run, "dispatch_uncertain", account, { request: requestPayload, response: body });
        return;
      }
      // An explicit rejection confirms no order was accepted, so failover is safe.
      await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule SET dispatch_uncertain=false WHERE id=$1::uuid`, [run.id],
      );
      run.dispatch_uncertain = false;
      const message = String(body?.error ?? "Provider did not return an order ID.");
      failures.push(`${account.name}: ${message}`);
      await audit(run, isBusyMessage(message) ? "provider_busy_response" : "provider_rejected", account, {
        request: requestPayload,
        response: body,
        error: message,
      });
      if (isBusyMessage(message)) busyCount += 1;
      await releaseAttempt(run.id);
      continue;
    }

    const accepted = await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET provider_order_id=$1,provider_response=$2::jsonb,provider_status='Pending',
              status='started',started_at=COALESCE(started_at,now()),dispatch_uncertain=false,
              error_message=NULL,updated_at=now()
        WHERE id=$3::uuid AND status='dispatching' AND claim_token=$4::uuid
        RETURNING id`,
      [String(providerOrderId), JSON.stringify(body), run.id, run.claim_token],
    );
    if (!accepted.rows[0]) {
      await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule SET status='dispatch_uncertain',dispatch_uncertain=true,
            error_message='Provider returned an order ID but local confirmation failed; verify before resending.',updated_at=now()
          WHERE id=$1::uuid AND provider_order_id IS NULL`, [run.id],
      );
      await audit(run, "dispatch_uncertain", account, { providerOrderId: String(providerOrderId), request: requestPayload, response: body });
      return;
    }
    await audit(run, "dispatch_succeeded", account, {
      providerOrderId: String(providerOrderId),
      request: requestPayload,
      response: body,
    });
    logger.info({ runId: run.id, providerAccountId: account.id, providerOrderId: String(providerOrderId) }, "Organic run sent to provider");
    return;
  }

  // No provider accepted the run and at least one rejected it for being below
  // its minimum (other mappings often fail too, e.g. "Incorrect service ID").
  // Rather than failing the run (which strands the order), fold its quantity
  // into the next pending run of the same item; totals stay exact. Comment
  // runs keep their retry behavior because their text must match the run
  // quantity exactly.
  if (!isCommentEngagement(run.engagement_type) && failures.length > 0
    && failures.some((failure) => isMinimumQuantityMessage(failure))) {
    if (await mergeRunIntoNextRun(run)) {
      await audit(run, "below_minimum_merged", undefined, { error: failures.join(" | ") });
      logger.info({ runId: run.id }, "Run below every provider minimum; merged into next run");
      return;
    }
  }

  if (busyCount > 0) {
    const message = "All active provider accounts are busy for this link and engagement type.";
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET status='pending',claim_token=NULL,claimed_at=NULL,rotation_lock_key=NULL,
              user_provider_account_id=NULL,user_provider_account_name=NULL,error_message=$1,
              retry_count=retry_count+1,scheduled_at=now()+interval '1 minute',updated_at=now()
        WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL`,
      [message, run.id],
    );
    await audit(run, "all_providers_busy_requeued", undefined, { error: message });
    return;
  }

  if (unavailableCount > 0) {
    const message = "Provider unreachable or needs attention; run stays queued and retries automatically.";
    const retryMinutes = retryDelayMinutes(Number(run.retry_count ?? 0), 5);
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET status='pending',claim_token=NULL,claimed_at=NULL,rotation_lock_key=NULL,
              user_provider_account_id=NULL,user_provider_account_name=NULL,error_message=$1,
              retry_count=retry_count+1,scheduled_at=now()+($3 * interval '1 minute'),updated_at=now()
        WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL`,
      [message, run.id, retryMinutes],
    );
    await audit(run, "provider_credentials_requeued", undefined, { error: message });
    return;
  }

  throw new Error(failures.join(" | ") || "No active provider accepted this run.");
}

async function holdUnsentRun(run: any, message: string): Promise<void> {
  await pool.query(
    `UPDATE lovable_legacy.organic_run_schedule
        SET status='pending',claim_token=NULL,claimed_at=NULL,rotation_lock_key=NULL,
            user_provider_account_id=NULL,user_provider_account_name=NULL,error_message=$1,
            scheduled_at=now()+interval '1 minute',updated_at=now()
      WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL`,
    [message, run.id],
  );
}

/** Confirmed provider delivery, never scheduled or merely accepted Views. */
async function confirmedViewsDispatchAllowed(run: any): Promise<boolean> {
  if (/views?$/i.test(String(run.engagement_type))) return true;
  const result = await pool.query(
    `SELECT me.quantity AS item_total,vi.quantity AS views_total,
       COALESCE((SELECT SUM(CASE
         WHEN vr.provider_remains IS NOT NULL THEN GREATEST(0,vr.quantity_to_send-vr.provider_remains)
         WHEN vr.status='completed' THEN vr.quantity_to_send ELSE 0 END)
         FROM lovable_legacy.organic_run_schedule vr
         WHERE vr.engagement_order_item_id=vi.id AND vr.provider_order_id IS NOT NULL
           AND vr.status NOT IN ('pending','dispatching','merged','dispatch_uncertain')),0) AS views_delivered,
       COALESCE((SELECT SUM(GREATEST(0,s.quantity_to_send-COALESCE(s.drift_adjustment,0)))
         FROM lovable_legacy.organic_run_schedule s
         WHERE s.engagement_order_item_id=me.id AND s.id<>$1::uuid
           AND (s.provider_order_id IS NOT NULL OR s.status IN ('dispatching','dispatch_uncertain'))),0) AS sent_base
     FROM lovable_legacy.engagement_order_items me
     LEFT JOIN lovable_legacy.engagement_order_items vi
       ON vi.engagement_order_id=me.engagement_order_id AND vi.engagement_type ~* 'views?$'
     WHERE me.id=$2::uuid LIMIT 1`,
    [run.id, run.engagement_order_item_id],
  );
  const row = result.rows[0];
  const allowed = engagementViewsAllowed({ type: String(run.engagement_type),
    viewsTotal: Number(row?.views_total || 0), viewsDelivered: Number(row?.views_delivered || 0),
    itemTotal: Number(row?.item_total || 0), alreadySentBase: Number(row?.sent_base || 0),
    runBase: Math.max(0, Number(run.quantity_to_send) - Number(run.drift_adjustment || 0)) });
  if (!allowed) await holdUnsentRun(run, 'Waiting for confirmed Views delivery required by this engagement ratio.');
  return allowed;
}

// Imported catalog is refreshed by My Providers. Unimported service IDs use a
// read-only services lookup; never probe minimums by creating a paid order.
/**
 * Attach verified provider min/max when known. Unknown limits must never stop
 * delivery: the mapping is kept unchanged and an explicit provider rejection
 * still fails over safely. Only a verified incompatible limit filters it out.
 */
async function mappingsWithLimits(mappings: Mapping[], accounts: Map<string, ProviderAccount>): Promise<Mapping[]> {
  const result: Mapping[] = [];
  const catalogs = new Map<string, any[] | null>();
  for (const mapping of mappings) {
    let limits: any = null;
    try {
      const cached = await pool.query(
        `SELECT min_quantity,max_quantity FROM lovable_legacy.user_services
          WHERE user_provider_account_id=$1::uuid AND provider_service_id=$2 AND is_active=true LIMIT 1`,
        [mapping.user_provider_account_id, mapping.provider_service_id],
      );
      limits = cached.rows[0] ?? null;
      if (!limits || limits.min_quantity == null) {
        const account = accounts.get(mapping.user_provider_account_id);
        let catalog = account ? catalogs.get(account.id) : null;
        if (account && catalog === undefined) {
          catalog = null;
          try {
            const response = await fetch(safePanelUrl(account.api_url), {
              method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ key: decryptProviderCredential(account.api_key_ciphertext), action: 'services' }),
              signal: AbortSignal.timeout(8000),
            });
            const body = response.ok ? await response.json() : null;
            if (Array.isArray(body)) catalog = body;
          } catch (error) {
            logger.warn({ runProvider: account.id, error: String(error) }, 'Provider limits unavailable; dispatching without limit filter');
          }
          catalogs.set(account.id, catalog);
        }
        const service = catalog?.find((s: any) => String(s.service ?? s.id) === mapping.provider_service_id);
        limits = service ? { min_quantity: service.min, max_quantity: service.max } : null;
      }
    } catch { limits = null; }
    const min = Number(limits?.min_quantity);
    const max = Number(limits?.max_quantity);
    const known = Number.isFinite(min) && min >= 1 && Number.isFinite(max) && max >= min;
    result.push(known ? { ...mapping, min_quantity: min, max_quantity: max } : { ...mapping, min_quantity: null, max_quantity: null });
  }
  return result;
}

async function processNextRun(): Promise<boolean> {
  const run = await claimRun();
  if (!run) return false;
  try {
    await dispatch(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider dispatch failed.";
    if (isCommentEngagement(run.engagement_type)) {
      const result = await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET status=CASE WHEN COALESCE(dispatch_uncertain,false) THEN 'dispatch_uncertain' ELSE 'pending' END,
                rotation_lock_key=CASE WHEN COALESCE(dispatch_uncertain,false) THEN rotation_lock_key ELSE NULL END,
                claim_token=NULL,claimed_at=NULL,
                error_message=CASE WHEN COALESCE(dispatch_uncertain,false) THEN $1 ELSE '[failover] '||$1 END,
                retry_count=retry_count+1,
                scheduled_at=now()+($3 * interval '1 minute'),completed_at=NULL,updated_at=now()
          WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL RETURNING status`,
        [message, run.id, commentRetryMinutes(Number(run.retry_count ?? 0))],
      );
      if (result.rows[0]) await audit(run, result.rows[0].status === "pending" ? "comment_requeued" : "dispatch_uncertain",
        undefined, { error: message });
      logger.warn({ runId: run.id, err: message }, "Comment run retained for retry or provider confirmation");
      return true;
    }
    if (run.dispatch_uncertain) {
      await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET status='dispatch_uncertain',dispatch_uncertain=true,claim_token=NULL,claimed_at=NULL,
                error_message=$1,retry_count=retry_count+1,completed_at=NULL,updated_at=now()
          WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL`,
        [message, run.id],
      );
      await audit(run, "dispatch_uncertain", undefined, { error: message });
      logger.warn({ runId: run.id, err: message }, "Non-comment dispatch retained for provider confirmation");
      return true;
    }
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET status='failed',rotation_lock_key=NULL,claim_token=NULL,error_message=$1,
              retry_count=retry_count+1,completed_at=now(),updated_at=now()
        WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL`,
      [message, run.id],
    );
    await audit(run, "dispatch_failed", undefined, { error: message });
    logger.warn({ runId: run.id, err: message }, "Organic run dispatch failed");
  }
  return true;
}

async function executorTick(): Promise<void> {
  if (executorRunning && !executorStalled(executorRunning, executorStartedAt)) return;
  if (executorRunning) logger.error({ stalledMs: Date.now() - executorStartedAt }, "Rotation executor stalled; starting a fresh tick");
  if (pool.waitingCount > 0 || pool.idleCount + pool.waitingCount === 0 && pool.totalCount > 0) {
    logger.warn({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }, "Worker DB pool busy");
  }
  executorRunning = true;
  const myStart = Date.now();
  executorStartedAt = myStart;
  try {
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule SET status='dispatch_uncertain',
          error_message='Dispatch interrupted; verify provider acceptance before resending.',updated_at=now()
        WHERE status='dispatching' AND provider_order_id IS NULL
          AND dispatch_uncertain=true AND claimed_at<now()-interval '2 minutes'`,
    );
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET status='pending',claim_token=NULL,claimed_at=NULL,rotation_lock_key=NULL,
              user_provider_account_id=NULL,user_provider_account_name=NULL,
              error_message='Executor claim expired before provider dispatch.',updated_at=now()
        WHERE status='dispatching'
          AND provider_order_id IS NULL
          AND COALESCE(dispatch_uncertain,false)=false
          AND claimed_at<now()-interval '2 minutes'`,
    );
    await Promise.all(Array.from({ length: EXECUTOR_CONCURRENCY }, async () => {
      for (let count = 0; count < RUNS_PER_EXECUTOR; count += 1) {
        const step = await Promise.race([
          processNextRun(),
          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), RUN_STEP_TIMEOUT_MS).unref()),
        ]);
        if (step === "timeout") { logger.error("Run dispatch step exceeded time limit; moving on"); break; }
        if (!step) break;
      }
    }));
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : "Executor tick failed" }, "Rotation executor tick failed");
  } finally {
    if (executorStartedAt === myStart) executorRunning = false;
  }
}

function providerStatus(body: any): string {
  return String(body?.status ?? body?.order_status ?? "").trim();
}

function isTerminalStatus(status: string): boolean {
  return ["completed", "complete", "partial", "canceled", "cancelled", "refunded", "failed", "failure", "error"].includes(status.toLowerCase());
}

function optionalProviderNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

async function checkRunStatus(run: any): Promise<boolean> {
  const account: ProviderAccount = {
    id: run.user_provider_account_id,
    name: run.user_provider_account_name,
    api_url: run.api_url,
    api_key_ciphertext: run.api_key_ciphertext,
    priority: Number(run.priority ?? 1),
  };
  let key: string;
  try {
    key = decryptProviderCredential(account.api_key_ciphertext);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider credential is unavailable.";
    await Promise.all([
      pool.query(
        `UPDATE lovable_legacy.user_provider_accounts
            SET is_active=false,last_tested_at=now(),last_test_ok=false,last_test_error=$1,updated_at=now()
          WHERE id=$2::uuid`,
        [message, account.id],
      ),
      pool.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET error_message=$1,updated_at=now()
          WHERE id=$2::uuid`,
        [`[status check] ${message}`, run.id],
      ),
    ]);
    await audit(run, "status_provider_unavailable", account, {
      providerOrderId: String(run.provider_order_id),
      error: message,
    });
    return false;
  }

  try {
    const params = new URLSearchParams({ key, action: "status", order: String(run.provider_order_id) });
    const response = await fetch(safePanelUrl(account.api_url), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BoostlyPro/1.0 (+api)" },
      body: params,
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Provider returned HTTP ${response.status} without JSON.`);
    }
    if (!response.ok || body?.error) throw new Error(String(body?.error ?? `Provider returned HTTP ${response.status}.`));

    const status = providerStatus(body) || String(run.provider_status ?? "Pending");
    const terminal = isTerminalStatus(status);
    const normalizedStatus = status.toLowerCase();
    let internalStatus = "started";
    if (terminal) {
      if (normalizedStatus.startsWith("partial")) internalStatus = "partial";
      else if (normalizedStatus.startsWith("cancel") || normalizedStatus === "refunded") internalStatus = "cancelled";
      else if (["failed", "failure", "error"].includes(normalizedStatus)) internalStatus = "failed";
      else internalStatus = "completed";
    }
    const startCount = optionalProviderNumber(body?.start_count);
    const remains = optionalProviderNumber(body?.remains);
    const charge = optionalProviderNumber(body?.charge);

    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET provider_status=$1,provider_start_count=COALESCE($2,provider_start_count),
              provider_remains=COALESCE($3,provider_remains),provider_charge=COALESCE($4,provider_charge),
              provider_response=$5::jsonb,last_status_check=now(),status=$6,
              completed_at=CASE WHEN $7 THEN COALESCE(completed_at,now()) ELSE completed_at END,
              rotation_lock_key=CASE WHEN $7 THEN NULL ELSE rotation_lock_key END,
              updated_at=now()
        WHERE id=$8::uuid AND provider_order_id=$9`,
      [
        status,
        startCount,
        remains,
        charge,
        JSON.stringify(body),
        internalStatus,
        terminal,
        run.id,
        String(run.provider_order_id),
      ],
    );
    if (terminal && shouldFailoverCancelledRun({ engagement_type: run.engagement_type, status,
      quantity_to_send: Number(run.quantity_to_send), remains: body?.remains, charge: body?.charge,
      retry_count: run.retry_count })) {
      const timing = await failoverTiming(run);
      const block = failedRunFailoverBlock({
        status: internalStatus,
        providerStatus: status,
        providerOrderId: run.provider_order_id,
        quantityToSend: Number(run.quantity_to_send),
        providerRemains: remains,
        ...timing,
        now: new Date(),
      });
      if (block) {
        const message = block === "views-complete"
          ? "Failover skipped: all views runs and the ordered views total are already complete."
          : block === "next-run-due"
            ? "Failover skipped: the following run is already due; the old order was not duplicated."
            : "Failover skipped: the provider outcome is not safe for automatic replacement.";
        await pool.query(
          `UPDATE lovable_legacy.organic_run_schedule SET status='failed',error_message=$1,updated_at=now()
            WHERE id=$2::uuid AND provider_order_id=$3`,
          [message, run.id, String(run.provider_order_id)],
        );
        await audit(run, "failover_skipped", account, { providerOrderId: String(run.provider_order_id), response: body, error: message });
        return true;
      }
      // Confirmed zero-delivery terminal failure: queue the same run inside
      // its original curve window and demote every provider already tried.
      await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET status='pending',provider_order_id=NULL,provider_status=NULL,provider_remains=NULL,
                provider_start_count=NULL,provider_charge=NULL,started_at=NULL,completed_at=NULL,
                claim_token=NULL,claimed_at=NULL,rotation_lock_key=NULL,dispatch_uncertain=false,
                retry_count=retry_count+1,scheduled_at=now()+($1 * interval '1 minute'),
                error_message=$2,updated_at=now()
          WHERE id=$3::uuid AND provider_order_id=$4`,
        [Number(run.retry_count ?? 0) === 0 ? 0 : Math.min(10, commentRetryMinutes(Number(run.retry_count ?? 0))),
          `[failover] Provider ${status} order ${run.provider_order_id} with nothing delivered; sending to an untried priority provider.${appendCancelledProviderMark(run.error_message, account?.id ?? run.user_provider_account_id)}`,
          run.id, String(run.provider_order_id)],
      );
      await audit(run, "cancelled_failover", account, { providerOrderId: String(run.provider_order_id), response: body });
      return true;
    }
    if (terminal) {
      await audit(run, "status_terminal", account, {
        providerOrderId: String(run.provider_order_id),
        response: body,
      });
    }
    return terminal;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider status check failed.";
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET last_status_check=now(),error_message=$1,updated_at=now()
        WHERE id=$2::uuid`,
      [`[status check] ${message}`, run.id],
    );
    await audit(run, "status_check_failed", account, {
      providerOrderId: String(run.provider_order_id),
      error: message,
    });
    return false;
  }
}

/**
 * Items and orders never had a completion rollup, so finished orders stayed
 * "Processing" forever. Mark items completed once all their runs are terminal
 * with none failed, then complete orders whose items are all resolved.
 */
async function rollupFinishedItemsAndOrders(): Promise<void> {
  await pool.query(
    `UPDATE lovable_legacy.engagement_order_items i
        SET status='completed', updated_at=now()
      WHERE COALESCE(i.status,'pending') IN ('pending','processing')
        AND NOT EXISTS (SELECT 1 FROM lovable_legacy.organic_run_schedule s
                         WHERE s.engagement_order_item_id=i.id
                           AND s.status IN ('pending','dispatching','started','processing','dispatch_uncertain'))
        AND NOT EXISTS (SELECT 1 FROM lovable_legacy.organic_run_schedule s
                         WHERE s.engagement_order_item_id=i.id AND s.status='failed')`,
  );
  await pool.query(
    `UPDATE lovable_legacy.engagement_orders o
        SET status='completed', updated_at=now()
      WHERE o.status IN ('pending','processing')
        AND EXISTS (SELECT 1 FROM lovable_legacy.engagement_order_items i
                     WHERE i.engagement_order_id=o.id AND i.status='completed')
        AND NOT EXISTS (SELECT 1 FROM lovable_legacy.engagement_order_items i
                         WHERE i.engagement_order_id=o.id
                           AND COALESCE(i.status,'pending') IN ('pending','processing'))`,
  );
}

type DelayedDeliveryRun = {
  id: string;
  engagement_order_id: string;
  order_number: number;
  user_id: string;
  user_provider_account_id: string;
  provider_order_id: string;
  quantity_to_send: number;
  provider_remains: number | null;
  started_at: string;
  status: string;
  speedup_ticketed_at: string | null;
};

/**
 * Raise one internal Support ticket per delayed provider run. Tickets never
 * resend, cancel or otherwise modify the paid provider order. Grouping by
 * Reel order and provider puts multiple delayed IDs in one urgent message.
 */
async function processDelayedDeliveryTickets(): Promise<void> {
  const delayMinutes = speedupTicketDelayMinutes(process.env.DELIVERY_SPEEDUP_TICKET_MINUTES);
  const candidates = await pool.query<DelayedDeliveryRun>(
    `SELECT rs.id,eoi.engagement_order_id,eo.order_number,eo.user_id,rs.user_provider_account_id,
            rs.provider_order_id,rs.quantity_to_send,rs.provider_remains,rs.started_at,rs.status,rs.speedup_ticketed_at
       FROM lovable_legacy.organic_run_schedule rs
       JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=rs.engagement_order_item_id
       JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id
      WHERE rs.status IN ('started','processing')
        AND rs.provider_order_id IS NOT NULL
        AND rs.speedup_ticketed_at IS NULL
        AND rs.started_at<=now()-($1 * interval '1 minute')
        AND (rs.provider_remains IS NULL OR rs.provider_remains>=rs.quantity_to_send)
        AND COALESCE(eo.status,'pending') NOT IN ('deleted','cancelled','canceled','completed')
      ORDER BY rs.started_at
      LIMIT 100`,
    [delayMinutes],
  );
  const groups = new Map<string, DelayedDeliveryRun[]>();
  for (const run of candidates.rows) {
    const key = `${run.user_id}:${run.engagement_order_id}:${run.user_provider_account_id}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  for (const group of groups.values()) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ids = group.map((run) => run.id);
      const locked = await client.query<DelayedDeliveryRun>(
        `SELECT rs.id,eoi.engagement_order_id,eo.order_number,eo.user_id,rs.user_provider_account_id,
                rs.provider_order_id,rs.quantity_to_send,rs.provider_remains,rs.started_at,rs.status,rs.speedup_ticketed_at
           FROM lovable_legacy.organic_run_schedule rs
           JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=rs.engagement_order_item_id
           JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id
          WHERE rs.id=ANY($1::uuid[])
            AND rs.status IN ('started','processing')
            AND rs.provider_order_id IS NOT NULL
            AND rs.speedup_ticketed_at IS NULL
            AND rs.started_at<=now()-($2 * interval '1 minute')
            AND (rs.provider_remains IS NULL OR rs.provider_remains>=rs.quantity_to_send)
            AND COALESCE(eo.status,'pending') NOT IN ('deleted','cancelled','canceled','completed')
          FOR UPDATE OF rs`,
        [ids, delayMinutes],
      );
      const now = new Date();
      const eligible = locked.rows.filter((run) => speedupTicketEligible({
        providerOrderId: run.provider_order_id,
        status: run.status,
        startedAt: run.started_at,
        quantityToSend: Number(run.quantity_to_send),
        providerRemains: run.provider_remains === null ? null : Number(run.provider_remains),
        speedupTicketedAt: run.speedup_ticketed_at,
        now,
      }, delayMinutes));
      if (!eligible.length) {
        await client.query("ROLLBACK");
        continue;
      }
      const first = eligible[0];
      const message = speedupTicketMessage(eligible.map((run) => run.provider_order_id));
      const ticket = await client.query<{ id: string }>(
        `INSERT INTO lovable_legacy.support_tickets
          (user_id,subject,message,category,priority,status)
         VALUES ($1,$2,$3,'delivery','high','open') RETURNING id`,
        [first.user_id, `Urgent delivery speed-up – Engagement Order #${first.order_number}`, message],
      );
      const ticketId = ticket.rows[0]?.id;
      if (!ticketId) throw new Error("Support ticket could not be created.");
      await client.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET speedup_ticketed_at=now(),speedup_ticket_id=$1::uuid,updated_at=now()
          WHERE id=ANY($2::uuid[]) AND speedup_ticketed_at IS NULL`,
        [ticketId, eligible.map((run) => run.id)],
      );
      await client.query("COMMIT");
      logger.info({ ticketId, orderNumber: first.order_number, providerOrderIds: eligible.map((run) => run.provider_order_id) },
        "Automatic delivery speed-up ticket created");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error({ err: error instanceof Error ? error.message : "Ticket creation failed", orderNumber: group[0]?.order_number },
        "Automatic delivery speed-up ticket failed");
    } finally {
      client.release();
    }
  }
}

/**
 * Once every Views run of an order has been delivered, the remaining
 * like/save/share/repost/comment runs are pulled in so they finish right
 * after Views (a few minutes apart, order kept) instead of trailing later.
 */
async function finishEngagementAfterViews(): Promise<void> {
  await pool.query(
    `WITH done AS (
       SELECT vi.engagement_order_id FROM lovable_legacy.engagement_order_items vi
        JOIN lovable_legacy.engagement_orders eo ON eo.id=vi.engagement_order_id
        WHERE vi.engagement_type ~* 'views?$' AND eo.status IN ('pending','processing')
          AND COALESCE(vi.status,'pending') NOT IN ('paused','cancelled','canceled')
          AND NOT EXISTS (SELECT 1 FROM lovable_legacy.organic_run_schedule v
                WHERE v.engagement_order_item_id=vi.id AND v.status NOT IN ('completed','partial','merged','cancelled','canceled','failed'))
     ), late AS (
       SELECT rs.id, ROW_NUMBER() OVER (PARTITION BY rs.engagement_order_item_id ORDER BY rs.run_number) AS k
         FROM lovable_legacy.organic_run_schedule rs
         JOIN lovable_legacy.engagement_order_items i ON i.id=rs.engagement_order_item_id
         JOIN done ON done.engagement_order_id=i.engagement_order_id
        WHERE i.engagement_type !~* 'views?$' AND rs.status='pending' AND rs.provider_order_id IS NULL
          AND COALESCE(i.status,'pending') NOT IN ('paused','cancelled','canceled')
          AND rs.scheduled_at>now()+interval '3 minutes'
     )
     UPDATE lovable_legacy.organic_run_schedule rs
        SET scheduled_at=now()+(late.k*3 - 1 + random()) * interval '1 minute',updated_at=now()
       FROM late WHERE rs.id=late.id`,
  );
}

async function checkerTick(): Promise<void> {
  if (checkerRunning && !executorStalled(checkerRunning, checkerStartedAt)) return;
  if (checkerRunning) logger.error({ stalledMs: Date.now() - checkerStartedAt }, "Status checker stalled; starting a fresh tick");
  checkerRunning = true;
  const myStart = Date.now();
  checkerStartedAt = myStart;
  try {
    await rollupFinishedItemsAndOrders();
    await finishEngagementAfterViews().catch((error) =>
      logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Finish-after-views pass skipped"));
    const result = await pool.query(
      `WITH candidates AS (
         SELECT rs.id
           FROM lovable_legacy.organic_run_schedule rs
          WHERE rs.status IN ('started','processing')
            AND rs.provider_order_id IS NOT NULL
            AND (rs.last_status_check IS NULL OR rs.last_status_check<now()-interval '45 seconds')
          ORDER BY COALESCE(rs.last_status_check,rs.started_at,rs.updated_at)
          FOR UPDATE SKIP LOCKED
          LIMIT 500
       ), claimed AS (
         UPDATE lovable_legacy.organic_run_schedule rs
            SET last_status_check=now()
           FROM candidates
          WHERE rs.id=candidates.id
          RETURNING rs.*
       )
       SELECT claimed.*,eoi.engagement_type,eo.id AS engagement_order_id,eo.user_id,eo.link,
              upa.api_url,upa.api_key_ciphertext,upa.priority
         FROM claimed
         JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=claimed.engagement_order_item_id
         JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id
         JOIN lovable_legacy.user_provider_accounts upa ON upa.id=claimed.user_provider_account_id`,
    );
    const batches = result.rows;
    let releasedLock = false;
    for (let index = 0; index < batches.length; index += 20) {
      const terminalResults = await Promise.all(batches.slice(index, index + 20).map(checkRunStatus));
      releasedLock = releasedLock || terminalResults.some(Boolean);
    }
    try {
      await processDelayedDeliveryTickets();
    } catch (error) {
      logger.error({ err: error instanceof Error ? error.message : "Delayed-ticket pass failed" }, "Delayed-delivery ticket pass failed");
    }
    if (releasedLock) {
      void executorTick();
    }
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : "Status checker tick failed" }, "Provider status checker tick failed");
  } finally {
    if (checkerStartedAt === myStart) checkerRunning = false;
  }
}

/** Run one executor pass immediately (e.g. right after a new order is placed). */
export function kickRotationExecutor(): void {
  void executorTick();
}

export function startMultiProviderRotationWorkers(): void {
  void Promise.all([executorTick(), checkerTick()]);
  setInterval(() => void executorTick(), 60_000).unref();
  setInterval(() => void checkerTick(), 60_000).unref();
}
