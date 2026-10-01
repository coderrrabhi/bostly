import { useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageMeta } from '@/components/seo/PageMeta';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Rocket, Upload, Package, Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { NoBundleBanner } from '@/components/NoBundleBanner';
import { coordinateEngagementSchedules, generateOrganicSchedule } from '@/lib/organic-algorithm';

interface Row {
  id: string;
  link: string;
  base_quantity: number;
  timeframe: string;
  types: Record<string, boolean>;
  qty: Record<string, number>; // per-type quantity (custom override)
}

const ALL_TYPES = ['views', 'likes', 'shares', 'reposts', 'comments', 'saves', 'followers'] as const;
const DEFAULT_TYPES: Record<string, boolean> = { views: true, likes: false, shares: false, reposts: false, comments: false, saves: false, followers: false };
const TIMEFRAMES = ['Under 6 hours', 'Under 12 hours', 'Under 24 hours', 'Under 48 hours', 'Under 72 hours'];
const CUSTOM = 'Custom';
const isCustom = (v: string) => !TIMEFRAMES.includes(v);
const RATIOS: Record<string, number> = { views: 1, likes: 0.031, shares: 0.013, reposts: 0.010, comments: 0.008, saves: 0.012, followers: 0.02 };

function parseLinks(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map(l => l.trim())
    .filter(l => /^https?:\/\/\S+/i.test(l));
}

function defaultQty(base: number): Record<string, number> {
  const q: Record<string, number> = {};
  ALL_TYPES.forEach(t => { q[t] = Math.round(base * (RATIOS[t] || 0)); });
  return q;
}

function newRow(link: string, base: number, tf: string, allowedTypes?: string[]): Row {
  const types: Record<string, boolean> = { ...DEFAULT_TYPES };
  if (allowedTypes && allowedTypes.length) {
    ALL_TYPES.forEach(t => { types[t] = false; });
    allowedTypes.forEach(t => { if (t in types) types[t] = true; });
  }
  return {
    id: crypto.randomUUID(),
    link,
    base_quantity: base,
    timeframe: tf,
    types,
    qty: defaultQty(base),
  };
}

