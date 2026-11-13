import { createHash, randomUUID } from "node:crypto";
// Background ticks use their own small pool so they never hold connections
// that interactive requests are waiting for.
import { workerPool as pool } from "../db";
import { decryptProviderCredential } from "../lib/providerCredentials";
import { logger } from "../lib/logger";
import { commentRetryMinutes, isCommentEngagement, runCommentText, shouldRecreateCancelledComment } from "../lib/commentDelivery";

type Mapping = {
  user_provider_account_id: string;
  provider_service_id: string;
  priority?: number;
};

type ProviderAccount = {
  id: string;
  name: string;
  api_url: string;
  api_key_ciphertext: string;
  priority: number;
};

let executorRunning = false;
let checkerRunning = false;

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
       SELECT rs.id
         FROM lovable_legacy.organic_run_schedule rs
         JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=rs.engagement_order_item_id
         JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id
        WHERE rs.status='pending'
          AND rs.scheduled_at<=now()
          AND eo.status IN ('pending','processing')
          AND COALESCE(eoi.status,'pending') NOT IN ('paused','cancelled','canceled')
          AND rs.provider_order_id IS NULL
          AND COALESCE(rs.dispatch_uncertain,false)=false
         ORDER BY
           CASE WHEN eo.created_at >= now()-interval '24 hours' THEN 0 ELSE 1 END,
           CASE WHEN eo.created_at >= now()-interval '24 hours' THEN eo.created_at END DESC,
           rs.scheduled_at,rs.run_number,rs.created_at
        FOR UPDATE OF rs SKIP LOCKED
        LIMIT 1
     ), claimed AS (
       UPDATE lovable_legacy.organic_run_schedule rs
          SET status='dispatching',claim_token=$1::uuid,claimed_at=now(),
              error_message=NULL,updated_at=now()
         FROM candidate
        WHERE rs.id=candidate.id AND rs.status='pending'
        RETURNING rs.*
     )
     SELECT claimed.*,eoi.provider_mappings,eoi.user_provider_account_id,
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

async function dispatch(run: any): Promise<void> {
  // Validate before taking a provider lock or making any paid request.
  const comments = runCommentText(run);
  const mappings = (Array.isArray(run.provider_mappings) ? run.provider_mappings : []) as Mapping[];
  const accounts = await loadAccounts(mappings);
  const ordered = mappings
    .filter((mapping) => mapping.user_provider_account_id && mapping.provider_service_id && accounts.has(mapping.user_provider_account_id))
    .sort((left, right) => {
      const mappingPriority = Number(left.priority ?? 999) - Number(right.priority ?? 999);
      if (mappingPriority !== 0) return mappingPriority;
      return Number(accounts.get(left.user_provider_account_id)?.priority ?? 999) -
        Number(accounts.get(right.user_provider_account_id)?.priority ?? 999);
    });

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
      // A crash after sending an add request must not cause a duplicate paid
      // comment order when the stale-claim recovery runs after restart.
      if (comments) {
        const ready = await pool.query(
          `UPDATE lovable_legacy.organic_run_schedule SET dispatch_uncertain=true,updated_at=now()
            WHERE id=$1::uuid AND status='dispatching' AND claim_token=$2::uuid RETURNING id`,
          [run.id, run.claim_token],
        );
        if (!ready.rows[0]) return;
      }
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
      if (comments) {
        await pool.query(
          `UPDATE lovable_legacy.organic_run_schedule SET status='dispatch_uncertain',
              dispatch_uncertain=true,error_message=$1,updated_at=now() WHERE id=$2::uuid`,
          [`Provider returned HTTP ${response.status} without a readable order confirmation; verify before resending.`, run.id],
        );
        await audit(run, "dispatch_uncertain", account, { request: requestPayload, error: "Unreadable provider response." });
        return;
      }
      body = { error: `Provider returned HTTP ${response.status} without JSON.` };
    }
    const providerOrderId = body?.order ?? body?.order_id ?? body?.id;

    if (!response.ok || body?.error || !providerOrderId) {
      if (comments && !body?.error) {
        await pool.query(
          `UPDATE lovable_legacy.organic_run_schedule SET status='dispatch_uncertain',
              dispatch_uncertain=true,error_message='Provider confirmation missing; verify before resending.',updated_at=now()
            WHERE id=$1::uuid`, [run.id],
        );
        await audit(run, "dispatch_uncertain", account, { request: requestPayload, response: body });
        return;
      }
      // An explicit rejection confirms no order was accepted, so failover is safe.
      if (comments) await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule SET dispatch_uncertain=false WHERE id=$1::uuid`, [run.id],
      );
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

    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule
          SET provider_order_id=$1,provider_response=$2::jsonb,provider_status='Pending',
              status='started',started_at=COALESCE(started_at,now()),dispatch_uncertain=false,
              error_message=NULL,updated_at=now()
        WHERE id=$3::uuid AND status='dispatching' AND claim_token=$4::uuid`,
      [String(providerOrderId), JSON.stringify(body), run.id, run.claim_token],
    );
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
    const message = "Provider credentials require attention. Run remains queued until an account is reactivated.";
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
                claim_token=NULL,claimed_at=NULL,error_message=$1,retry_count=retry_count+1,
                scheduled_at=now()+($3 * interval '1 minute'),completed_at=NULL,updated_at=now()
          WHERE id=$2::uuid AND status='dispatching' AND provider_order_id IS NULL RETURNING status`,
        [message, run.id, commentRetryMinutes(Number(run.retry_count ?? 0))],
      );
      if (result.rows[0]) await audit(run, result.rows[0].status === "pending" ? "comment_requeued" : "dispatch_uncertain",
        undefined, { error: message });
      logger.warn({ runId: run.id, err: message }, "Comment run retained for retry or provider confirmation");
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
  if (executorRunning) return;
  executorRunning = true;
  try {
    await pool.query(
      `UPDATE lovable_legacy.organic_run_schedule SET status='dispatch_uncertain',
          error_message='Comment dispatch interrupted; verify provider acceptance before resending.',updated_at=now()
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
        if (!(await processNextRun())) break;
      }
    }));
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : "Executor tick failed" }, "Rotation executor tick failed");
  } finally {
    executorRunning = false;
  }
}

