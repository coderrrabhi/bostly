import { varyRunGaps, curvePlan } from '@/lib/curve-plan';
import { DeliveryStartTime } from '@/components/engagement/DeliveryStartTime';
import { loadDeliverySettings, deliveryPayload, type DeliverySettings } from '@/lib/order-delivery-settings';
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
import { Rocket, Upload, Package, Pencil, Trash2, Loader2, MessageSquare, Sparkles, Shuffle, Flame, ShieldCheck, TrendingUp } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { CurveSparkline } from '@/components/engagement/CurveSparkline';
import { MIN_VARIANCE_PERCENT, applyCurveStyle, curveStyleFor, minOrderFor, normalizeRunTotals, newCurveSeed, qtyFromPercent, randomRatioPercent, randomViewsInRange, withSeed } from '@/lib/organic-extras';
import { toast } from 'sonner';
import { NoBundleBanner } from '@/components/NoBundleBanner';
import { coordinateEngagementSchedules, generateOrganicSchedule, generateRandomVaryingRuns } from '@/lib/organic-algorithm';
import { resolveEffectiveMin } from '@/lib/engagement-order-management';
import { distinctRunList } from '@/lib/curve-plan';
import { applyPeakHours } from '@/lib/peak-hours';
import { MASS_CURVE_AUTO, massCurveChoices, massCurvePreset, warpForPreset } from '@/lib/mass-curve-select';

interface Row {
  id: string;
  link: string;
  order_name: string;
  base_quantity: number;
  timeframe: string;
  types: Record<string, boolean>;
  qty: Record<string, number>; // per-type quantity (custom override or randomized)
  custom_comments?: string[]; // comments if provided for this link
  pct: Record<string, number>; // random ratio % per type (kept when views are edited)
  seed: number; // unique delivery curve per reel
  runs: Record<string, ScheduledRun[]>; // preview schedule (submitted as-is)
  builtAt: number; // when the preview schedule was generated
}

interface ScheduledRun {
  scheduled_at: string;
  quantity_to_send: number;
  base_quantity: number;
  variance_applied: number;
  peak_multiplier: number;
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
  const [baseQty, setBaseQty] = useState(5000);
  const [baseQtyMax, setBaseQtyMax] = useState(10000);
  const [defaultsQty, setDefaultsQty] = useState<Record<string, number>>(() => defaultQty(5000));
  const [peakUS, setPeakUS] = useState(false);
  // 'auto' = every reel gets its own unique seeded curve; otherwise one of the
  // real-Reel-shaped presets is applied to every reel.
  const [massCurveId, setMassCurveId] = useState<string>(MASS_CURVE_AUTO);
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings>(() => loadDeliverySettings());
  const [variance, setVariance] = useState(MIN_VARIANCE_PERCENT);
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
        .select('id, name, platform, user_bundle_items(id, engagement_type, quantity, user_service_id, min_ratio_percent, max_ratio_percent, min_quantity, max_quantity, user_bundle_item_providers(user_provider_account_id, provider_service_id, priority, enabled))')
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

  const providerMinFor = (t: string): number | undefined => {
    const bundleItem = (selectedBundle?.user_bundle_items || []).find((item: any) => item.engagement_type === t);
    // Bundle-level Min (set on My Bundles page) overrides the provider's minimum.
    const bundleMin = Number(bundleItem?.min_quantity) || 0;
    if (bundleMin > 0) return bundleMin;
    const mins = (bundleItem?.user_bundle_item_providers || [])
      .filter((mapping: any) => mapping.enabled && mapping.provider_service_id)
      .map((mapping: any) => {
        const service = (userServices as any[]).find((candidate: any) =>
          candidate.user_provider_account_id === mapping.user_provider_account_id
          && String(candidate.provider_service_id) === String(mapping.provider_service_id)
        );
        return Number(service?.min_quantity) || 0;
      })
      .filter((minimum: number) => minimum > 0);
    return minOrderFor(t, mins.length ? Math.min(...mins) : undefined);
  };

  // The curve a reel follows: the selected preset for every reel, or its own
  // unique seeded curve when "auto" is selected.
  function activeCurveStyle(seed: number, curveId = massCurveId): { name: string; warp: (x: number) => number } {
    if (curveId !== MASS_CURVE_AUTO) {
      const warp = warpForPreset(curveId);
      const preset = massCurvePreset(curveId);
      if (warp && preset) return { name: preset.name, warp };
    }
    return curveStyleFor(seed);
  }

