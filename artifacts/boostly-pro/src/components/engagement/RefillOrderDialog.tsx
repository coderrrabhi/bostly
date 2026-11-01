import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { CurveSparkline } from '@/components/engagement/CurveSparkline';
import { scaleRunsToCurve, type PlainRun } from '@/lib/organic-extras';

interface Props {
  orderId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (orderNumber?: number) => void;
}

const ORDER_TYPES = ['views', 'likes', 'comments', 'shares', 'reposts', 'saves', 'followers'];

/**
 * Refill an existing engagement order on the same reel using the SAME delivery
 * curve: identical relative timing and per-run share, scaled to the new views.
 */
export function RefillOrderDialog({ orderId, open, onOpenChange, onDone }: Props) {
  const queryClient = useQueryClient();
  const [views, setViews] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['refill-order-source', orderId],
    enabled: open && !!orderId,
    staleTime: 0,
    queryFn: async () => {
      const { data: order, error: orderError } = await supabase
        .from('engagement_orders')
        .select('id, order_number, link, base_quantity, user_bundle_id, items:engagement_order_items(id, engagement_type, quantity, user_service_id, user_bundle_item_id, provider_mappings, custom_comments, runs:organic_run_schedule(scheduled_at, quantity_to_send, run_number))')
        .eq('id', orderId!)
        .single();
      if (orderError) throw orderError;
      if (!order?.user_bundle_id) throw new Error('This order has no bundle, so it cannot be refilled.');

      const { data: bundles } = await supabase
        .from('user_bundles')
        .select('id, user_bundle_items(id, engagement_type, user_service_id, user_bundle_item_providers(user_provider_account_id, provider_service_id, priority, enabled))')
        .eq('id', order.user_bundle_id);
      const { data: services } = await supabase
        .from('user_services')
        .select('id, user_provider_account_id, provider_service_id, min_quantity, max_quantity, is_active')
        .eq('is_active', true);
      return { order: order as any, bundle: (bundles as any[] | null)?.[0] ?? null, services: (services as any[]) ?? [] };
    },
  });

  const items: any[] = useMemo(() => {
    const list = (data?.order?.items ?? []) as any[];
    return [...list].sort((a, b) => ORDER_TYPES.indexOf(a.engagement_type) - ORDER_TYPES.indexOf(b.engagement_type));
  }, [data]);

  const originalViews = useMemo(() => {
    const v = items.find((i) => i.engagement_type === 'views');
    return Number(v?.quantity) || Number(data?.order?.base_quantity) || 0;
  }, [items, data]);

  useEffect(() => {
    if (open && originalViews) setViews(originalViews);
  }, [open, originalViews]);

  const limitsFor = (mappings: any[]) => {
    const matched = (data?.services ?? []).filter((s: any) =>
      mappings.some((m: any) => m.user_provider_account_id === s.user_provider_account_id && String(m.provider_service_id) === String(s.provider_service_id)),
    );
    const min = matched.length ? Math.min(...matched.map((s: any) => Number(s.min_quantity) || 1)) : 1;
    const max = matched.length ? Math.max(...matched.map((s: any) => Number(s.max_quantity) || 0)) : 0;
    return { min, max };
  };

  const plan = useMemo(() => {
    if (!items.length) return [];
    const factor = originalViews > 0 ? views / originalViews : 1;
    return items.map((item) => {
      const bundleItem = (data?.bundle?.user_bundle_items ?? []).find((b: any) => b.engagement_type === item.engagement_type);
      const current = (bundleItem?.user_bundle_item_providers ?? [])
        .filter((m: any) => m.enabled && m.provider_service_id)
        .sort((a: any, b: any) => (a.priority ?? 999) - (b.priority ?? 999));
      const stored = Array.isArray(item.provider_mappings) ? item.provider_mappings : [];
      const mappings = current.length ? current : stored;
      const { min, max } = limitsFor(mappings);
      const hasCustomComments = item.engagement_type === 'comments' && !!item.custom_comments;
      const raw = item.engagement_type === 'views'
        ? views
        : hasCustomComments ? Number(item.quantity) : Math.round(Number(item.quantity) * factor);
      const quantity = Math.max(min, raw);
      return { item, bundleItem, mappings, min, max, quantity };
    });
  }, [items, views, originalViews, data]);

  const viewsRuns: PlainRun[] = useMemo(() => {
    const v = items.find((i) => i.engagement_type === 'views') ?? items[0];
    return (v?.runs ?? []).map((r: any) => ({ scheduled_at: r.scheduled_at, quantity_to_send: Number(r.quantity_to_send) }));
  }, [items]);

  async function submit() {
    if (!data?.order) return;
    if (!views || views <= 0) return toast.error('Enter the views quantity for the refill');
    const missing = plan.filter((p) => !p.mappings.length || !p.bundleItem);
    if (missing.length === plan.length) return toast.error('No provider service is mapped for this bundle. Check My Bundles.');
    setSubmitting(true);
    try {
      const startAt = new Date(Date.now() + 5 * 60_000);
      const anchor = Math.min(
        ...plan.flatMap((p) => (p.item.runs ?? []).map((r: any) => new Date(r.scheduled_at).getTime())),
      );
      const engagements = plan
        .filter((p) => p.mappings.length && p.bundleItem && p.quantity > 0)
        .map((p) => {
          const original: PlainRun[] = (p.item.runs ?? []).map((r: any) => ({ scheduled_at: r.scheduled_at, quantity_to_send: Number(r.quantity_to_send) }));
          const runs = scaleRunsToCurve(original, p.quantity, startAt, p.min, p.max, Number.isFinite(anchor) ? anchor : undefined);
          return {
            type: p.item.engagement_type,
            quantity: p.quantity,
            user_service_id: p.bundleItem?.user_service_id ?? p.item.user_service_id ?? null,
            user_bundle_item_id: p.bundleItem?.id ?? p.item.user_bundle_item_id ?? null,
            provider_mappings: p.mappings.map((m: any) => ({
              user_provider_account_id: m.user_provider_account_id,
              provider_service_id: String(m.provider_service_id),
              priority: m.priority ?? 1,
            })),
            custom_comments: p.item.custom_comments || undefined,
            variance_percent: 50,
            scheduled_runs: runs.map((r) => ({
              scheduled_at: r.scheduled_at,
              quantity_to_send: r.quantity_to_send,
              base_quantity: r.quantity_to_send,
              variance_applied: 0,
              peak_multiplier: 1,
            })),
          };
        });

      const { data: res, error: invokeError } = await supabase.functions.invoke('process-engagement-order', {
        body: {
          user_bundle_id: data.order.user_bundle_id,
          bundle_id: null,
          link: data.order.link,
          base_quantity: views,
          is_organic_mode: true,
          notes: `Refill of #${data.order.order_number}`,
          engagements,
        },
      });
      if (invokeError || (res as any)?.error) throw new Error((res as any)?.error || invokeError?.message || 'Refill failed');
      toast.success(`Refill placed — Order #${(res as any)?.order_number ?? ''} with the same curve`);
      queryClient.invalidateQueries({ queryKey: ['engagement-orders'] });
      onOpenChange(false);
      onDone?.((res as any)?.order_number);
    } catch (e: any) {
      toast.error(e?.message || 'Refill failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><RefreshCw className="w-4 h-4 text-primary" /> Refill with same curve</DialogTitle>
          <DialogDescription>
            {data?.order ? <>Order #{data.order.order_number} · same reel, same delivery curve, starts in 5 minutes.</> : 'Loading order…'}
          </DialogDescription>
        </DialogHeader>

        {isLoading && <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {data?.order && (
          <div className="space-y-4">
            <p className="text-xs font-mono truncate text-muted-foreground">{data.order.link}</p>
            {viewsRuns.length > 0 && (
              <div className="rounded-xl border border-border bg-secondary/40 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Curve (reused)</p>
                <CurveSparkline runs={viewsRuns} />
              </div>
            )}
            <div>
              <Label>Views for refill</Label>
              <Input type="number" min={1} className="mt-2" value={views || ''} onChange={(e) => setViews(Number(e.target.value) || 0)} />
              <p className="text-[11px] text-muted-foreground mt-1">Other engagement changes by the same percentage as the original order.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {plan.map((p) => (
                <div key={p.item.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs">
                  <span className="capitalize text-muted-foreground">{p.item.engagement_type}</span>
                  <b className={!p.mappings.length ? 'text-destructive' : ''}>{p.mappings.length ? p.quantity.toLocaleString() : 'not mapped'}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !data?.order}>
            {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Placing…</> : 'Refill now'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
