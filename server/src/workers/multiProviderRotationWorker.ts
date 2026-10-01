import { createHash, randomUUID } from "node:crypto";
// Background ticks use their own small pool so they never hold connections
// that interactive requests are waiting for.
import { workerPool as pool } from "../db";
import { decryptProviderCredential } from "../lib/providerCredentials";
import { logger } from "../lib/logger";

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
            eoi.engagement_type,eo.link,eo.id AS engagement_order_id,eo.user_id
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
    try {
      const params = new URLSearchParams({
        key,
        action: "add",
        service: mapping.provider_service_id,
        link: run.link,
        quantity: String(run.quantity_to_send),
      });
      response = await fetch(safePanelUrl(account.api_url), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BoostlyPro/1.0 (+api)" },
        body: params,
        signal: AbortSignal.timeout(12_000),
      });
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

    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `Provider returned HTTP ${response.status} without JSON.` };
    }
    const providerOrderId = body?.order ?? body?.order_id ?? body?.id;

    if (!response.ok || body?.error || !providerOrderId) {
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

async function checkerTick(): Promise<void> {
  if (checkerRunning) return;
  checkerRunning = true;
  try {
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

export function startMultiProviderRotationWorkers(): void {
  void Promise.all([executorTick(), checkerTick()]);
  setInterval(() => void executorTick(), 60_000).unref();
  setInterval(() => void checkerTick(), 60_000).unref();
}