  // Build each reel's delivery curve from its seed or the selected preset.
  function buildRuns(types: Record<string, boolean>, qty: Record<string, number>, tf: string, seed: number, peakEnabled = peakUS, curveId = massCurveId): { runs: Record<string, ScheduledRun[]>; builtAt: number } {
    const hours = timeframeToHours(tf);
    const builtAt = Date.now();
    const start = new Date(builtAt + 5 * 60_000);
    const active = Object.keys(types).filter((t) => types[t] && (qty[t] ?? 0) > 0);

    const effectiveMins: Record<string, number> = {};
    active.forEach(t => {
      const bundleItem = (selectedBundle?.user_bundle_items || []).find((item: any) => item.engagement_type === t);
      // My Bundles minimum wins; otherwise the provider service minimum, then
      // the built-in floor. The old "Minimum Order per Run" panel is gone.
      effectiveMins[t] = resolveEffectiveMin(bundleItem?.min_quantity, providerMinFor(t), minOrderFor(t));
    });

    const schedules = withSeed(seed, () => coordinateEngagementSchedules(
      active.map((t) => generateOrganicSchedule(t, qty[t], variance, false, start, effectiveMins[t], hours)),
      effectiveMins,
    ));
    const runs: Record<string, ScheduledRun[]> = {};
    schedules.forEach((schedule) => {
      runs[schedule.engagementType] = schedule.runs.map((run) => ({
        scheduled_at: run.scheduledAt.toISOString(),
        quantity_to_send: run.quantity,
        base_quantity: run.baseQuantity,
        variance_applied: run.varianceApplied,
        peak_multiplier: run.peakMultiplier,
      }));
    });
    // Give this reel its curve shape (selected preset, or its own seeded style).
    const styled = applyCurveStyle(runs, start.getTime(), activeCurveStyle(seed, curveId));
    Object.keys(styled).forEach((t) => { runs[t] = styled[t]; });
    // Clean up: drop zero/negative runs and keep the exact total (respecting provider/custom minimum).
    Object.keys(runs).forEach((t) => {
      const normalized = normalizeRunTotals(runs[t], qty[t] ?? 0, effectiveMins[t] ?? 1);
      const peakRuns = applyPeakHours(normalized, peakEnabled, effectiveMins[t] ?? 1);
      runs[t] = distinctRunList(
        peakRuns.map((run, index) => ({ ...run, quantity: run.quantity_to_send, runNumber: index + 1 })),
        effectiveMins[t] ?? 1,
      ).map((run) => ({
        scheduled_at: run.scheduled_at,
        quantity_to_send: run.quantity,
        base_quantity: run.quantity,
        variance_applied: run.variance_applied,
        peak_multiplier: run.peak_multiplier ?? 1,
      }));
      // Every gap between this reel's runs is different, still inside the timeframe.
      runs[t] = varyRunGaps(runs[t], start.getTime(), hours);
    });
    return { runs, builtAt };
  }

  // Views → every other engagement keeps its own random % of views.
  function quantitiesFor(views: number, pct: Record<string, number>, comments?: string[]): Record<string, number> {
    const qty: Record<string, number> = {};
    ALL_TYPES.forEach((t) => {
      if (t === 'views') qty[t] = views;
      else if (t === 'comments' && comments && comments.length > 0) qty[t] = comments.length;
      else {
        // % of views decides the quantity; the My Bundles minimum is only a floor
        // (qtyFromPercent would force saves/shares up to hardcoded 10/2 instead).
        const floor = providerMinFor(t) ?? 1;
        qty[t] = Math.max(floor, Math.round(views * ((pct[t] ?? 0) / 100)));
      }
    });
    return qty;
  }

  function rebuildRow(r: Row, seed = r.seed, peakEnabled = peakUS, curveId = massCurveId): Row {
    const { runs, builtAt } = buildRuns(r.types, r.qty, r.timeframe, seed, peakEnabled, curveId);
    return { ...r, seed, runs, builtAt };
  }

  function togglePeakHours(enabled: boolean) {
    setPeakUS(enabled);
    setRows((current) => current.map((row) => rebuildRow(row, row.seed, enabled)));
  }

  // Switching the curve re-times every previewed reel onto the new shape.
  function selectMassCurve(id: string) {
    setMassCurveId(id);
    setRows((current) => current.map((row) => rebuildRow(row, row.seed, peakUS, id)));
  }

