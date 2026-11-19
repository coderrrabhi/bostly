export function isCommentEngagement(type: unknown): boolean {
  return String(type ?? "").toLowerCase().includes("comment");
}

export function commentLines(value: unknown): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Reject incomplete input before saving an order; never invent or repeat customer text. */
export function validateCommentOrder(type: unknown, text: unknown, quantity: number): void {
  if (!isCommentEngagement(type)) return;
  if (commentLines(text).length !== quantity) {
    throw new Error(`Please supply exactly ${quantity} non-empty comment lines for this comment order.`);
  }
}

export function runCommentText(run: {
  engagement_type?: unknown;
  quantity_to_send: number;
  custom_comments?: unknown;
  item_comments?: unknown;
  comment_offset?: unknown;
}): string | undefined {
  if (!isCommentEngagement(run.engagement_type)) return undefined;
  const quantity = Number(run.quantity_to_send);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Invalid comment run quantity.");
  const own = commentLines(run.custom_comments);
  if (own.length === quantity) return own.join("\n");
  // Older schedules copied the entire item text into every run. Slice the
  // original pool by preceding run quantities instead of resending all lines.
  const pool = commentLines(run.item_comments);
  const offset = Number(run.comment_offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid comment run offset.");
  const selected = pool.slice(offset, offset + quantity);
  if (selected.length !== quantity) {
    throw new Error(`Comment text needs attention: run requires ${quantity} lines, but only ${selected.length} are available.`);
  }
  return selected.join("\n");
}

export function commentRetryMinutes(retryCount: number): number {
  return Math.min(60, 2 * 2 ** Math.min(5, Math.max(0, retryCount)));
}
export const MAX_COMMENT_RECREATES = 20;

/**
 * Providers sometimes accept a comment order and later cancel/refund it with
 * nothing delivered. Such a run is safe to recreate with the same text and
 * quantity: the earlier provider order is closed and was not charged.
 */
export function shouldRecreateCancelledComment(run: {
  engagement_type?: unknown; status: string; quantity_to_send: number;
  remains?: unknown; charge?: unknown; retry_count?: unknown;
}): boolean {
  if (!isCommentEngagement(run.engagement_type)) return false;
  const s = String(run.status ?? "").toLowerCase();
  if (!(s.startsWith("cancel") || s === "refunded")) return false;
  if (Number(run.retry_count ?? 0) >= MAX_COMMENT_RECREATES) return false;
  // Recreate only when the provider's counters prove nothing was delivered.
  // A finite remains below the quantity means partial delivery — recreating
  // would post the same comments twice. A zero charge only counts when the
  // panel did not report remains at all.
  const hasRemains = run.remains !== null && run.remains !== undefined && run.remains !== ""
    && Number.isFinite(Number(run.remains));
  if (hasRemains) return Number(run.remains) >= Number(run.quantity_to_send);
  const hasCharge = run.charge !== null && run.charge !== undefined && run.charge !== ""
    && Number.isFinite(Number(run.charge));
  return hasCharge && Number(run.charge) === 0;
}
