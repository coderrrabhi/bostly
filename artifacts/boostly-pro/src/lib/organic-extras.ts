// Shared helpers for Single + Mass orders: random view ranges, random ratio
// percentages, seeded "curves" per reel, USA peak-hour time zone and refills
// that reuse the original order's delivery curve.

export const MIN_VARIANCE_PERCENT = 50;
export const US_PEAK_TIMEZONE = 'America/New_York';
export const US_PEAK_LABEL = 'USA time (New York) · 6–11 PM boost';

/** Offset (ms) to add to a UTC timestamp to get US Eastern wall-clock time (DST aware). */
export function usPeakOffsetMs(at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: US_PEAK_TIMEZONE,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return -5 * 60 * 60 * 1000;
  }
}

export function randomInt(min: number, max: number): number {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Random views inside a range, never repeating a value already used in `used`. */
export function randomViewsInRange(min: number, max: number, used: Set<number>): number {
  for (let i = 0; i < 50; i++) {
    const v = randomInt(min, max);
    if (!used.has(v)) { used.add(v); return v; }
  }
  const v = randomInt(min, max);
  used.add(v);
  return v;
}

export const DEFAULT_RATIOS_MIN: Record<string, number> = {
  views: 100, likes: 1.5, shares: 0.1, saves: 0.2, comments: 0.1, reposts: 0.03, followers: 1.0,
};
export const DEFAULT_RATIOS_MAX: Record<string, number> = {
  views: 100, likes: 2.0, shares: 0.5, saves: 0.6, comments: 0.2, reposts: 0.25, followers: 3.0,
};

/** Random percentage for a type between the bundle's Min% and Max% (falls back to defaults). */
export function randomRatioPercent(type: string, bundleItem?: { min_ratio_percent?: number | null; max_ratio_percent?: number | null }): number {
  if (type === 'views') return 100;
  const min = bundleItem?.min_ratio_percent != null && Number(bundleItem.min_ratio_percent) > 0
    ? Number(bundleItem.min_ratio_percent) : (DEFAULT_RATIOS_MIN[type] ?? 2.1);
  const max = bundleItem?.max_ratio_percent != null && Number(bundleItem.max_ratio_percent) > 0
    ? Number(bundleItem.max_ratio_percent) : (DEFAULT_RATIOS_MAX[type] ?? 5.0);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.random() * (hi - lo);
}

export function qtyFromPercent(views: number, percent: number): number {
  return Math.max(1, Math.round(views * (percent / 100)));
}

/** Deterministic PRNG so a reel's curve can be reproduced exactly from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newCurveSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}

/** Run `fn` with Math.random replaced by a seeded generator (restored afterwards). */
export function withSeed<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

export interface PlainRun {
  scheduled_at: string;
  quantity_to_send: number;
}

/**
 * Re-create an existing delivery curve for a refill: same relative timing and
 * same share of quantity per run, scaled to `newTotal`, starting at `startAt`.
 * Every run respects the provider minimum/maximum and the total stays exact.
 */
export function scaleRunsToCurve(
  original: PlainRun[],
  newTotal: number,
  startAt: Date,
  providerMin = 1,
  providerMax = 0,
  anchorAt?: number, // earliest run of the whole order, so types keep their gaps to each other
): PlainRun[] {
  const sorted = [...original]
    .filter((r) => Number(r.quantity_to_send) > 0)
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const min = Math.max(1, providerMin || 1);
  if (!sorted.length || newTotal <= 0) {
    return [{ scheduled_at: startAt.toISOString(), quantity_to_send: Math.max(newTotal, 0) }];
  }
  const oldTotal = sorted.reduce((s, r) => s + Number(r.quantity_to_send), 0);
  const first = anchorAt ?? new Date(sorted[0].scheduled_at).getTime();
  let runs = sorted.map((r) => ({
    offset: new Date(r.scheduled_at).getTime() - first,
    qty: Math.round((Number(r.quantity_to_send) / oldTotal) * newTotal),
  }));

  // Merge runs that fall below the provider minimum into the next run (keeps the curve shape).
  const merged: { offset: number; qty: number }[] = [];
  let carry = 0;
  for (const r of runs) {
    const q = r.qty + carry;
    if (q < min) { carry = q; continue; }
    merged.push({ offset: r.offset, qty: q });
    carry = 0;
  }
  if (carry > 0) {
    if (merged.length) merged[merged.length - 1].qty += carry;
    else merged.push({ offset: runs[runs.length - 1].offset, qty: carry });
  }
  runs = merged;

  // Fix rounding so the total is exact.
  let drift = newTotal - runs.reduce((s, r) => s + r.qty, 0);
  if (drift !== 0) {
    const biggest = runs.reduce((bi, r, i) => (r.qty > runs[bi].qty ? i : bi), 0);
    runs[biggest].qty += drift;
    drift = 0;
  }

  // Split any run above the provider maximum.
  if (providerMax > 0) {
    const split: { offset: number; qty: number }[] = [];
    for (const r of runs) {
      let left = r.qty;
      let k = 0;
      while (left > providerMax) {
        split.push({ offset: r.offset + k * 4 * 60_000, qty: providerMax });
        left -= providerMax;
        k++;
      }
      if (left > 0) split.push({ offset: r.offset + k * 4 * 60_000, qty: left });
    }
    runs = split;
  }

  const start = startAt.getTime();
  return runs.map((r) => ({
    scheduled_at: new Date(start + r.offset).toISOString(),
    quantity_to_send: r.qty,
  }));
}

/** Cumulative curve points (0..1) for small sparkline previews. */
export function curvePoints(runs: PlainRun[]): { x: number; y: number }[] {
  const sorted = [...runs].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  if (!sorted.length) return [];
  const t0 = new Date(sorted[0].scheduled_at).getTime();
  const t1 = new Date(sorted[sorted.length - 1].scheduled_at).getTime();
  const total = sorted.reduce((s, r) => s + Number(r.quantity_to_send), 0) || 1;
  let acc = 0;
  const pts = [{ x: 0, y: 0 }];
  for (const r of sorted) {
    acc += Number(r.quantity_to_send);
    pts.push({ x: t1 > t0 ? (new Date(r.scheduled_at).getTime() - t0) / (t1 - t0) : 1, y: acc / total });
  }
  return pts;
}

/**
 * Drop zero/negative runs and make the run total exactly `total`
 * (trimming the biggest runs, never below the provider minimum).
 */
export function normalizeRunTotals<T extends { quantity_to_send: number; base_quantity?: number }>(
  runs: T[],
  total: number,
  providerMin = 1,
): T[] {
  const min = Math.max(1, providerMin || 1);
  const list = runs.filter((run) => run.quantity_to_send > 0).map((run) => ({ ...run }));
  let diff = list.reduce((a, x) => a + x.quantity_to_send, 0) - total;
  let guard = 0;
  while (diff > 0 && list.length && guard++ < 2000) {
    const biggest = list.reduce((bi, x, i) => (x.quantity_to_send > list[bi].quantity_to_send ? i : bi), 0);
    const room = list[biggest].quantity_to_send - min;
    if (room <= 0) {
      diff -= list[biggest].quantity_to_send;
      list.splice(biggest, 1);
      continue;
    }
    const take = Math.min(room, diff);
    list[biggest].quantity_to_send -= take;
    list[biggest].base_quantity = list[biggest].quantity_to_send;
    diff -= take;
  }
  if (diff < 0 && list.length) {
    const last = list.length - 1;
    list[last].quantity_to_send -= diff;
    list[last].base_quantity = list[last].quantity_to_send;
  }
  return list;
}

export interface CurveStyle {
  name: string;
  warp: (x: number) => number; // monotonic 0..1 → 0..1 time warp
}

/** Pick a curve style for a reel from its seed (same seed = same style). */
export function curveStyleFor(seed: number): CurveStyle {
  const k = 1.35 + ((seed >>> 3) % 70) / 100; // 1.35–2.04 strength, unique per seed
  const styles: CurveStyle[] = [
    { name: 'Fast start', warp: (x) => Math.pow(x, k) },
    { name: 'Slow burn', warp: (x) => Math.pow(x, 1 / k) },
    { name: 'Viral middle', warp: (x) => { const u = 2 * x - 1; return 0.5 + 0.5 * Math.sign(u) * Math.pow(Math.abs(u), k); } },
    { name: 'Two waves', warp: (x) => x + (0.05 + (k - 1.35) * 0.04) * Math.sin(4 * Math.PI * x) / (4 * Math.PI) * 4 },
    { name: 'Late boom', warp: (x) => 1 - Math.pow(1 - x, k) },
    { name: 'Steady', warp: (x) => x },
  ];
  return styles[seed % styles.length];
}

/** Re-time runs (all types of one reel together) with the reel's curve style. */
export function applyCurveStyle<T extends { scheduled_at: string }>(
  runsByType: Record<string, T[]>,
  startAt: number,
  style: CurveStyle,
): Record<string, T[]> {
  const all = Object.values(runsByType).flat();
  const span = Math.max(1, ...all.map((r) => new Date(r.scheduled_at).getTime() - startAt));
  const out: Record<string, T[]> = {};
  for (const [type, list] of Object.entries(runsByType)) {
    let last = -Infinity;
    out[type] = [...list]
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
      .map((r, i) => {
        const x = Math.min(1, Math.max(0, (new Date(r.scheduled_at).getTime() - startAt) / span));
        const y = Math.min(1, Math.max(0, style.warp(x)));
        // Keep at least ~2–4 minutes (irregular) between runs of the same type.
        const minGap = (2 + ((i * 7919) % 120) / 60) * 60_000;
        const t = Math.max(startAt + y * span, last + minGap);
        last = t;
        return { ...r, scheduled_at: new Date(t).toISOString() };
      });
  }
  return out;
}
