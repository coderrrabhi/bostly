export const DEFAULT_SPEEDUP_TICKET_DELAY_MINUTES = 3;

/** Customer-facing delay is intentionally bounded to the requested 2–5 minutes. */
export function speedupTicketDelayMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SPEEDUP_TICKET_DELAY_MINUTES;
  return Math.max(2, Math.min(5, Math.floor(parsed)));
}

export type SpeedupTicketRun = {
  providerOrderId?: string | null;
  status?: string | null;
  startedAt?: string | Date | null;
  quantityToSend: number;
  providerRemains?: number | null;
  speedupTicketedAt?: string | Date | null;
  now?: string | Date;
};

/**
 * A ticket is safe even when the provider's live count is unavailable: it does
 * not resend or cancel the paid order. Any confirmed delivered quantity,
 * terminal state, or earlier ticket makes the run ineligible.
 */
export function speedupTicketEligible(run: SpeedupTicketRun, delayMinutes = DEFAULT_SPEEDUP_TICKET_DELAY_MINUTES): boolean {
  if (!String(run.providerOrderId ?? "").trim() || run.speedupTicketedAt) return false;
  if (!["started", "processing"].includes(String(run.status ?? "").toLowerCase())) return false;
  if (typeof run.providerRemains === "number" && Number.isFinite(run.providerRemains)
    && run.providerRemains < Math.max(0, run.quantityToSend)) return false;
  const started = new Date(run.startedAt ?? "").getTime();
  const now = new Date(run.now ?? new Date()).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(now)) return false;
  return now - started >= speedupTicketDelayMinutes(delayMinutes) * 60_000;
}

export function speedupTicketMessage(providerOrderIds: string[]): string {
  const ids = [...new Set(providerOrderIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) throw new Error("At least one provider order ID is required for a speed-up ticket.");
  return `${ids.join(",")} -- speed up this order and complete quickly. These orders are very urgent; please complete all orders asap.`;
}
