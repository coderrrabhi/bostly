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

export type SmoothRun = { runNumber: number; timePercent: number; quantity: number; cumulativeQuantity: number };

/**
 * Spread `total` over `runs` evenly spaced slots following the cumulative
 * curve `cum(x)` (x and result in 0-100). Each run carries the curve's mass
 * for its interval with a small (±8%) variation; the error is carried into
 * the next run so delivery tracks the curve with no spikes. Runs start at 0%
 * and all finish before 100% of the window. Totals are exact.
 */
export function smoothSchedule(
  cum: (x: number) => number, total: number, runs: number, min: number, rng: () => number = Math.random,
): SmoothRun[] {
  const n = Math.max(1, Math.floor(runs));
  min = Math.max(1, min);
  if (total <= 0) return [];
  // Monotonic cumulative target (some curves dip, delivery cannot go back).
  let peak = 0;
  let mass: number[] = [];
  for (let i = 1; i <= n; i += 1) {
    const next = Math.max(peak, clamp(cum((i / n) * 100), 0, 100));
    mass.push(next - peak);
    peak = next;
  }
  // Soften sharp bends of the curve into short ramps (no sudden jumps).
  for (let pass = 0; pass < 2 && n > 2; pass += 1) {
    mass = mass.map((m, i) => 0.25 * (mass[i - 1] ?? m) + 0.5 * m + 0.25 * (mass[i + 1] ?? m));
  }
  const massTotal = mass.reduce((a, m) => a + m, 0) || 1;
  const target: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    acc += mass[i];
    target.push(i === n - 1 ? total : (acc / massTotal) * total);
  }
  const out: SmoothRun[] = [];
  let sent = 0;
  for (let i = 0; i < n; i += 1) {
    const last = i === n - 1;
    const mass = target[i] - (i ? target[i - 1] : 0);
    let q = last ? total - sent : Math.round(target[i] - sent + mass * (rng() - 0.5) * 0.16);
    q = Math.max(0, Math.min(q, total - sent));
    if (!last && q < min) continue; // carried into the next run
    if (!last && total - sent - q > 0 && total - sent - q < min) q = total - sent;
    if (q <= 0) continue;
    const jitter = i === 0 ? 0 : (rng() - 0.5) * 0.4;
    sent += q;
    out.push({ runNumber: out.length + 1, timePercent: Math.max(0, ((i + jitter) / n) * 100), quantity: q, cumulativeQuantity: sent });
    if (sent >= total) break;
  }
  if (out.length > 1 && out[out.length - 1].quantity < min) {
    const tail = out.pop()!;
    out[out.length - 1].quantity += tail.quantity;
    out[out.length - 1].cumulativeQuantity = total;
  }
  return out;
}
