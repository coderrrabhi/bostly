export type FailoverBlockReason =
  | "views-complete"
  | "next-run-due"
  | "partial-delivery"
  | "unresolved-provider-order"
  | "not-a-safe-failure";

const TERMINAL_FAILURES = new Set(["failed", "failure", "error", "cancelled", "canceled", "refunded"]);
const ACTIVE_STATUSES = new Set(["pending", "started", "processing", "in progress", "in_progress"]);

const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase();

/** A requeued run may dispatch only inside its original curve window. */
export function failoverWindowBlock({
  viewsComplete,
  nextRunScheduledAt,
  now,
}: {
  viewsComplete: boolean;
  nextRunScheduledAt?: string | Date | null;
  now: string | Date;
}): Extract<FailoverBlockReason, "views-complete" | "next-run-due"> | null {
  if (viewsComplete) return "views-complete";
  if (nextRunScheduledAt) {
    const next = new Date(nextRunScheduledAt).getTime();
    const current = new Date(now).getTime();
    if (Number.isFinite(next) && Number.isFinite(current) && current >= next) return "next-run-due";
  }
  return null;
}

/**
 * Additional guard around the provider-specific zero-delivery checks. Active,
 * ambiguous and partial orders are never replaced; a confirmed failed or
 * cancelled zero-delivery order can fail over only before the next run and
 * before all ordered views have completed.
 */
export function failedRunFailoverBlock({
  status,
  providerStatus,
  providerOrderId,
  quantityToSend,
  providerRemains,
  viewsComplete,
  nextRunScheduledAt,
  now,
}: {
  status?: unknown;
  providerStatus?: unknown;
  providerOrderId?: unknown;
  quantityToSend: number;
  providerRemains?: number | null;
  viewsComplete: boolean;
  nextRunScheduledAt?: string | Date | null;
  now: string | Date;
}): FailoverBlockReason | null {
  const windowBlock = failoverWindowBlock({ viewsComplete, nextRunScheduledAt, now });
  if (windowBlock) return windowBlock;

  if (typeof providerRemains === "number" && Number.isFinite(providerRemains)) {
    if (Math.max(0, quantityToSend - providerRemains) > 0) return "partial-delivery";
  }

  const local = normalized(status);
  const provider = normalized(providerStatus);
  const hasProviderOrder = providerOrderId !== null && providerOrderId !== undefined && String(providerOrderId).trim() !== "";
  if (ACTIVE_STATUSES.has(provider) || (hasProviderOrder && ACTIVE_STATUSES.has(local))) return "unresolved-provider-order";
  if (hasProviderOrder && !TERMINAL_FAILURES.has(provider)) return "unresolved-provider-order";

  if (TERMINAL_FAILURES.has(provider)) return null;
  if (!hasProviderOrder && local === "failed") return null;
  return "not-a-safe-failure";
}
