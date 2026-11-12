export type ShapeRun = {
  scheduled_at: string;
  quantity_to_send: number;
  base_quantity?: number;
  variance_applied?: number;
  peak_multiplier?: number;
};
export type Rng = () => number;

const isViews = (type: string) => /views?$/i.test(type);
const randInt = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const byTime = <T extends ShapeRun>(runs: T[]) =>
  [...runs].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
const withQty = <T extends ShapeRun>(run: T, q: number): T => ({ ...run, quantity_to_send: q, base_quantity: q });

/**
 * My Bundles minimum is the per-run floor the customer chose; it wins over
 * the provider service minimum. Without a bundle minimum the service minimum
 * (or 1) applies.
 */
export function runMinimum(bundleMin: unknown, serviceMin: unknown): number {
  const b = Math.floor(Number(bundleMin) || 0);
  if (b > 0) return b;
  return Math.max(1, Math.floor(Number(serviceMin) || 0));
}

/** Smallest positive cap among the bundle and provider maximums (0 = none). */
export function runMaximum(...caps: unknown[]): number {
  const valid = caps.map((c) => Math.floor(Number(c) || 0)).filter((c) => c > 0);
  return valid.length ? Math.min(...valid) : 0;
}

/** Largest first run that still counts as a "small start" for this engagement. */
export function smallStartCap(total: number, runCount: number, min: number, max: number): number {
  const avg = total / Math.max(1, runCount);
  const cap = min + Math.max(2, Math.round(avg * 0.35));
  return max > 0 ? Math.min(cap, max) : cap;
}

/**
 * Engagements with tiny per-run sizes (e.g. 96 saves over 51 slots = 1-2 each)
 * are regrouped along the same curve into runs of mixed sizes between the
 * minimum and ~4x the minimum (1,3,2,5,1,4...). A run is only emitted at a slot
 * once the curve has accumulated its quantity, so delivery never runs ahead of
 * the selected curve. Totals are exact; the first run is small.
 */
export function mixSmallRuns<T extends ShapeRun>(runs: T[], min: number, max: number, rng: Rng): T[] {
  const sorted = byTime(runs).filter((r) => r.quantity_to_send > 0);
  const total = sorted.reduce((a, r) => a + r.quantity_to_send, 0);
  if (sorted.length < 3 || total < min * 3) return sorted;
  const avg = total / sorted.length;
  if (avg >= min * 4) return sorted;
  let hi = Math.max(min + 2, min * 4);
  if (max > 0) hi = Math.min(hi, max);
  if (hi <= min) return sorted;
  const startHi = Math.min(hi, min + Math.max(1, Math.floor((hi - min) / 2)));

  let prev = -1;
  const draw = (lo: number, top: number) => {
    let v = randInt(rng, lo, top);
    if (v === prev && top > lo) v = v === top ? v - 1 : v + 1;
    prev = v;
    return v;
  };
  const out: T[] = [];
  let acc = 0;
  let target = draw(min, startHi);
  for (const run of sorted) {
    acc += run.quantity_to_send;
    if (acc >= target) {
      out.push(withQty(run, target));
      acc -= target;
      target = draw(min, hi);
    }
  }
  if (out.length === 0) return [withQty(sorted[sorted.length - 1], total)];
  if (acc >= min) {
    out.push(withQty(sorted[sorted.length - 1], acc));
    acc = 0;
  }
  // Fold any leftover below the minimum into later runs with room.
  for (let i = out.length - 1; acc > 0 && i >= 0; i -= 1) {
    const room = max > 0 ? max - out[i].quantity_to_send : acc;
    const add = Math.min(room, acc);
    if (add > 0 && (i > 0 || out.length === 1)) {
      out[i] = withQty(out[i], out[i].quantity_to_send + add);
      acc -= add;
    }
  }
  if (acc > 0) out[0] = withQty(out[0], out[0].quantity_to_send + acc);
  // Merge runs that landed on the same slot.
  const merged: T[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last.scheduled_at === r.scheduled_at && (max <= 0 || last.quantity_to_send + r.quantity_to_send <= max)) {
      merged[merged.length - 1] = withQty(last, last.quantity_to_send + r.quantity_to_send);
    } else merged.push(r);
  }
  return merged;
}

/** Move quantity from the first run into later runs so it starts small. */
export function startSmall<T extends ShapeRun>(runs: T[], min: number, max: number, rng: Rng): T[] {
  const sorted = byTime(runs);
  if (sorted.length < 2) return sorted;
  const total = sorted.reduce((a, r) => a + r.quantity_to_send, 0);
  const cap = smallStartCap(total, sorted.length, min, max);
  if (sorted[0].quantity_to_send <= cap) return sorted;
  const first = randInt(rng, min, cap);
  let surplus = sorted[0].quantity_to_send - first;
  const out = sorted.map((r) => ({ ...r }));
  out[0] = withQty(out[0], first);
  // Spread the surplus over the following runs in proportion to their size,
  // so the curve keeps its shape instead of spiking right after the start.
  const rest = out.slice(1);
  const restTotal = rest.reduce((a, r) => a + r.quantity_to_send, 0) || rest.length;
  const share = surplus;
  for (let i = 1; i < out.length && surplus > 0; i += 1) {
    const want = Math.min(surplus, Math.floor((share * (out[i].quantity_to_send || 1)) / restTotal));
    const room = max > 0 ? Math.max(0, max - out[i].quantity_to_send) : want;
    const add = Math.min(room, want);
    if (add > 0) { out[i] = withQty(out[i], out[i].quantity_to_send + add); surplus -= add; }
  }
  for (let i = 1; surplus > 0 && i < out.length; i += 1) {
    const room = max > 0 ? max - out[i].quantity_to_send : surplus;
    const add = Math.min(room, surplus);
    if (add > 0) { out[i] = withQty(out[i], out[i].quantity_to_send + add); surplus -= add; }
  }
  return surplus > 0 ? sorted : out;
}

