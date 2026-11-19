export function isOrderVisible(order: { status?: string }) {
  return order.status !== 'deleted';
}

export function canPauseOrder(status: string) {
  return ['pending', 'processing', 'started'].includes(status);
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