export default function MassOrder() {
  const { user } = useAuth();
  const [raw, setRaw] = useState('');
  const [baseQty, setBaseQty] = useState(1000);
  const [defaultsQty, setDefaultsQty] = useState<Record<string, number>>(() => defaultQty(1000));
  const [timeframe, setTimeframe] = useState('Under 24 hours');
  const [campaign, setCampaign] = useState('');
  const [bundleId, setBundleId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: bundles = [] } = useQuery({
    queryKey: ['mass-order-bundles', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_bundles')
        .select('id, name, platform, user_bundle_items(id, engagement_type, price_per_k, user_service_id, user_bundle_item_providers(user_provider_account_id, provider_service_id, priority, enabled))')
        .order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: userServices = [] } = useQuery({
    queryKey: ['mass-order-user-services', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_services')
        .select('user_provider_account_id, provider_service_id, min_quantity, is_active')
        .eq('is_active', true);
      return data || [];
    },
  });

  const selectedBundle: any = useMemo(
    () => bundles.find((b: any) => b.id === bundleId),
    [bundles, bundleId]
  );
  const allowedTypes: string[] = useMemo(() => {
    const items = selectedBundle?.user_bundle_items || [];
    const set = new Set<string>(items.map((i: any) => i.engagement_type).filter(Boolean));
    return ALL_TYPES.filter(t => set.has(t));
  }, [selectedBundle]);
  const priceMap: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {};
    (selectedBundle?.user_bundle_items || []).forEach((i: any) => {
      if (i.engagement_type) m[i.engagement_type] = Number(i.price_per_k) || 0;
    });
    return m;
  }, [selectedBundle]);

  function recomputeDefaults(base: number) {
    setBaseQty(base);
    setDefaultsQty(defaultQty(base));
  }

  const totalValid = useMemo(() => rows.length, [rows]);
  const perRowCost = (r: Row) => {
    let cost = 0;
    for (const k of Object.keys(r.types)) {
      if (!r.types[k]) continue;
      const q = r.qty[k] ?? Math.round(r.base_quantity * (RATIOS[k] || 0));
      const priceK = priceMap[k] ?? 0.1;
      cost += (q / 1000) * priceK;
    }
    return cost;
  };
  const grandTotal = useMemo(() => rows.reduce((s, r) => s + perRowCost(r), 0), [rows]);

  function preview() {
    const links = parseLinks(raw);
    if (!links.length) return toast.error('No valid links found');
    const typesToUse = allowedTypes.length ? allowedTypes : ['views'];
    setRows(links.map(l => {
      const types: Record<string, boolean> = {};
      ALL_TYPES.forEach(t => { types[t] = false; });
      typesToUse.forEach(t => { types[t] = true; });
      const qty: Record<string, number> = { ...defaultQty(baseQty), ...defaultsQty };
      return {
        id: crypto.randomUUID(),
        link: l,
        base_quantity: baseQty,
        timeframe,
        types,
        qty,
      };
    }));
    toast.success(`${links.length} link(s) ready`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const firstCol = text.split(/\r?\n/).map(l => l.split(/[,\t;]/)[0]).join('\n');
      setRaw(firstCol);
      toast.success('File loaded');
    };
    reader.readAsText(f);
  }

  function saveEdit(r: Row) {
    setRows(prev => prev.map(x => x.id === r.id ? r : x));
    setEditing(null);
  }

  function timeframeToHours(tf: string): number {
    const m = String(tf).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 24;
  }

  async function submit() {
    if (!bundleId) return toast.error('Please select a bundle first');
    if (!rows.length) return toast.error('No rows to submit');
    const items = selectedBundle?.user_bundle_items || [];
    const serviceMap: Record<string, { service_id: string | null; price: number }> = {};
    items.forEach((i: any) => {
      if (i.engagement_type) serviceMap[i.engagement_type] = {
        service_id: i.service_id ?? null,
        price: Number(i.price_per_k) || 0,
      };
    });

    setSubmitting(true);
    try {
      let ok = 0, fail = 0;
      let firstError = '';
      for (const r of rows) {
        const hours = timeframeToHours(r.timeframe);
        const preparedEngagements = Object.keys(r.types)
          .filter((t) => r.types[t])
          .map((t) => {
            const q = r.qty[t] ?? Math.round(r.base_quantity * (RATIOS[t] || 0));
            const bundleItem = items.find((item: any) => item.engagement_type === t);
            const providerMappings = (bundleItem?.user_bundle_item_providers || [])
              .filter((mapping: any) => mapping.enabled && mapping.provider_service_id)
              .sort((a: any, b: any) => (a.priority ?? 999) - (b.priority ?? 999));
            const mappedMinimums = providerMappings
              .map((mapping: any) => {
                const service = (userServices as any[]).find((candidate: any) =>
                  candidate.user_provider_account_id === mapping.user_provider_account_id
                  && String(candidate.provider_service_id) === String(mapping.provider_service_id)
                );
                return Number(service?.min_quantity) || 0;
              })
              .filter((minimum: number) => minimum > 0);
            const providerMinimum = mappedMinimums.length ? Math.min(...mappedMinimums) : undefined;
            const organicSchedule = generateOrganicSchedule(
              t,
              q,
              15,
              false,
              new Date(Date.now() + 5 * 60_000),
              providerMinimum,
              hours,
            );
            const priceK = serviceMap[t]?.price ?? 0;
            return {
              type: t,
              organicSchedule,
              quantity: q,
              price: (q / 1000) * priceK,
              service_id: serviceMap[t]?.service_id ?? null,
              user_service_id: bundleItem?.user_service_id ?? null,
              user_bundle_item_id: bundleItem?.id ?? null,
              provider_mappings: providerMappings.map((mapping: any) => ({
                user_provider_account_id: mapping.user_provider_account_id,
                provider_service_id: mapping.provider_service_id,
                priority: mapping.priority,
              })),
              time_limit_hours: hours,
              variance_percent: 15,
              peak_hours_enabled: false,
            };
          })
          .filter((e) => e.quantity > 0);
        const coordinatedSchedules = coordinateEngagementSchedules(
          preparedEngagements.map((engagement) => engagement.organicSchedule),
        );
        const scheduleByType = new Map(
          coordinatedSchedules.map((schedule) => [schedule.engagementType, schedule]),
        );
        const engagements = preparedEngagements.map(({ organicSchedule: _organicSchedule, ...engagement }) => ({
          ...engagement,
          scheduled_runs: (scheduleByType.get(engagement.type)?.runs ?? []).map((run) => ({
            scheduled_at: run.scheduledAt.toISOString(),
            quantity_to_send: run.quantity,
            base_quantity: run.baseQuantity,
            variance_applied: run.varianceApplied,
            peak_multiplier: run.peakMultiplier,
          })),
        }));

        if (!engagements.length) { fail++; continue; }
        const missingMapping = engagements.find((engagement) => engagement.provider_mappings.length === 0);
        if (missingMapping) {
          firstError ||= `${missingMapping.type} has no provider service mapped. Configure it in My Bundles.`;
          fail++;
          continue;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        const { data, error } = await supabase.functions.invoke('process-engagement-order', {
          body: {
            user_id: user!.id,
            user_bundle_id: bundleId,
            bundle_id: null,
            link: r.link,
            base_quantity: r.base_quantity,
            total_price: perRowCost(r),
            is_organic_mode: true,
            notes: campaign ? `Mass Order: ${campaign}` : 'Mass Order',
            engagements,
          },
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        });
        if (error || (data as any)?.error) {
          const message = (data as any)?.error || error?.message || 'Order failed';
          console.error('Mass order row failed:', message, r.link);
          firstError ||= message;
          fail++;
        } else ok++;
      }
      toast[ok ? 'success' : 'error'](`Submitted ${ok}/${rows.length} orders${fail ? ` (${fail} failed)` : ''}`);
      if (firstError) toast.error(firstError);
      if (ok) { setRows([]); setRaw(''); setCampaign(''); }
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSubmitting(false); }
  }

  const showBundleBanner = bundles.length === 0;

  return (
    <DashboardLayout>
      <PageMeta title="Mass Order — Bulk Engagement" description="Bulk engagement orders across multiple links." canonicalPath="/mass-order" noIndex />

      <div className="max-w-6xl mx-auto space-y-6">
        {showBundleBanner && <NoBundleBanner message="To submit bulk orders, first add your provider and create a bundle. The form will remain visible below, but submissions will be blocked until then." />}
        {/* Header */}
        <div className="glass-card p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-luxury)' }}>
              <Rocket className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Mass Order <span className="text-muted-foreground font-normal">— Bulk Engagement</span></h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                Order multiple links at once. Paste them or upload a CSV/TXT file, customize each link, submit in a batch, and track everything in history.
              </p>
            </div>
          </div>
        </div>

        {/* Bundle + Campaign */}
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Your Bundle</h2>
          </div>
          <select
            className="w-full h-12 px-4 rounded-xl bg-secondary border border-border text-foreground"
            value={bundleId}
            onChange={e => setBundleId(e.target.value)}
          >
            <option value="">— Select bundle —</option>
            {bundles.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.platform} • {b.user_bundle_items?.length || 0} items)
              </option>
            ))}
          </select>
          {bundles.length === 0 && (
            <p className="text-xs text-warning">First create a bundle in <a href="/my-bundles" className="underline">My Bundles</a>.</p>
          )}

          <div>
            <Label>Campaign Name (optional)</Label>
            <Input className="input-3d mt-2 h-12" placeholder="new campaign" value={campaign} onChange={e => setCampaign(e.target.value)} />
          </div>
        </div>

        {/* Defaults */}
        <div className="glass-card p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Default Base Quantity (Views)</Label>
              <Input
                type="number"
                className="input-3d mt-2 h-12"
                value={baseQty}
                onChange={e => recomputeDefaults(Number(e.target.value) || 0)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Changing this auto-fills other types using standard ratios. You can override each below.
              </p>
            </div>
            <div>
              <Label>Default Timeframe</Label>
              <div className="flex gap-2 mt-2">
                <select
                  className="flex-1 h-12 px-4 rounded-xl bg-secondary border border-border text-foreground"
                  value={isCustom(timeframe) ? CUSTOM : timeframe}
                  onChange={e => setTimeframe(e.target.value === CUSTOM ? 'Under 1 hours' : e.target.value)}
                >
                  {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
                  <option value={CUSTOM}>Custom…</option>
                </select>
                {isCustom(timeframe) && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      className="input-3d h-12 w-24"
                      value={parseInt(timeframe.replace(/\D/g, '')) || 1}
                      onChange={e => setTimeframe(`Under ${Math.max(1, Number(e.target.value) || 1)} hours`)}
                    />
                    <span className="text-xs text-muted-foreground">hours</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Per-type default quantities from selected bundle */}
          {allowedTypes.length > 0 && (
            <div className="pt-2 border-t border-border">
              <Label>Default Quantity Per Engagement Type</Label>
              <p className="text-[11px] text-muted-foreground mt-1">
                Every type in your selected bundle. Set the default quantity applied to each new link.
              </p>
              <div className="mt-3 grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                {allowedTypes.map(t => (
                  <div key={t} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border bg-secondary/40">
                    <span className="capitalize text-sm font-medium min-w-[80px]">{t}</span>
                    <Input
                      type="number"
                      min={0}
                      className="input-3d h-9 flex-1"
                      value={defaultsQty[t] ?? 0}
                      onChange={e => setDefaultsQty({ ...defaultsQty, [t]: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">Defaults apply only to new links. Edit existing rows to override per-link values.</p>
        </div>

        {/* Links input */}
        <div className="glass-card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">🔗 Links</h2>
            <label className="btn-glass px-3 py-2 text-xs cursor-pointer flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" /> Upload CSV / TXT
              <input type="file" accept=".csv,.txt" className="hidden" onChange={onFile} />
            </label>
          </div>
          <Textarea
            rows={7}
            className="input-3d font-mono text-[13px]"
            placeholder={`One link per line.\nhttps://instagram.com/p/abc\nhttps://instagram.com/p/xyz\n\nOr upload a CSV (first column = link).`}
            value={raw}
            onChange={e => setRaw(e.target.value)}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{parseLinks(raw).length} valid link(s)</span>
            <Button onClick={preview} className="btn-3d h-10 px-5">Preview</Button>
          </div>
        </div>

        {/* Preview */}
        {rows.length > 0 && (
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Preview ({rows.length})</h2>
              <span className="px-3 py-1.5 rounded-lg bg-primary/15 text-primary text-sm font-medium">
                {rows.length} link(s)
              </span>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              {rows.map(r => {
                const activeTypes = Object.entries(r.types).filter(([, v]) => v).map(([k]) => k);
                return (
                  <div key={r.id} className="rounded-xl border border-border bg-secondary/40 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="lux-mono text-[9px] text-muted-foreground">LINK</p>
                        <p className="text-[12px] font-mono truncate text-foreground">{r.link}</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setEditing(r)} className="text-muted-foreground hover:text-primary p-1"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setRows(rows.filter(x => x.id !== r.id))} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                      {activeTypes.map(t => (
                        <span key={t} className="text-foreground">
                          <span className="capitalize text-muted-foreground">{t}:</span>{' '}
                          <b>{(r.qty[t] ?? Math.round(r.base_quantity * (RATIOS[t] || 0))).toLocaleString()}</b>
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>⏱ {r.timeframe}</span>
                      <span className="text-primary font-semibold">{activeTypes.length} type(s)</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-border">
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground font-semibold">{totalValid}</span> order(s) ready
              </p>
              <Button className="btn-3d h-11 px-6" disabled={submitting || !bundleId} onClick={submit}>
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</> : 'Submit All'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        {editing && (
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Edit Order</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Link</Label>
                <Input className="input-3d mt-2" value={editing.link} onChange={e => setEditing({ ...editing, link: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Base Quantity (Views)</Label>
                  <Input
                    type="number"
                    className="input-3d mt-2"
                    value={editing.base_quantity}
                    onChange={e => {
                      const b = Number(e.target.value) || 0;
                      setEditing({ ...editing, base_quantity: b, qty: defaultQty(b) });
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Changing the base will auto-adjust the default quantity for every type.</p>
                </div>
                <div>
                  <Label>Timeframe</Label>
                  <select
                    className="w-full h-10 mt-2 px-3 rounded-xl bg-secondary border border-border text-foreground"
                    value={isCustom(editing.timeframe) ? CUSTOM : editing.timeframe}
                    onChange={e => setEditing({ ...editing, timeframe: e.target.value === CUSTOM ? 'Under 1 hours' : e.target.value })}
                  >
                    {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
                    <option value={CUSTOM}>Custom…</option>
                  </select>
                  {isCustom(editing.timeframe) && (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        type="number"
                        min={1}
                        className="input-3d h-10 w-24"
                        value={parseInt(editing.timeframe.replace(/\D/g, '')) || 1}
                        onChange={e => setEditing({ ...editing, timeframe: `Under ${Math.max(1, Number(e.target.value) || 1)} hours` })}
                      />
                      <span className="text-xs text-muted-foreground">hours</span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <Label>Engagement Types & Quantities</Label>
                <p className="text-[11px] text-muted-foreground mt-1">Set a separate quantity for each type. Only enabled types will be submitted.</p>
                <div className="mt-2 space-y-2">
                  {(allowedTypes.length ? allowedTypes : ALL_TYPES).map(t => {
                    const on = !!editing.types[t];
                    const q = editing.qty[t] ?? Math.round(editing.base_quantity * (RATIOS[t] || 0));
                    return (
                      <div key={t} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-secondary/40">
                        <label className="flex items-center gap-2 min-w-[110px] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={e => setEditing({ ...editing, types: { ...editing.types, [t]: e.target.checked } })}
                          />
                          <span className="capitalize text-sm font-medium">{t}</span>
                        </label>
                        <Input
                          type="number"
                          min={0}
                          disabled={!on}
                          className="input-3d h-9 flex-1"
                          value={q}
                          onChange={e => setEditing({ ...editing, qty: { ...editing.qty, [t]: Math.max(0, Number(e.target.value) || 0) } })}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button className="btn-3d" onClick={() => saveEdit(editing)}>Save</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </DashboardLayout>
  );
}