function providerStatus(body: any): string {
  return String(body?.status ?? body?.order_status ?? "").trim();
}

function isTerminalStatus(status: string): boolean {
  return ["completed", "complete", "partial", "canceled", "cancelled", "refunded"].includes(status.toLowerCase());
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
    const internalStatus = terminal
      ? status.toLowerCase().startsWith("partial")
        ? "partial"
        : status.toLowerCase().startsWith("cancel") || status.toLowerCase() === "refunded"
          ? "cancelled"
          : "completed"
      : "started";

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
        Number.isFinite(Number(body?.start_count)) ? Number(body.start_count) : null,
        Number.isFinite(Number(body?.remains)) ? Number(body.remains) : null,
        Number.isFinite(Number(body?.charge)) ? Number(body.charge) : null,
        JSON.stringify(body),
        internalStatus,
        terminal,
        run.id,
        String(run.provider_order_id),
      ],
    );
    if (terminal && shouldRecreateCancelledComment({ engagement_type: run.engagement_type, status,
      quantity_to_send: Number(run.quantity_to_send), remains: body?.remains, charge: body?.charge,
      retry_count: run.retry_count })) {
      // Provider closed the order unpaid with nothing delivered: queue the same
      // run (same text, same quantity) as a fresh provider order.
      await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET status='pending',provider_order_id=NULL,provider_status=NULL,provider_remains=NULL,
                provider_start_count=NULL,provider_charge=NULL,started_at=NULL,completed_at=NULL,
                claim_token=NULL,claimed_at=NULL,rotation_lock_key=NULL,dispatch_uncertain=false,
                retry_count=retry_count+1,scheduled_at=now()+($1 * interval '1 minute'),
                error_message=$2,updated_at=now()
          WHERE id=$3::uuid AND provider_order_id=$4`,
        [Math.min(10, commentRetryMinutes(Number(run.retry_count ?? 0))),
          `Provider cancelled order ${run.provider_order_id} with nothing delivered; recreating.`,
          run.id, String(run.provider_order_id)],
      );
      await audit(run, "comment_recreated", account, { providerOrderId: String(run.provider_order_id), response: body });
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

async function checkerTick(): Promise<void> {
  if (checkerRunning) return;
  checkerRunning = true;
  try {
    await rollupFinishedItemsAndOrders();
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
    if (releasedLock) {
      void executorTick();
    }
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : "Status checker tick failed" }, "Provider status checker tick failed");
  } finally {
    checkerRunning = false;
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
