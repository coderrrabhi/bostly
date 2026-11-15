import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ExternalLink, Pause, Play, Trash2, RefreshCw, Eye, Clock3, TrendingUp, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RefillOrderDialog } from '@/components/engagement/RefillOrderDialog';
import { loadAllEngagementOrders, canPauseOrder, hasUnsentRuns, runOrderAction } from '@/lib/engagement-order-management';
import { reelRiskFromItems } from '@/lib/reel-risk-score';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const DASHBOARD_ORDERS_SELECT = 'id,order_number,order_name,curve_name,link,status,created_at,items:engagement_order_items(engagement_type,quantity,runs:organic_run_schedule(scheduled_at,status,quantity_to_send,started_at,provider_order_id,provider_remains))';

export function useDashboardEngagementOrders(userId?: string) {
  return useQuery({
    queryKey: ['dashboard-engagement-orders', userId], enabled: !!userId,
    queryFn: () => userId ? loadAllEngagementOrders(supabase, userId, DASHBOARD_ORDERS_SELECT) : [],
    refetchInterval: 30000,
  });
}

export function orderSummary(order: any) {
  const items: any[] = order?.items ?? [];
  const views = items.filter(i => i.engagement_type === 'views').reduce((a, i) => a + Number(i.quantity || 0), 0);
  const times = items.flatMap(i => i.runs ?? []).map((r: any) => new Date(r.scheduled_at).getTime()).filter(Number.isFinite);
  const mins = times.length ? Math.round((Math.max(...times) - Math.min(...times)) / 60000) : null;
  const fmt = (m: number) => m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
  const timeframe = mins == null ? null : fmt(mins);
  const left = times.length ? Math.max(0, Math.ceil((Math.max(...times) - Date.now()) / 60000)) : null;
  const remaining = left == null ? null : order?.status === 'completed' ? 'Done'
    : order?.status === 'paused' ? `${fmt(left)} (paused)` : left === 0 ? 'Finishing…' : fmt(left);
  return { views, timeframe, remaining };
}

function statusPresentation(status?: string) {
  const value = String(status ?? 'processing').toLowerCase();
  if (value === 'completed') return { label: 'Complete', accent: '#059669', soft: '#ECFDF5' };
  if (value === 'paused') return { label: 'Paused', accent: '#B45309', soft: '#FFFBEB' };
  if (value === 'failed' || value === 'cancelled' || value === 'canceled') return { label: value === 'failed' ? 'Failed' : 'Cancelled', accent: '#DC2626', soft: '#FEF2F2' };
  return { label: 'Processing', accent: '#2563EB', soft: '#EFF6FF' };
}

