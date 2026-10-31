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
import { Rocket, Upload, Package, Pencil, Trash2, Loader2, MessageSquare, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { NoBundleBanner } from '@/components/NoBundleBanner';
import { coordinateEngagementSchedules, generateOrganicSchedule } from '@/lib/organic-algorithm';

interface Row {
  id: string;
  link: string;
  base_quantity: number;
  timeframe: string;
  types: Record<string, boolean>;
  qty: Record<string, number>; // per-type quantity (custom override or randomized)
  custom_comments?: string[]; // comments if provided for this link
}

const ALL_TYPES = ['views', 'likes', 'shares', 'reposts', 'comments', 'saves', 'followers'] as const;
const DEFAULT_TYPES: Record<string, boolean> = { views: true, likes: false, shares: false, reposts: false, comments: false, saves: false, followers: false };
const TIMEFRAMES = ['Under 6 hours', 'Under 12 hours', 'Under 24 hours', 'Under 48 hours', 'Under 72 hours'];
const CUSTOM = 'Custom';
const isCustom = (v: string) => !TIMEFRAMES.includes(v);

const DEFAULT_RATIOS_MIN: Record<string, number> = {
  views: 100,
  likes: 2.1,
  shares: 0.1,
  saves: 0.2,
  comments: 0.03,
  reposts: 0.03,
  followers: 1.0,
};

const DEFAULT_RATIOS_MAX: Record<string, number> = {
  views: 100,
  likes: 5.0,
  shares: 0.5,
  saves: 0.6,
  comments: 0.2,
  reposts: 0.25,
  followers: 3.0,
};

const RATIOS: Record<string, number> = { views: 1, likes: 0.031, shares: 0.013, reposts: 0.010, comments: 0.008, saves: 0.012, followers: 0.02 };

interface ParsedLine {
  link: string;
  comments: string[];
}

function parseMassOrderInput(raw: string): ParsedLine[] {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result: ParsedLine[] = [];

  for (const line of lines) {
    let link = '';
    let commentText = '';

    if (line.includes('|')) {
      const parts = line.split('|');
      link = parts[0].trim();
      commentText = parts.slice(1).join('|').trim();
    } else if (line.includes(',')) {
      const commaIdx = line.indexOf(',');
      const possibleLink = line.slice(0, commaIdx).trim();
      if (/^https?:\/\/\S+/i.test(possibleLink)) {
        link = possibleLink;
        commentText = line.slice(commaIdx + 1).trim();
      } else {
        link = line.trim();
      }
    } else {
      link = line.trim();
    }

    if (/^https?:\/\/\S+/i.test(link)) {
      const comments = commentText
        ? commentText.split(/[,;\n]/).map(c => c.trim()).filter(Boolean)
        : [];
      result.push({ link, comments });
    }
  }
  return result;
}

function defaultQty(base: number): Record<string, number> {
  const q: Record<string, number> = {};
  ALL_TYPES.forEach(t => { q[t] = Math.round(base * (RATIOS[t] || 0)); });
  return q;
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
      const { data, error } = await supabase
        .from('user_bundles')
        .select('id, name, platform, user_bundle_items(id, engagement_type, quantity, user_service_id, min_ratio_percent, max_ratio_percent, user_bundle_item_providers(user_provider_account_id, provider_service_id, priority, enabled))')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: userServices = [] } = useQuery({
    queryKey: ['mass-order-user-services', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_services')
        .select('id, user_provider_account_id, provider_service_id, rate, min_quantity, is_active')
        .eq('is_active', true);
      if (error) throw error;
      return data || [];
    },
  });

  const rateForItem = (item: any): number => {
    const list = userServices as any[];
    const direct = list.find((s) => s.id === item?.user_service_id);
    if (direct && Number(direct.rate) > 0) return Number(direct.rate);
    const mapped = (item?.user_bundle_item_providers || [])
      .map((m: any) => list.find((s) =>
        s.user_provider_account_id === m.user_provider_account_id
        && String(s.provider_service_id) === String(m.provider_service_id)
      ))
      .filter((s: any) => s && Number(s.rate) > 0)
      .map((s: any) => Number(s.rate));
    return mapped.length ? Math.min(...mapped) : 0;
  };

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
      if (i.engagement_type) m[i.engagement_type] = rateForItem(i);
    });
    return m;
  }, [selectedBundle, userServices]);

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
    const parsed = parseMassOrderInput(raw);
    if (!parsed.length) return toast.error('No valid links found');
    if (!bundleId) return toast.error('Please select a bundle first');

    const items = selectedBundle?.user_bundle_items || [];
    const typesToUse = allowedTypes.length ? allowedTypes : ['views'];

    setRows(parsed.map(({ link, comments }) => {
      const types: Record<string, boolean> = {};
      ALL_TYPES.forEach(t => { types[t] = false; });
      typesToUse.forEach(t => { types[t] = true; });

      const qty: Record<string, number> = {};
      ALL_TYPES.forEach(t => {
        if (t === 'views') {
          qty[t] = baseQty;
        } else if (t === 'comments' && comments.length > 0) {
          qty[t] = comments.length;
          types['comments'] = true;
        } else {
          // Compute randomized ratio between min and max percentage
          const bundleItem = items.find((i: any) => i.engagement_type === t);
          const min = (bundleItem?.min_ratio_percent != null && Number(bundleItem.min_ratio_percent) > 0)
            ? Number(bundleItem.min_ratio_percent)
            : (DEFAULT_RATIOS_MIN[t] ?? 2.1);
          const max = (bundleItem?.max_ratio_percent != null && Number(bundleItem.max_ratio_percent) > 0)
            ? Number(bundleItem.max_ratio_percent)
            : (DEFAULT_RATIOS_MAX[t] ?? 5.0);

          const low = Math.min(min, max);
          const high = Math.max(min, max);
          const randomPercent = low + Math.random() * (high - low);
          qty[t] = Math.max(1, Math.round(baseQty * (randomPercent / 100)));
        }
      });

      return {
        id: crypto.randomUUID(),
        link,
        base_quantity: baseQty,
        timeframe,
        types,
        qty,
        custom_comments: comments.length > 0 ? comments : undefined,
      };
    }));
    toast.success(`${parsed.length} link(s) ready with randomized organic ratios!`);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setRaw(text);
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
        price: rateForItem(i),
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
              custom_comments: (t === 'comments' && r.custom_comments && r.custom_comments.length > 0)
                ? r.custom_comments.join("\n")
                : undefined,
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
                Order multiple links at once. Paste links or links with custom comments, auto-randomize organic ratios per video, and submit in one click.
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
            <p className="text-xs text-warning">First create a bundle in My Bundles to use Mass Order.</p>
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
                Each link will automatically receive random natural engagement quantities calculated from your bundle's Min% and Max% ratios.
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
        </div>

        {/* Links input */}
        <div className="glass-card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">🔗 Links & Comments</h2>
            <label className="btn-glass px-3 py-2 text-xs cursor-pointer flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" /> Upload CSV / TXT
              <input type="file" accept=".csv,.txt" className="hidden" onChange={onFile} />
            </label>
          </div>

          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
            <b>Formats Supported:</b><br />
            • <b>Plain link:</b> <code>https://instagram.com/p/abc</code><br />
            • <b>Link with Custom Comments:</b> <code>https://instagram.com/p/abc | Great reel, Awesome video, Love this!</code><br />
            • <b>Comma separated:</b> <code>https://instagram.com/p/abc, Nice post, Beautiful video, Super cool</code>
          </div>

          <Textarea
            rows={7}
            className="input-3d font-mono text-[13px]"
            placeholder={`One link per line. Optional custom comments separated by comma:
https://instagram.com/p/video1
https://instagram.com/p/video2 | Nice post, Awesome reel, Love this, Wow!
https://instagram.com/p/video3, Great video, Super cool, Best content`}
            value={raw}
            onChange={e => setRaw(e.target.value)}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{parseMassOrderInput(raw).length} valid link(s)</span>
            <Button onClick={preview} className="btn-3d h-10 px-5 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-400" /> Preview with Random Ratios
            </Button>
          </div>
        </div>

        {/* Preview */}
        {rows.length > 0 && (
          <div className="glass-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Preview ({rows.length} Links)</h2>
                <p className="text-xs text-muted-foreground">Each video has randomized organic ratios and custom comments attached.</p>
              </div>
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
                        {r.custom_comments && r.custom_comments.length > 0 && (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md w-fit">
                            <MessageSquare className="w-3 h-3" />
                            <span>{r.custom_comments.length} Custom Comments</span>
                          </div>
                        )}
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
                          <b>{(r.qty[t] ?? 0).toLocaleString()}</b>
                          {t === 'comments' && r.custom_comments?.length ? (
                            <span className="ml-1 text-[10px] text-amber-600 font-semibold">(Custom)</span>
                          ) : null}
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
                      setEditing({ ...editing, base_quantity: b });
                    }}
                  />
                </div>
                <div>
                  <Label>Timeframe</Label>
                  <select
                    className="w-full h-10 px-3 mt-2 rounded-xl bg-secondary border border-border"
                    value={editing.timeframe}
                    onChange={e => setEditing({ ...editing, timeframe: e.target.value })}
                  >
                    {TIMEFRAMES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Custom comments textarea in edit modal */}
              <div>
                <Label>Custom Comments (one per line or comma-separated)</Label>
                <Textarea
                  rows={3}
                  className="input-3d font-mono text-xs mt-2"
                  placeholder="Comment 1, Comment 2, Comment 3"
                  value={editing.custom_comments ? editing.custom_comments.join(", ") : ""}
                  onChange={e => {
                    const comments = e.target.value.split(/[,;\n]/).map(c => c.trim()).filter(Boolean);
                    setEditing({
                      ...editing,
                      custom_comments: comments.length > 0 ? comments : undefined,
                      qty: { ...editing.qty, comments: comments.length > 0 ? comments.length : (editing.qty.comments || 1) },
                      types: { ...editing.types, comments: comments.length > 0 ? true : editing.types.comments }
                    });
                  }}
                />
              </div>

              <div>
                <Label>Quantities</Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {allowedTypes.map(t => (
                    <div key={t} className="flex items-center gap-2 p-2 border rounded-lg bg-secondary/30">
                      <input
                        type="checkbox"
                        checked={!!editing.types[t]}
                        onChange={e => setEditing({ ...editing, types: { ...editing.types, [t]: e.target.checked } })}
                      />
                      <span className="capitalize text-xs font-medium flex-1">{t}</span>
                      <Input
                        type="number"
                        min={0}
                        className="h-8 w-20 text-xs text-right"
                        value={editing.qty[t] ?? 0}
                        onChange={e => setEditing({ ...editing, qty: { ...editing.qty, [t]: Number(e.target.value) || 0 } })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={() => saveEdit(editing)}>Save</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </DashboardLayout>
  );
}
