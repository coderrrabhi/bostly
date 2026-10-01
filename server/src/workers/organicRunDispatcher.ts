import { pool } from "../db";
import { decryptProviderCredential } from "../lib/providerCredentials";
import { logger } from "../lib/logger";

type Mapping = {
  user_provider_account_id: string;
  provider_service_id: string;
  priority?: number;
};

let running = false;

class AllProvidersBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllProvidersBusyError";
  }
}

function isProviderBusyMessage(message: string): boolean {
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

function safePanelUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
      /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error("Provider API URL must be a public HTTPS URL.");
  }
  return url.toString().replace(/\/$/, "");
}

async function claimRun(): Promise<any | null> {
  const result = await pool.query(
    `WITH candidate AS (
       SELECT rs.id
         FROM lovable_legacy.organic_run_schedule rs
         JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=rs.engagement_order_item_id
         JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id
        WHERE rs.status='pending'
          AND rs.scheduled_at<=now()
          AND eo.status IN ('pending','processing')
          AND rs.provider_order_id IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM lovable_legacy.organic_run_schedule active
              JOIN lovable_legacy.engagement_order_items active_item
                ON active_item.id=active.engagement_order_item_id
             WHERE active_item.engagement_order_id=eoi.engagement_order_id
               AND active.status='started'
          )
        ORDER BY rs.updated_at DESC,rs.scheduled_at,rs.run_number
        FOR UPDATE OF rs SKIP LOCKED
        LIMIT 1
     )
     UPDATE lovable_legacy.organic_run_schedule rs
        SET status='started',started_at=now(),error_message=NULL,updated_at=now()
       FROM candidate
      WHERE rs.id=candidate.id
      RETURNING rs.id`,
  );
  if (!result.rows[0]) return null;

  const detail = await pool.query(
    `SELECT rs.*,eoi.provider_mappings,eoi.user_provider_account_id,
            eo.link,eo.id AS engagement_order_id
       FROM lovable_legacy.organic_run_schedule rs
       JOIN lovable_legacy.engagement_order_items eoi ON eoi.id=rs.engagement_order_item_id
       JOIN lovable_legacy.engagement_orders eo ON eo.id=eoi.engagement_order_id
      WHERE rs.id=$1::uuid`,
    [result.rows[0].id],
  );
  return detail.rows[0] ?? null;
}

async function dispatch(run: any): Promise<void> {
  const mappings = (Array.isArray(run.provider_mappings) ? run.provider_mappings : []) as Mapping[];
  mappings.sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999));
  const candidates = mappings.length > 0 ? mappings : (run.user_provider_account_id
    ? { user_provider_account_id: run.user_provider_account_id, provider_service_id: "" }
    : null);
  const orderedMappings = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  if (orderedMappings.length === 0) {
    throw new Error("No provider mapping is configured for this run.");
  }

  const failures: string[] = [];
  let busyCount = 0;

  for (const mapping of orderedMappings) {
    if (!mapping.user_provider_account_id || !mapping.provider_service_id) continue;

    try {
      const accountResult = await pool.query(
        `SELECT id,name,api_url,api_key_ciphertext
           FROM lovable_legacy.user_provider_accounts
          WHERE id=$1::uuid`,
        [mapping.user_provider_account_id],
      );
      const account = accountResult.rows[0];
      if (!account) {
        failures.push("Provider account not found.");
        continue;
      }

      const key = decryptProviderCredential(account.api_key_ciphertext);
      const params = new URLSearchParams({
        key,
        action: "add",
        service: mapping.provider_service_id,
        link: run.link,
        quantity: String(run.quantity_to_send),
      });
      let response: Response;
      try {
        response = await fetch(safePanelUrl(account.api_url), {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BoostlyPro/1.0 (+api)" },
          body: params,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        await pool.query(
          `UPDATE lovable_legacy.organic_run_schedule
              SET error_message=$1,updated_at=now()
            WHERE id=$2::uuid AND status='started'`,
          [`[dispatch uncertain] ${error instanceof Error ? error.message : "Provider request failed"}`, run.id],
        );
        return;
      }

      const text = await response.text();
      let body: any;
      try { body = JSON.parse(text); } catch { body = { error: `Provider returned HTTP ${response.status} without JSON.` }; }
      const providerOrderId = body?.order ?? body?.order_id ?? body?.id;
      if (!response.ok || body?.error || !providerOrderId) {
        const message = String(body?.error ?? "Provider did not return an order ID.");
        failures.push(`${account.name}: ${message}`);
        if (isProviderBusyMessage(message)) busyCount += 1;
        continue;
      }

      await pool.query(
        `UPDATE lovable_legacy.organic_run_schedule
            SET provider_order_id=$1,provider_response=$2::jsonb,provider_status='Pending',
                user_provider_account_id=$3::uuid,user_provider_account_name=$4,
                status='started',updated_at=now()
          WHERE id=$5::uuid`,
        [String(providerOrderId), JSON.stringify(body), account.id, account.name, run.id],
      );
      return;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Provider dispatch failed.");
    }
  }

  if (busyCount > 0 && busyCount === orderedMappings.length) {
    throw new AllProvidersBusyError("All configured providers are busy for this link. Waiting for availability.");
  }
  throw new Error(failures.join(" | ") || "No configured provider accepted this run.");
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let count = 0; count < 10; count += 1) {
      const run = await claimRun();
      if (!run) break;
      try {
        await dispatch(run);
        logger.info({ runId: run.id }, "Organic run sent to provider");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider dispatch failed.";
        if (error instanceof AllProvidersBusyError) {
          await pool.query(
            `UPDATE lovable_legacy.organic_run_schedule
                SET status='pending',error_message=$1,retry_count=retry_count+1,
                    scheduled_at=GREATEST(scheduled_at,now() + interval '1 minute'),updated_at=now()
              WHERE id=$2::uuid AND provider_order_id IS NULL`,
            [message, run.id],
          );
          logger.info({ runId: run.id }, "All providers busy; organic run requeued");
          continue;
        }
        await pool.query(
          `UPDATE lovable_legacy.organic_run_schedule
              SET status='failed',error_message=$1,retry_count=retry_count+1,completed_at=now(),updated_at=now()
            WHERE id=$2::uuid AND provider_order_id IS NULL`,
          [message, run.id],
        );
        logger.warn({ runId: run.id, err: message }, "Organic run dispatch failed");
      }
    }
  } finally {
    running = false;
  }
}

export function startOrganicRunDispatcher(): void {
  void tick();
  setInterval(() => void tick(), 60_000).unref();
}