export function isOrderVisible(order: { status?: string }) {
  return order.status !== 'deleted';
}

export function canPauseOrder(status: string) {
  return ['pending', 'processing', 'started'].includes(status);
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