import type { Rng, ShapeRun } from "./runShaping";

/**
 * Views-linked engagement runs (likes, saves, shares, reposts — not comments).
 * Every engagement run is sized from the Views run it follows: it carries the
 * order's engagement % of that Views run (bundle ratio), so bigger Views runs
 * get bigger engagement runs and the selected curve is followed exactly.
 * Units below the per-run minimum carry to the next Views run. Rounding left
 * over at the end goes only to the curve's peak runs (largest Views runs), a
 * small share per run, so there is never a spike and no add-on on every run.
 */
const t = (r: ShapeRun) => Date.parse(r.scheduled_at);
const sortByTime = <T extends ShapeRun>(runs: T[]) => [...runs].sort((a, b) => t(a) - t(b));

export const isLinkedEngagement = (type: string) => !/views?$/i.test(type) && !/comment/i.test(type);

export function linkRunsToViews<T extends ShapeRun>(opts: {
  views: ShapeRun[]; template: T; total: number; min: number; max: number; rng?: Rng;
}): T[] | null {
  // All runs must differ, so k runs need at least k*min + k(k-1)/2 units. When
  // the views curve has more runs than that allows, each engagement run covers
  // a few Views runs (bigger threshold) and still follows the curve.
  const min0 = Math.max(1, Math.floor(opts.min));
  for (let floor = min0, tries = 0; tries < 60; tries += 1, floor = Math.ceil(floor * 1.25) + 1) {
    const res = linkOnce({ ...opts, carry: floor });
    if (res) return res;
  }
  return null;
}

function linkOnce<T extends ShapeRun>(opts: {
  views: ShapeRun[]; template: T; total: number; min: number; max: number; rng?: Rng; carry: number;
}): T[] | null {
  const rng = opts.rng ?? Math.random;
  const views = sortByTime(opts.views).filter((r) => r.quantity_to_send > 0);
  const viewsTotal = views.reduce((a, r) => a + r.quantity_to_send, 0);
  const total = Math.floor(opts.total);
  const min = Math.max(1, Math.floor(opts.min));
  const max = Math.max(0, Math.floor(opts.max));
  if (!views.length || !(viewsTotal > 0) || total < min) return null;
  const ratio = total / viewsTotal;

  const out: Array<{ idx: number; q: number }> = [];
  let acc = 0;
  let sent = 0;
  for (let i = 0; i < views.length; i += 1) {
    acc += ratio * views[i].quantity_to_send * (0.94 + rng() * 0.12);
    if (acc < Math.max(min, opts.carry)) continue;
    let q = Math.floor(acc);
    if (max > 0) q = Math.min(q, max);
    if (q < min) continue;
    out.push({ idx: i, q });
    sent += q;
    acc -= q;
  }
  if (!out.length) {
    const peak = views.reduce((b, r, i) => (r.quantity_to_send > views[b].quantity_to_send ? i : b), 0);
    out.push({ idx: peak, q: total });
    sent = total;
  }

  // Remainder (+ or -) goes to the peak runs only, ~12% of a run at most per pass.
  let diff = total - sent;
  const peaks = [...out.keys()].sort((a, b) => views[out[b].idx].quantity_to_send - views[out[a].idx].quantity_to_send);
  // Each run moves at most ~20% of its own size, one unit per step, peaks first.
  const moved = out.map(() => 0);
  for (let pass = 0; diff !== 0 && pass < 10000; pass += 1) {
    let changed = false;
    for (const k of peaks) {
      if (diff === 0) break;
      const cap = Math.max(1, Math.round(out[k].q * 0.2));
      if (Math.abs(moved[k]) >= cap) continue;
      if (diff > 0 && (max <= 0 || out[k].q < max)) { out[k].q += 1; moved[k] += 1; diff -= 1; changed = true; }
      else if (diff < 0 && out[k].q - 1 >= min) { out[k].q -= 1; moved[k] -= 1; diff += 1; changed = true; }
      if (pass % 3 !== 2) break; // favour the biggest peaks, then widen
    }
    if (!changed && pass % 3 === 2) break;
  }
  if (diff !== 0) return null;

  // Every run carries a different quantity (rank order kept, so the curve shape stays).
  const distinct = makeDistinct(out.map((o) => o.q), min, max, out.map((o) => views[o.idx].quantity_to_send));
  if (!distinct) return null;
  distinct.forEach((q, k) => { out[k].q = q; });

  // Each run goes out 1-6 minutes after its Views run (never at or past the next Views run).
  let prev = -Infinity;
  return out.map(({ idx, q }) => {
    const at = t(views[idx]);
    const next = idx + 1 < views.length ? t(views[idx + 1]) : at + 10 * 60_000;
    const room = Math.max(60_000, Math.min(6 * 60_000, next - at - 60_000));
    let when = at + 60_000 + Math.floor(rng() * Math.max(1, room - 60_000));
    if (when <= prev) when = prev + 60_000;
    prev = when;
    return { ...opts.template, scheduled_at: new Date(when).toISOString(), quantity_to_send: q, base_quantity: q, variance_applied: 0, peak_multiplier: 1 };
  });
}

