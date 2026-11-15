export function isOrderVisible(order: { status?: string }) {
  return order.status !== 'deleted';
}

export function isRefillOrder(order: { order_name?: string | null }) {
  return /\brefill\b/i.test(String(order?.order_name ?? ''));
}

/** Counts come from the same retained, non-deleted Reels shown on the dashboard. */
export function dashboardOrderCounts(orders: Array<{ status?: string; order_name?: string | null }>) {
  const visible = orders.filter(isOrderVisible);
  return {
    total: visible.length,
    processing: visible.filter((order) => ['pending', 'processing', 'started', 'partial'].includes(String(order.status))).length,
    completed: visible.filter((order) => order.status === 'completed').length,
    paused: visible.filter((order) => order.status === 'paused').length,
    refill: visible.filter(isRefillOrder).length,
  };
}

/** Pause is offered while the Reel still has unsent runs, even if some runs read 'partial'. */
export function canPauseOrder(status: string, hasUnsentRuns = true) {
  if (['pending', 'processing', 'started'].includes(status)) return true;
  return status === 'partial' && hasUnsentRuns;
}

export function hasUnsentRuns(order: any) {
  return (order?.items ?? []).some((i: any) => (i.runs ?? []).some((r: any) => r.status === 'pending'));
}

/**
 * Guarantee every scheduled run meets the provider minimum. The curve
 * generator can occasionally emit one run below the minimum; the server
 * rejects the whole order in that case, so merge such runs into the
 * largest run (totals stay exact, timing of remaining runs is unchanged).
 */
export function enforceRunMinimums<T extends { quantity_to_send: number; base_quantity?: number }>(
  runs: T[],
  providerMin = 1,
): T[] {
  const min = Math.max(1, providerMin || 1);
  const list = runs.filter((r) => r.quantity_to_send > 0).map((r) => ({ ...r }));
  if (list.length === 0) return list;
  const big = list.filter((r) => r.quantity_to_send >= min);
  const small = list.filter((r) => r.quantity_to_send < min);
  if (big.length === 0) {
    // Every run is below the minimum — merge all into a single run.
    const total = list.reduce((a, r) => a + r.quantity_to_send, 0);
    const merged = { ...list[0] };
    merged.quantity_to_send = total;
    merged.base_quantity = total;
    return [merged];
  }
  for (const s of small) {
    const idx = big.reduce((bi, x, i) => (x.quantity_to_send > big[bi].quantity_to_send ? i : bi), 0);
    big[idx].quantity_to_send += s.quantity_to_send;
    big[idx].base_quantity = big[idx].quantity_to_send;
  }
  return big;
}

/**
 * The minimum set per engagement on the My Bundles page is the floor the
 * customer asked for, so it wins over the built-in defaults and the optional
 * custom delivery minimums: with bundle min 1, likes/saves start with small
 * runs exactly like comments/reposts. When the bundle has no explicit minimum,
 * the provider service minimum and the built-in default still apply.
 */
export function resolveEffectiveMin(
  bundleMin: number | null | undefined,
  serviceMin: number | null | undefined,
  fallbackMin?: number | null,
): number {
  const bundle = Number(bundleMin) || 0;
  if (bundle > 0) return Math.max(1, Math.floor(bundle));
  return Math.max(Number(serviceMin) || 0, Number(fallbackMin) || 0, 1);
}

export async function loadAllEngagementOrders(client: any, userId: string, select: string) {
  const orders: any[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from('engagement_orders').select(select)
      .eq('user_id', userId).neq('status', 'deleted')
      .order('order_number', { ascending: false }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    orders.push(...page.filter(isOrderVisible));
    if (page.length < pageSize) return orders;
  }
}

export async function runOrderAction(client: any, orderIds: string[], action: 'pause' | 'resume' | 'delete') {
  const { data, error } = await client.functions.invoke('engagement-order-action', {
    body: { order_ids: orderIds, action },
  });
  if (error || data?.error) throw new Error(data?.error || error?.message || 'Action failed');
  return data;
}