/**
 * Make the first run's quantity differ from the starting quantities used on
 * this customer's recent Reels (most recent first). Units move only between
 * the first and second run, so totals, minimums and maximums are kept. When
 * every possible value was used recently, the value used longest ago is
 * picked, never the most recent one if any alternative exists.
 */
export function differentStart<T extends ShapeRun>(
  runs: T[], min: number, max: number, recentStarts: number[], preferredMax?: number, rng: Rng = Math.random,
): T[] {
  const sorted = byTime(runs);
  if (sorted.length < 2 || recentStarts.length === 0) return sorted;
  const [a, b] = [sorted[0].quantity_to_send, sorted[1].quantity_to_send];
  const lo = Math.max(min, max > 0 ? a + b - max : min);
  const hi = Math.min(max > 0 ? max : Infinity, a + b - min);
  if (hi < lo) return sorted;
  const used = new Map<number, number>();
  recentStarts.forEach((v, i) => { if (!used.has(v)) used.set(v, i); });
  if (!used.has(a)) return sorted;
  // Pick a random unused value: views/large runs move by a visible 3-15%,
  // small-start runs choose any unused small value.
  const pick = (top: number): number | null => {
    const spread = preferredMax === undefined ? Math.max(3, Math.round(a * 0.15)) : Infinity;
    const near = preferredMax === undefined ? Math.max(1, Math.round(a * 0.03)) : 1;
    const pool: number[] = [];
    for (let v = Math.max(lo, a - spread); v <= Math.min(top, a + spread); v += 1) {
      if (!used.has(v) && Math.abs(v - a) >= near) pool.push(v);
    }
    if (!pool.length) {
      for (let v = lo; v <= top; v += 1) if (!used.has(v) && v !== a) pool.push(v);
      if (!pool.length) return null;
      pool.sort((x, y) => Math.abs(x - a) - Math.abs(y - a));
      return pool[0];
    }
    return pool[Math.floor(rng() * pool.length)];
  };
  const softTop = Math.min(hi, preferredMax ?? hi);
  let v = pick(softTop);
  if (v === null && preferredMax === undefined) v = pick(hi);
  if (v === null) {
    let best = a; let bestAge = used.get(a) ?? 0;
    for (let x = lo; x <= softTop; x += 1) {
      const age = used.get(x) ?? Infinity;
      if (age > bestAge) { best = x; bestAge = age; }
    }
    v = best;
  }
  if (v === a) return sorted;
  const out = sorted.map((r) => ({ ...r }));
  out[0] = withQty(out[0], v);
  out[1] = withQty(out[1], a + b - v);
  return out;
}

/** Merge any run below the minimum into the largest run (totals unchanged). */
export function mergeBelowMinimum<T extends ShapeRun>(runs: T[], min: number): T[] {
  const list = byTime(runs).filter((r) => r.quantity_to_send > 0).map((r) => ({ ...r }));
  const big = list.filter((r) => r.quantity_to_send >= min);
  const small = list.filter((r) => r.quantity_to_send < min);
  if (!small.length) return list;
  const total = list.reduce((a, r) => a + r.quantity_to_send, 0);
  if (!big.length) return list.length ? [withQty(list[list.length - 1], total)] : list;
  for (const s of small) {
    const idx = big.reduce((bi, x, i) => (x.quantity_to_send > big[bi].quantity_to_send ? i : bi), 0);
    big[idx] = withQty(big[idx], big[idx].quantity_to_send + s.quantity_to_send);
  }
  return big;
}

/**
 * Final per-engagement run shaping used by single, mass and refill orders:
 * non-view engagements start small and mix small/large runs; every
 * engagement (views included) starts with a quantity not used on recent Reels.
 */
export function shapeEngagementRuns<T extends ShapeRun>(opts: {
  type: string; runs: T[]; min: number; max: number; recentStarts?: number[]; rng?: Rng;
}): T[] {
  const rng = opts.rng ?? Math.random;
  const min = Math.max(1, opts.min);
  let runs = mergeBelowMinimum(opts.runs, min);
  const total = runs.reduce((a, r) => a + r.quantity_to_send, 0);
  let preferredMax: number | undefined;
  if (!isViews(opts.type)) {
    runs = mixSmallRuns(runs, min, opts.max, rng);
    runs = startSmall(runs, min, opts.max, rng);
    preferredMax = smallStartCap(total, runs.length, min, opts.max);
  }
  runs = differentStart(runs, min, opts.max, opts.recentStarts ?? [], preferredMax, rng);
  return runs;
}