export function DashboardEngagementOrders({ userId }: { userId?: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [refillId, setRefillId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { data: orders = [], isLoading, error } = useDashboardEngagementOrders(userId);

  async function refresh() {
    await Promise.all(['dashboard-engagement-orders', 'engagement-orders', 'dashboard']
      .map(key => queryClient.invalidateQueries({ queryKey: [key] })));
  }
  async function action(id: string, kind: 'pause' | 'resume' | 'delete') {
    setBusy(true);
    try {
      const result = await runOrderAction(supabase, [id], kind);
      if (!result.updated) toast.info('No change: this order is no longer active.');
      else toast.success(kind === 'pause' ? 'Only this Reel was paused' : kind === 'resume' ? 'Reel resumed' : 'Order deleted');
      await refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  }

  const visible = orders.filter(o => [o.order_name, o.order_number, o.curve_name, o.link]
    .some(value => String(value ?? '').toLowerCase().includes(search.trim().toLowerCase())));

  return <>
    <div className="px-5 py-4" style={{ background: '#FBFDFF' }}>
      <Input aria-label="Search dashboard orders" placeholder="Search order name or Reel link" value={search} onChange={e => setSearch(e.target.value)} className="h-10 rounded-xl bg-white" />
    </div>
    <div className="max-h-[760px] overflow-y-auto px-4 sm:px-5 pb-5 space-y-4">
      {isLoading ? <p className="p-5 text-sm text-muted-foreground">Loading orders…</p> : error ?
        <p className="p-5 text-sm text-destructive">{error instanceof Error ? error.message : 'Orders could not be loaded'}</p> :
        visible.length ? visible.map(order => {
          const summary = orderSummary(order);
          const risk = reelRiskFromItems(order.items || []);
          const status = statusPresentation(order.status);
          const riskColor = risk.score >= 50 ? '#DC2626' : risk.score >= 25 ? '#B45309' : '#059669';
          const riskSoft = risk.score >= 50 ? '#FEF2F2' : risk.score >= 25 ? '#FFFBEB' : '#ECFDF5';
          const pauseAvailable = canPauseOrder(order.status, hasUnsentRuns(order));
          return <article key={order.id} className="rounded-2xl overflow-hidden bg-white" style={{ border: `1px solid ${status.accent}30`, borderLeft: `4px solid ${status.accent}`, boxShadow: '0 8px 24px rgba(15,23,42,.055)' }}>
            <div className="px-4 sm:px-5 pt-4 pb-3 flex flex-wrap items-start justify-between gap-3" style={{ background: `linear-gradient(135deg,${status.soft} 0%,#FFFFFF 72%)` }}>
              <div className="min-w-0 flex-1">
                <Link to={`/engagement-orders/${order.order_number}`} className="block text-[15px] font-bold break-words [overflow-wrap:anywhere]" style={{ color: '#0F172A' }}>
                  {order.order_name || `Order #${order.order_number}`}
                </Link>
                <p className="text-[11px] mt-1 font-medium" style={{ color: '#94A3B8' }}>Engagement Order #{order.order_number}</p>
              </div>
              <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: status.soft, color: status.accent, border: `1px solid ${status.accent}30` }}>{status.label}</Badge>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 px-4 sm:px-5 py-3">
              <div className="rounded-xl p-3 min-w-0" style={{ background: '#EFF6FF', border: '1px solid #DBEAFE' }}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#2563EB' }}><Eye className="w-3.5 h-3.5" /> Views</div>
                <p className="text-[17px] font-extrabold mt-1 tabular-nums" style={{ color: '#1E3A8A' }}>{summary.views ? summary.views.toLocaleString() : '—'}</p>
              </div>
              <div className="rounded-xl p-3 min-w-0" style={{ background: '#F5F3FF', border: '1px solid #EDE9FE' }}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#7C3AED' }}><TrendingUp className="w-3.5 h-3.5" /> Curve</div>
                <p className="text-[12px] font-bold mt-1 break-words" style={{ color: '#5B21B6' }}>{order.curve_name || 'Not recorded (older order)'}</p>
              </div>
              <div className="rounded-xl p-3 min-w-0" style={{ background: '#F0FDFA', border: '1px solid #CCFBF1' }}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#0F766E' }}><Clock3 className="w-3.5 h-3.5" /> Delivery Timeframe</div>
                <p className="text-[14px] font-extrabold mt-1" style={{ color: '#115E59' }}>{summary.timeframe ?? '—'}</p>
                <p className="text-[10px] mt-0.5" style={{ color: '#0F766E' }}>Time left: <b>{summary.remaining ?? '—'}</b></p>
              </div>
              <div className="rounded-xl p-3 min-w-0" style={{ background: riskSoft, border: `1px solid ${riskColor}25` }} title="Independent pattern heuristic, not Instagram's or Whop's official verdict">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: riskColor }}><ShieldAlert className="w-3.5 h-3.5" /> Botting Score</div>
                <p className="text-[16px] font-extrabold mt-1 tabular-nums" style={{ color: riskColor }}>{risk.score}/100 <span className="text-[10px] font-bold">· {risk.level}</span></p>
              </div>
            </div>

            <div className="px-4 sm:px-5 pb-3">
              <a href={order.link} target="_blank" rel="noopener noreferrer" className="flex items-start gap-1.5 text-[11px] font-medium break-all hover:underline" style={{ color: '#2563EB' }}>
                <span>{order.link}</span><ExternalLink className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              </a>
            </div>

            <div className="flex flex-wrap gap-2 px-4 sm:px-5 py-3" style={{ borderTop: '1px solid #F1F5F9', background: '#FBFDFF' }}>
              {order.status === 'paused' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void action(order.id, 'resume')} className="rounded-lg font-semibold" style={{ background: '#ECFDF5', borderColor: '#A7F3D0', color: '#047857' }}><Play className="h-3.5 w-3.5 mr-1.5" />Resume</Button>
                : <Button size="sm" variant="outline" disabled={busy || !pauseAvailable} onClick={() => void action(order.id, 'pause')} title={pauseAvailable ? 'Pause only this Reel’s unsent runs' : 'No active runs to pause'} className="rounded-lg font-semibold" style={{ background: '#FFFBEB', borderColor: '#FDE68A', color: '#B45309' }}><Pause className="h-3.5 w-3.5 mr-1.5" />Pause</Button>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeleteId(order.id)} className="rounded-lg font-semibold" style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#DC2626' }}><Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRefillId(order.id)} className="rounded-lg font-semibold" style={{ background: '#F5F3FF', borderColor: '#DDD6FE', color: '#7C3AED' }}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refill</Button>
            </div>
          </article>;
        }) : <p className="p-8 text-center text-sm text-muted-foreground">No orders found</p>}
    </div>
    <RefillOrderDialog orderId={refillId} open={!!refillId} onOpenChange={open => { if (!open) setRefillId(null); }} onDone={() => { void refresh(); }} />
    <AlertDialog open={!!deleteId} onOpenChange={open => { if (!open) setDeleteId(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this order?</AlertDialogTitle>
        <AlertDialogDescription>Unsent runs will stop and this order will be hidden. Orders already sent to providers cannot be recalled.</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep order</AlertDialogCancel><AlertDialogAction onClick={() => { if (deleteId) void action(deleteId, 'delete'); setDeleteId(null); }}>Delete order</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}