/**
 * Removes unusual Views spikes/dips: a run may differ at most ~15% from the
 * average of its neighbours. Moved units are spread back along the curve in
 * proportion to run size, so the total stays exact and the shape stays natural.
 * The first two runs (small start) are left untouched.
 */
export function smoothViewsSpikes<T extends ShapeRun>(runs: T[], min: number, max: number): T[] {
  const list = sortByTime(runs).map((r) => ({ ...r }));
  const n = list.length;
  if (n < 5) return list;
  const q = list.map((r) => r.quantity_to_send);
  const total = q.reduce((a, b) => a + b, 0);
  for (let i = 2; i < n - 1; i += 1) {
    const base = (q[i - 1] + q[i + 1]) / 2;
    q[i] = Math.round(Math.min(base * 1.15, Math.max(base * 0.85, q[i])));
  }
  let diff = total - q.reduce((a, b) => a + b, 0);
  const body = q.slice(2).reduce((a, b) => a + b, 0) || 1;
  for (let i = 2; i < n && diff !== 0; i += 1) {
    const share = Math.trunc((diff * q[i]) / body);
    q[i] += share;
  }
  diff = total - q.reduce((a, b) => a + b, 0);
  const order = [...q.keys()].slice(2).sort((a, b) => q[b] - q[a]);
  for (let k = 0; diff !== 0 && k < order.length * 4; k += 1) {
    const i = order[k % order.length];
    const step = diff > 0 ? 1 : -1;
    if (q[i] + step >= min && (max <= 0 || q[i] + step <= max)) { q[i] += step; diff -= step; }
  }
  if (diff !== 0 || q.some((x) => x < min || (max > 0 && x > max))) return list;
  const dq = makeDistinct(q, min, max);
  if (dq) for (let i = 0; i < n; i += 1) q[i] = dq[i];
  return list.map((r, i) => ({ ...r, quantity_to_send: q[i], base_quantity: q[i] }));
}

/**
 * Makes every value different while keeping their rank order (bigger stays
 * bigger) and the exact total. Extra/removed units go to the largest values.
 * Returns null when distinct values cannot fit the total / min / max.
 */
export function makeDistinct(values: number[], min: number, max: number, key?: number[]): number[] | null {
  const n = values.length;
  if (!n) return [];
  const total = values.reduce((a, b) => a + b, 0);
  if (n * min + (n * (n - 1)) / 2 > total) return null;
  const order = [...values.keys()].sort((a, b) => values[a] - values[b] || (key ? key[a] - key[b] : 0) || a - b);
  const s = order.map((i) => values[i]);
  s[0] = Math.max(min, s[0]);
  for (let r = 1; r < n; r += 1) s[r] = Math.max(s[r], s[r - 1] + 1);
  let diff = total - s.reduce((a, b) => a + b, 0);
  // Remove surplus from the top, keeping s strictly increasing.
  for (let guard = 0; diff < 0 && guard < 1_000_000; guard += 1) {
    let moved = false;
    for (let r = n - 1; r >= 0 && diff < 0; r -= 1) {
      const floor = r === 0 ? min : s[r - 1] + 1;
      if (s[r] - 1 >= floor) { s[r] -= 1; diff += 1; moved = true; }
    }
    if (!moved) return null;
  }
  // Add shortfall to the top run(s) only.
  for (let r = n - 1; diff > 0; r = r === 0 ? n - 1 : r - 1) {
    const cap = max > 0 ? Math.min(max, r === n - 1 ? Infinity : s[r + 1] - 1) : r === n - 1 ? Infinity : s[r + 1] - 1;
    const add = Math.min(diff, cap - s[r]);
    if (add > 0) { s[r] += add; diff -= add; }
    else if (r === 0) return null;
  }
  if (max > 0 && s[n - 1] > max) return null;
  const outv = new Array<number>(n);
  order.forEach((i, r) => { outv[i] = s[r]; });
  return outv;
}

