import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ExternalLink, Pause, Play, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RefillOrderDialog } from '@/components/engagement/RefillOrderDialog';
import { loadAllEngagementOrders, canPauseOrder, runOrderAction } from '@/lib/engagement-order-management';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export function orderSummary(order: any) {
  const items: any[] = order?.items ?? [];
  const views = items.filter(i => i.engagement_type === 'views').reduce((a, i) => a + Number(i.quantity || 0), 0);
  const times = items.flatMap(i => i.runs ?? []).map((r: any) => new Date(r.scheduled_at).getTime()).filter(Number.isFinite);
  const mins = times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 60000) : null;
  const fmt = (m: number) => m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
  const timeframe = mins == null ? null : fmt(mins);
  const left = times.length ? Math.max(0, Math.ceil((Math.max(...times) - Date.now()) / 60000)) : null;
  const remaining = left == null ? null : order?.status === 'completed' || left === 0 ? 'Done' : order?.status === 'paused' ? `${fmt(left)} (paused)` : fmt(left);
  return { views, timeframe, remaining };
}

export function DashboardEngagementOrders({ userId }: { userId?: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [refillId, setRefillId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: orders = [], isLoading, error } = useQuery({
    queryKey: ['dashboard-engagement-orders', userId], enabled: !!userId,
    queryFn: () => userId ? loadAllEngagementOrders(supabase, userId,
      'id,order_number,order_name,curve_name,link,status,created_at,items:engagement_order_items(engagement_type,quantity,runs:organic_run_schedule(scheduled_at))') : [],
    refetchInterval: 30000,
  });
  async function refresh() {
    await Promise.all(['dashboard-engagement-orders', 'engagement-orders', 'dashboard']
      .map(key => queryClient.invalidateQueries({ queryKey: [key] })));
  }
  async function action(id: string, kind: 'pause' | 'resume' | 'delete') {
    setBusy(true);
    try {
      const result = await runOrderAction(supabase, [id], kind);
      if (!result.updated) toast.info('No change: this order is no longer active.');
      else toast.success(kind === 'pause' ? 'Order paused' : kind === 'resume' ? 'Order resumed' : 'Order deleted');
      await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  }
  const visible = orders.filter(o => [o.order_name, o.order_number, o.curve_name, o.link]
    .some(value => String(value ?? '').toLowerCase().includes(search.trim().toLowerCase())));
  return <>
    <div className="px-5 py-3"><Input aria-label="Search dashboard orders" placeholder="Search order name or Reel link" value={search} onChange={e => setSearch(e.target.value)} /></div>
    <div className="max-h-[560px] overflow-y-auto">
      {isLoading ? <p className="p-5 text-sm text-muted-foreground">Loading orders…</p> : error ?
        <p className="p-5 text-sm text-destructive">{error instanceof Error ? error.message : 'Orders could not be loaded'}</p> :
        visible.length ? visible.map(order => <div key={order.id} className="border-t border-border px-5 py-4 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link to={`/engagement-orders/${order.order_number}`} className="min-w-0 flex-1 text-sm font-semibold text-foreground break-words [overflow-wrap:anywhere]">
              {order.order_name || `Order #${order.order_number}`}
            </Link>
            <Badge variant="secondary" className="capitalize">{order.status === 'completed' ? 'Complete' : order.status}</Badge>
          </div>
          {(() => { const s = orderSummary(order); return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Views: <b className="text-foreground">{s.views ? s.views.toLocaleString() : '—'}</b></span>
            <span>Delivery Timeframe: <b className="text-foreground">{s.timeframe ?? '—'}</b></span>
            <span>Time Left: <b className="text-foreground">{s.remaining ?? '—'}</b></span>
          </div>; })()}
          <p className="text-xs text-muted-foreground break-words">Curve: {order.curve_name || 'Not recorded (older order)'}</p>
          <a href={order.link} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1 text-xs text-primary break-all">
            <span>{order.link}</span><ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
          </a>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || !canPauseOrder(order.status)} onClick={() => action(order.id, 'pause')} title={canPauseOrder(order.status) ? 'Pause unsent runs' : 'No active runs to pause'}><Pause className="h-3.5 w-3.5 mr-1" />Pause</Button>
            {order.status === 'paused' && <Button size="sm" variant="outline" disabled={busy} onClick={() => action(order.id, 'resume')}><Play className="h-3.5 w-3.5 mr-1" />Resume</Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeleteId(order.id)}><Trash2 className="h-3.5 w-3.5 mr-1 text-destructive" />Delete</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setRefillId(order.id)}><RefreshCw className="h-3.5 w-3.5 mr-1" />Refill</Button>
          </div>
        </div>) : <p className="p-5 text-sm text-muted-foreground">No orders found</p>}
    </div>
    <RefillOrderDialog orderId={refillId} open={!!refillId} onOpenChange={open => { if (!open) setRefillId(null); }} onDone={() => { void refresh(); }} />
    <AlertDialog open={!!deleteId} onOpenChange={open => { if (!open) setDeleteId(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this order?</AlertDialogTitle>
        <AlertDialogDescription>Unsent runs will stop and this order will be hidden. Orders already sent to providers cannot be recalled.</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep order</AlertDialogCancel><AlertDialogAction onClick={() => { if (deleteId) void action(deleteId, 'delete'); setDeleteId(null); }}>Delete order</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}