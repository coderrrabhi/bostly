/**
 * Run count and timeframe planning for delivery curves. One source of truth
 * for the order page (auto time, custom-time guidance) and the schedule
 * generator, so the runs shown are the runs sent.
 */
export const MIN_RUN_GAP_MINUTES = 10;
export const TARGET_RUN_GAP_MINUTES = 20;
export const MAX_RUN_GAP_MINUTES = 45;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Views runs needed to draw a curve smoothly: grows with the views quantity. */
export function recommendedViewRuns(views: number): number {
  if (!(views > 0)) return 0;
  return clamp(Math.round(4 * Math.sqrt(views / 100)), 12, 96);
}

export type CurvePlan = { runs: number; minHours: number; maxHours: number; autoHours: number };

/** Runs plus the shortest/longest timeframe in which the selected curve stays smooth. */
export function curvePlan(views: number, timeFactor = 1): CurvePlan {
  const runs = recommendedViewRuns(views);
  if (!runs) return { runs: 0, minHours: 1, maxHours: 1, autoHours: 1 };
  const minHours = Math.max(1, Math.ceil((runs * MIN_RUN_GAP_MINUTES) / 60));
  const maxHours = Math.max(minHours, Math.ceil((runs * MAX_RUN_GAP_MINUTES) / 60));
  const autoHours = clamp(Math.round((runs * TARGET_RUN_GAP_MINUTES * timeFactor) / 60), minHours, maxHours);
  return { runs, minHours, maxHours, autoHours };
}

/** Runs that fit the window for one engagement (never below its per-run minimum). */
export function runsForWindow(type: string, quantity: number, hours: number, min: number): number {
  const perMin = Math.max(1, Math.floor(quantity / Math.max(1, min)));
  const windowMinutes = Math.max(15, hours * 60);
  if (/views?$/i.test(type)) {
    const lo = Math.ceil(windowMinutes / MAX_RUN_GAP_MINUTES);
    const hi = Math.max(1, Math.floor(windowMinutes / MIN_RUN_GAP_MINUTES));
    return Math.max(1, Math.min(perMin, clamp(recommendedViewRuns(quantity), lo, hi)));
  }
  return Math.max(1, Math.min(perMin, Math.floor(windowMinutes / TARGET_RUN_GAP_MINUTES), 60));
}


/**
 * Make every run quantity different (same total, never below `min`, never
 * above `max` when set). Run order by size is kept, so small starts stay
 * small. Returns null when the total cannot hold that many distinct runs.
 */
export function distinctQuantities(q: number[], min: number, max = 0): number[] | null {
  const n = q.length;
  const total = q.reduce((a, b) => a + b, 0);
  if (n <= 1) return [...q];
  if (n * min + (n * (n - 1)) / 2 > total) return null;
  const order = q.map((v, i) => i).sort((a, b) => q[a] - q[b] || a - b);
  const v = [...q];
  let prev = -Infinity;
  for (const i of order) { v[i] = Math.max(v[i], prev + 1, min); prev = v[i]; }
  let excess = v.reduce((a, b) => a + b, 0) - total;
  for (let guard = 0; excess > 0 && guard < 10000; guard += 1) {
    let moved = 0;
    for (let k = n - 1; k >= 0 && excess > 0; k -= 1) {
      const lo = k ? v[order[k - 1]] + 1 : min;
      const red = Math.min(excess, v[order[k]] - lo);
      if (red > 0) { v[order[k]] -= red; excess -= red; moved += red; }
    }
    if (!moved) break;
  }
  if (excess > 0) return null;
  if (max > 0 && v.some((x) => x > max)) return null;
  return v;
}

export type SmoothRun = { runNumber: number; timePercent: number; quantity: number; cumulativeQuantity: number };

/**
 * Spread `total` over `runs` slots with all-different gaps following the cumulative
 * curve `cum(x)` (x and result in 0-100). Every slot gets the minimum, the
 * rest follows the curve's mass with a small (±8%) variation, so the planned
 * run count is exactly the count sent. Every run has a different quantity.
 * Runs start at 0% and all finish before 100% of the window. Totals exact.
 */
export function smoothSchedule(
  cum: (x: number) => number, total: number, runs: number, min: number, rng: () => number = Math.random,
): SmoothRun[] {
  min = Math.max(1, min);
  if (total <= 0) return [];
  let n = Math.max(1, Math.min(Math.floor(runs), Math.floor(total / min)));
  while (n > 1 && n * min + (n * (n - 1)) / 2 > total) n -= 1;
  // Run times: every gap between runs is different (random 0.7x-1.3x of the
  // average gap, never repeating), first run at 0%, all inside the window.
  const gapW: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    let w = 0.7 + rng() * 0.6;
    for (let g = 0; g < 20 && gapW.some((x) => Math.abs(x - w) < 0.004); g += 1) w = 0.7 + rng() * 0.6;
    gapW.push(w);
  }
  const span = n > 1 ? ((n - 0.5) / n) * 100 : 0;
  const wSum = gapW.reduce((a, b) => a + b, 0) || 1;
  const times: number[] = [0];
  for (const w of gapW) times.push(times[times.length - 1] + (w / wSum) * span);
  // Curve mass for each run is taken at its real time, so the drawn curve follows the selected shape.
  let peak = 0;
  let mass: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const edge = i === n - 1 ? 100 : (times[i] + times[i + 1]) / 2;
    const next = Math.max(peak, clamp(cum(edge), 0, 100));
    mass.push(next - peak);
    peak = next;
  }
  // Soften sharp bends of the curve into short ramps (no sudden jumps).
  for (let pass = 0; pass < 2 && n > 2; pass += 1) {
    mass = mass.map((m, i) => 0.25 * (mass[i - 1] ?? m) + 0.5 * m + 0.25 * (mass[i + 1] ?? m));
  }
  const massTotal = mass.reduce((a, m) => a + m, 0) || 1;
  const rest = total - n * min;
  const q: number[] = [];
  let given = 0;
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    acc += mass[i];
    const share = (mass[i] / massTotal) * rest;
    const want = i === n - 1 ? rest - given : Math.round((acc / massTotal) * rest - given + share * (rng() - 0.5) * 0.16);
    const add = Math.max(0, Math.min(want, rest - given));
    given += add;
    q.push(min + add);
  }
  const qs = distinctQuantities(q, min) ?? q;
  let sent = 0;
  return qs.map((quantity, i) => {
    sent += quantity;
    return { runNumber: i + 1, timePercent: Math.min(99.9, times[i]), quantity, cumulativeQuantity: sent };
  });
}

/**
 * Same rule the server applies at order placement: every run of one
 * engagement gets a different quantity (total exact, never below `min`).
 * When the total is too small for that many distinct runs, the smallest run
 * is merged into its neighbour until it fits. Runs are renumbered.
 */
export function distinctRunList<T extends { quantity: number; runNumber: number }>(runs: T[], min: number, max = 0): T[] {
  let list = runs.filter((r) => r.quantity > 0).map((r) => ({ ...r }));
  for (;;) {
    const v = distinctQuantities(list.map((r) => r.quantity), Math.max(1, min), max);
    if (v) return list.map((r, i) => ({ ...r, quantity: v[i], runNumber: i + 1 }));
    if (list.length <= 1) return list.map((r, i) => ({ ...r, runNumber: i + 1 }));
    let si = 0;
    list.forEach((r, i) => { if (r.quantity < list[si].quantity) si = i; });
    const into = si === list.length - 1 ? si - 1 : si + 1;
    list[into] = { ...list[into], quantity: list[into].quantity + list[si].quantity };
    list.splice(si, 1);
  }
}