/**
 * Every gap between consecutive runs is different (compared in whole seconds,
 * at least 60s). A run is nudged by a few seconds when its gap repeats; the
 * first run and the overall window stay the same.
 */
export function distinctGaps<T extends ShapeRun>(runs: T[]): T[] {
  const list = sortByTime(runs).map((r) => ({ ...r }));
  if (list.length < 3) return list;
  const ts = list.map((r) => Math.floor(t(r) / 1000));
  const seen = new Set<number>();
  for (let i = 1; i < ts.length; i += 1) {
    const g = ts[i] - ts[i - 1];
    let pick = 0;
    if (seen.has(g) || g < 60) {
      for (let k = 1; k <= 600; k += 1) {
        const tryD = [k, -k];
        const ok = tryD.find((d) => {
          const ng = g + d;
          if (ng < 60 || seen.has(ng)) return false;
          return i === ts.length - 1 ? d <= 0 || true : ts[i + 1] - (ts[i] + d) >= 60;
        });
        if (ok !== undefined) { pick = ok; break; }
      }
    }
    ts[i] += pick;
    seen.add(ts[i] - ts[i - 1]);
  }
  return list.map((r, i) => ({ ...r, scheduled_at: new Date(ts[i] * 1000 + (t(r) % 1000 + 1000) % 1000).toISOString() }));
}

/**
 * Keeps the runs the customer saw in the order preview (same count, same
 * quantities, same small-to-big curve) and only times each run behind the
 * Views runs, so engagement never gets ahead of its bundle % of Views.
 * Returns null when the preview runs are unusable (wrong total, out of limits).
 */
export function alignPreviewToViews<T extends ShapeRun>(opts: {
  views: ShapeRun[]; runs: T[]; total: number; min: number; max: number; rng?: Rng;
}): T[] | null {
  const rng = opts.rng ?? Math.random;
  const views = sortByTime(opts.views).filter((r) => r.quantity_to_send > 0);
  const runs = sortByTime(opts.runs).filter((r) => r.quantity_to_send > 0);
  const min = Math.max(1, Math.floor(opts.min));
  const max = Math.max(0, Math.floor(opts.max));
  const total = Math.floor(opts.total);
  const viewsTotal = views.reduce((a, r) => a + r.quantity_to_send, 0);
  if (!views.length || !runs.length || !(viewsTotal > 0)) return null;
  let q = runs.map((r) => Math.floor(r.quantity_to_send));
  if (q.reduce((a, b) => a + b, 0) !== total || q.some((x) => x < min || (max > 0 && x > max))) return null;
  if (new Set(q).size !== q.length) {
    const d = makeDistinct(q, min, max, q.map((_, i) => i));
    if (d) q = d;
  }
  const ratio = total / viewsTotal;
  const cumV: number[] = [];
  views.reduce((a, r, i) => (cumV[i] = a + r.quantity_to_send), 0);
  let sent = 0;
  let vi = 0;
  let prev = -Infinity;
  return runs.map((run, j) => {
    sent += q[j];
    while (vi < views.length - 1 && (ratio * cumV[vi] < sent * 0.98 || t(views[vi + 1]) <= t(run))) vi += 1;
    const at = t(views[vi]);
    const next = vi + 1 < views.length ? t(views[vi + 1]) : at + 10 * 60_000;
    const room = Math.max(60_000, Math.min(6 * 60_000, next - at - 60_000));
    let when = at + 60_000 + Math.floor(rng() * Math.max(1, room - 60_000));
    if (when <= prev) when = prev + 60_000 + Math.floor(rng() * 30_000);
    prev = when;
    return { ...run, scheduled_at: new Date(when).toISOString(), quantity_to_send: q[j], base_quantity: q[j], variance_applied: 0, peak_multiplier: 1 };
  });
}