  function preview() {
    const parsed = parseMassOrderInput(raw);
    if (!parsed.length) return toast.error('No valid links found');
    if (!bundleId) return toast.error('Please select a bundle first');
    const lo = Math.max(1, Math.min(baseQty, baseQtyMax || baseQty));
    const hi = Math.max(baseQty, baseQtyMax || baseQty);

    const items = selectedBundle?.user_bundle_items || [];
    const typesToUse = allowedTypes.length ? allowedTypes : ['views'];
    const usedViews = new Set<number>();

    setRows(parsed.map(({ link, comments }, index) => {
      const types: Record<string, boolean> = {};
      ALL_TYPES.forEach(t => { types[t] = false; });
      typesToUse.forEach(t => { types[t] = true; });
      if (comments.length > 0) types['comments'] = true;

      const views = lo === hi ? lo : randomViewsInRange(lo, hi, usedViews);
      const pct: Record<string, number> = {};
      ALL_TYPES.forEach((t) => {
        const bundleItem = items.find((i: any) => i.engagement_type === t);
        pct[t] = randomRatioPercent(t, bundleItem);
      });
      const qty = quantitiesFor(views, pct, comments);
      const seed = newCurveSeed();
      const { runs, builtAt } = buildRuns(types, qty, timeframe, seed);

      return {
        id: crypto.randomUUID(),
        link,
        order_name: campaign.trim() ? `${campaign.trim()} - ${index + 1}`.slice(0, 120) : '',
        base_quantity: views,
        timeframe,
        types,
        qty,
        custom_comments: comments.length > 0 ? comments : undefined,
        pct,
        seed,
        runs,
        builtAt,
      };
    }));
    toast.success(massCurveId === MASS_CURVE_AUTO
      ? `${parsed.length} link(s) ready — random views, random ratios and a unique curve per reel!`
      : `${parsed.length} link(s) ready — every reel follows the ${massCurvePreset(massCurveId)?.name ?? 'selected'} curve!`);
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
    const rebuilt = rebuildRow(r);
    setRows(prev => prev.map(x => x.id === r.id ? rebuilt : x));
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
        // Shift the previewed curve so the first run still starts ~5 min from now.
        const shiftMs = Math.max(0, Date.now() - r.builtAt);
        const engagements = Object.keys(r.types)
          .filter((t) => r.types[t])
          .map((t) => {
            const q = r.qty[t] ?? Math.round(r.base_quantity * (RATIOS[t] || 0));
            const bundleItem = items.find((item: any) => item.engagement_type === t);
            const providerMappings = (bundleItem?.user_bundle_item_providers || [])
              .filter((mapping: any) => mapping.enabled && mapping.provider_service_id)
              .sort((a: any, b: any) => (a.priority ?? 999) - (b.priority ?? 999));
            const priceK = serviceMap[t]?.price ?? 0;
            let runs = (r.runs[t] ?? []).filter((run) => run.quantity_to_send > 0);
            let runsTotal = runs.reduce((sum, run) => sum + run.quantity_to_send, 0);
            if ((runsTotal !== q || runs.length === 0) && q > 0) {
              const effectiveMin = effectiveMins[t] || 1;
              const maxSlots = Math.min(10, Math.max(2, Math.floor(q / effectiveMin)));
              const qtys = generateRandomVaryingRuns(q, effectiveMin, maxSlots);
              const baseTime = Date.now() + 5 * 60_000;
              const totalDur = hours * 60 * 60_000;
              const gap = qtys.length > 1 ? totalDur / (qtys.length - 1) : 30 * 60_000;
              runs = varyRunGaps(qtys.map((qty, i) => ({
                run_number: i + 1,
                scheduled_at: new Date(baseTime + i * gap).toISOString(),
                quantity_to_send: qty,
                base_quantity: qty,
                variance_applied: 0,
                peak_multiplier: 1,
              })), baseTime, hours);
              runsTotal = q;
            }
            return {
              type: t,
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
              variance_percent: variance,
              peak_hours_enabled: peakUS,
              scheduled_runs: runsTotal === q
                ? runs.map((run) => ({ ...run, scheduled_at: new Date(new Date(run.scheduled_at).getTime() + shiftMs).toISOString() }))
                : undefined,
            };
          })
          .filter((e) => e.quantity > 0);

        if (!engagements.length) { fail++; continue; }
        const missingMapping = engagements.find((engagement) => engagement.provider_mappings.length === 0);
        // Server re-reads live My Bundles providers; a stale empty list is not final.
        if (false && missingMapping) {
          firstError ||= `${missingMapping.type} has no provider service mapped. Configure it in My Bundles.`;
          fail++;
          continue;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        const { data, error } = await supabase.functions.invoke('process-engagement-order', {
          body: {
            user_id: user?.id,
            user_bundle_id: bundleId,
            bundle_id: null,
            link: r.link,
            order_name: r.order_name.trim(),
            curve_name: activeCurveStyle(r.seed).name,
            base_quantity: r.base_quantity,
            total_price: perRowCost(r),
            is_organic_mode: true,
            peak_hours_enabled: peakUS,
            ...deliveryPayload(deliverySettings),
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

        {/* Start time + minimum order per run */}
        <DeliveryStartTime value={deliverySettings} onChange={setDeliverySettings} />

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
            <Label>Campaign / Order Name Prefix (optional)</Label>
            <Input className="input-3d mt-2 h-12" maxLength={100} placeholder="My campaign" value={campaign} onChange={e => setCampaign(e.target.value)} />
          </div>
        </div>

        {/* Defaults */}
        <div className="glass-card p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Default Base Quantity (Views) — Random Range</Label>
              <div className="flex items-center gap-2 mt-2">
                <Input
                  type="number"
                  min={1}
                  className="input-3d h-12"
                  placeholder="From e.g. 5000"
                  value={baseQty || ''}
                  onChange={e => recomputeDefaults(Number(e.target.value) || 0)}
                />
                <span className="text-xs text-muted-foreground shrink-0">to</span>
                <Input
                  type="number"
                  min={1}
                  className="input-3d h-12"
                  placeholder="To e.g. 10000"
                  value={baseQtyMax || ''}
                  onChange={e => setBaseQtyMax(Number(e.target.value) || 0)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Every reel gets a different random views number inside this range (e.g. 5000–10000). All other engagement is then set randomly from your bundle's Min% and Max% ratios. Put the same number in both boxes for a fixed quantity.
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
              {isCustom(timeframe) && (() => {
                const lo = curvePlan(Math.min(baseQty, baseQtyMax || baseQty));
                const hi = curvePlan(Math.max(baseQty, baseQtyMax || baseQty));
                const h = parseInt(timeframe.replace(/\D/g, '')) || 1;
                const bad = h < hi.minHours || h > lo.maxHours;
                return (
                  <p className={`text-xs mt-2 ${bad ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                    For a smooth curve with {Math.min(baseQty, baseQtyMax || baseQty).toLocaleString()}–{Math.max(baseQty, baseQtyMax || baseQty).toLocaleString()} views: {lo.runs}–{hi.runs} views runs, timeframe {hi.minHours}h (min) to {lo.maxHours}h (max).
                    {bad ? ` ${h}h is outside this range.` : ''}
                  </p>
                );
              })()}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-secondary border border-border">
            <Label className="flex items-center gap-1.5"><TrendingUp className="w-4 h-4 text-primary" /> Delivery Curve (all reels)</Label>
            <select
              className="w-full h-11 px-3 mt-2 rounded-xl bg-background border border-border text-foreground"
              value={massCurveId}
              onChange={e => selectMassCurve(e.target.value)}
              aria-label="Delivery curve for all reels"
            >
              <option value={MASS_CURVE_AUTO}>🎲 Auto — unique curve per reel</option>
              {massCurveChoices().map((p) => (
                <option key={p.id} value={p.id}>{p.emoji} {p.name} — {p.description}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {massCurveId === MASS_CURVE_AUTO
                ? 'Every reel gets its own different curve automatically.'
                : `Every reel follows the ${massCurvePreset(massCurveId)?.name ?? 'selected'} curve — a real-Reel shape.`}
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary border border-border">
              <div className="min-w-0">
                <Label className="flex items-center gap-1.5"><Flame className="w-4 h-4 text-primary" /> Peak Hours (USA Time)</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">Off by default. On gently boosts 6–11 PM New York within smooth-curve limits; totals and run times stay unchanged.</p>
              </div>
              <Switch checked={peakUS} onCheckedChange={togglePeakHours} aria-label="Enable Peak Hours for mass orders" />
            </div>
            <div className="p-3 rounded-xl bg-secondary border border-border">
              <div className="flex items-center justify-between gap-3">
                <Label className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-primary" /> Random Variance &amp; Detection Risk</Label>
                <span className="font-mono text-sm font-bold px-2 py-0.5 rounded-lg bg-primary/15 text-primary">±{variance}%</span>
              </div>
              <input
                type="range"
                min={MIN_VARIANCE_PERCENT}
                max={90}
                step={5}
                value={variance}
                onChange={e => setVariance(Math.max(MIN_VARIANCE_PERCENT, Number(e.target.value) || MIN_VARIANCE_PERCENT))}
                className="w-full mt-2 accent-primary"
              />
              <p className="text-[11px] text-muted-foreground mt-0.5">Auto set to 50%+ on every reel — low detection risk.</p>
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
                <p className="text-xs text-muted-foreground">{massCurveId === MASS_CURVE_AUTO ? 'Each reel has random views, random ratios, its own delivery curve and custom comments attached.' : `Each reel has random views and ratios; every reel follows the ${massCurvePreset(massCurveId)?.name ?? 'selected'} curve.`}</p>
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
                    <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-border/50">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-primary/10 border border-primary/25 text-primary text-xs font-bold">
                          <TrendingUp className="w-3.5 h-3.5" />
                          Pattern: {activeCurveStyle(r.seed).name} (#{String(r.seed).slice(-4)})
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono bg-background/60 px-2 py-0.5 rounded border border-border">
                          {r.runs.views?.length ?? 0} runs
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {massCurveId === MASS_CURVE_AUTO && (
                          <button title="Shuffle pattern / curve" onClick={() => setRows(prev => prev.map(x => x.id === r.id ? rebuildRow(x, newCurveSeed()) : x))} className="text-muted-foreground hover:text-primary p-1"><Shuffle className="w-4 h-4" /></button>
                        )}
                        <button onClick={() => setEditing(r)} className="text-muted-foreground hover:text-primary p-1"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => setRows(rows.filter(x => x.id !== r.id))} className="text-muted-foreground hover:text-destructive p-1"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="mb-3 space-y-1">
                      <Label htmlFor={`order-name-${r.id}`}>Order Name</Label>
                      <Input id={`order-name-${r.id}`} maxLength={120} placeholder="My Reel name" value={r.order_name} onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, order_name: e.target.value } : x))} />
                    </div>
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
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                      {activeTypes.map(t => (
                        <span key={t} className="text-foreground">
                          <span className="capitalize text-muted-foreground">{t}:</span>{' '}
                          <b>{(r.qty[t] ?? 0).toLocaleString()}</b>
                          {providerMinFor(t) ? (
                            <span className="ml-1 text-[10px] text-muted-foreground">min {providerMinFor(t)}</span>
                          ) : null}
                          {t === 'comments' && r.custom_comments?.length ? (
                            <span className="ml-1 text-[10px] text-amber-600 font-semibold">(Custom)</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                    {(r.runs.views?.length ?? 0) > 0 && (
                      <div className="mt-3 rounded-lg border border-border bg-background/60 px-2 pt-1">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{activeCurveStyle(r.seed).name} curve #{String(r.seed).slice(-4)} · {r.runs.views.length} runs</span>
                          <span>{peakUS ? '🔥 USA peak' : ''} ±{variance}%</span>
                        </div>
                        <CurveSparkline runs={r.runs.views} height={40} />
                      </div>
                    )}
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
              <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 flex items-center justify-between">
                <div>
                  <Label className="text-xs text-primary font-semibold flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4" /> Assigned Delivery Curve / Pattern
                  </Label>
                  <p className="text-sm font-bold text-foreground mt-0.5">
                    {activeCurveStyle(editing.seed).name} <span className="text-xs font-mono text-muted-foreground">(#{String(editing.seed).slice(-4)})</span>
                  </p>
                </div>
                {massCurveId === MASS_CURVE_AUTO && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => setEditing(rebuildRow(editing, newCurveSeed()))}
                  >
                    <Shuffle className="w-3.5 h-3.5" /> Shuffle Pattern
                  </Button>
                )}
              </div>
              <div>
                <Label htmlFor="edit-order-name">Order Name</Label>
                <Input id="edit-order-name" maxLength={120} value={editing.order_name} onChange={e => setEditing({ ...editing, order_name: e.target.value })} />
              </div>
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
                      // Views changed → every engagement follows its own random percentage.
                      setEditing({ ...editing, base_quantity: b, qty: quantitiesFor(b, editing.pct, editing.custom_comments) });
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
                        onChange={e => {
                          const v = Number(e.target.value) || 0;
                          if (t === 'views') setEditing({ ...editing, base_quantity: v, qty: quantitiesFor(v, editing.pct, editing.custom_comments) });
                          else setEditing({ ...editing, qty: { ...editing.qty, [t]: v } });
                        }}
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
