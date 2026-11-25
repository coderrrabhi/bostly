export function engagementViewsAllowed(opts: {
  type: string; viewsTotal: number; viewsDelivered: number; itemTotal: number;
  alreadySentBase: number; runBase: number;
}): boolean {
  if (/views?$/i.test(opts.type)) return true;
  if (!(opts.viewsTotal > 0) || !(opts.itemTotal > 0) || !(opts.viewsDelivered > 0)) return false;
  const required = Math.min(opts.viewsTotal,
    ((opts.alreadySentBase + opts.runBase) / opts.itemTotal) * opts.viewsTotal);
  return Number.isFinite(required) && opts.viewsDelivered + 1e-9 >= required;
}

export function providerQuantityEligible(quantity: number, min?: number | null, max?: number | null): boolean {
  if (!Number.isFinite(quantity) || quantity < 1) return false;
  if (typeof min === 'number' && Number.isFinite(min) && quantity < min) return false;
  if (typeof max === 'number' && Number.isFinite(max) && max > 0 && quantity > max) return false;
  return true;
}

/** Current priority wins among providers that can accept this exact quantity. */
export function eligibleProviders<T extends { priority?: number; min_quantity?: number | null; max_quantity?: number | null }>(mappings: T[], quantity: number): T[] {
  return mappings.filter(m => providerQuantityEligible(quantity, m.min_quantity, m.max_quantity))
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}
/**
 * Explicit provider rejection text, or undefined when the reply is not a
 * rejection. Panels reply either {"error":"..."} or {"status":"fail","message":"..."};
 * both mean no order was created, so the same run can be retried safely.
 */
export function providerRejection(body: any): string | undefined {
  if (body?.error) return String(body.error);
  const orderId = body?.order ?? body?.order_id ?? body?.id;
  if (!orderId && /^(fail|failed|error)$/i.test(String(body?.status ?? ''))) {
    return String(body?.message ?? body?.msg ?? 'Provider rejected the order.');
  }
  return undefined;
}
