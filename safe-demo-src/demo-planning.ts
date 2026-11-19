import { engagementTypes, simulateQuantity, type DemoValues, type Engagement } from './safe-demo';
export type RatioType = Exclude<Engagement, 'Views'>;
export type Ratios = Record<RatioType, { min: string; max: string }>;
export const ratioTypes: RatioType[] = ['Likes', 'Shares', 'Saves', 'Comments', 'Reposts'];
export const defaultRatios: Ratios = { Likes: { min: '2.1', max: '5' }, Shares: { min: '0.1', max: '0.5' }, Saves: { min: '0.2', max: '0.6' }, Comments: { min: '0.03', max: '0.2' }, Reposts: { min: '0.03', max: '0.25' } };
export const patterns = ['Viral Surge', 'Steady Growth', 'Natural S-Curve', 'Early Boost', 'Evening Prime', 'Double Wave Peak', 'Slow Burn', 'Algorithmic Drip', 'Morning Kick', 'High-Velocity Explode'];
export function ratioRange(views: string, min: string, max: string) {
  const v = Number(views), lo = Number(min), hi = Number(max);
  if (!views.trim() || !min.trim() || !max.trim() || !Number.isSafeInteger(v) || v < 0 || v > 1_000_000 || !Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi > 100 || lo > hi) throw new Error('Use whole views from 0 to 1,000,000 and percentages 0–100 with Min ≤ Max.');
  return { min: Math.ceil(v * lo / 100 - 1e-9), max: Math.floor(v * hi / 100 + 1e-9) };
}
export function fillRatios(views: string, ratios: Ratios, random: () => number = Math.random): DemoValues {
  const values = { Views: views } as DemoValues;
  for (const type of ratioTypes) {
    const range = ratioRange(views, ratios[type].min, ratios[type].max);
    if (range.min > range.max) throw new Error(`${type}: no whole quantity fits this range. Increase views or widen percentages.`);
    values[type] = String(range.min + Math.floor(random() * (range.max - range.min + 1)));
  }
  return values;
}
export function curveWeights(pattern: number, count: number, seed = 1, drawn: number[] = []) {
  return Array.from({ length: count }, (_, i) => {
    const x = count === 1 ? 0.5 : i / (count - 1);
    if (drawn.length) return Math.max(0.05, drawn[Math.round(x * (drawn.length - 1))] ?? 0.5);
    const shapes = [Math.exp(-((x - .4) ** 2) * 24), .5 + x * .2, .15 + Math.sin(x * Math.PI), 1.1 - x, .15 + x ** 2, .3 + Math.sin(x * Math.PI * 3) ** 2, .1 + x, .5 + Math.sin((i + seed) * 2.4) ** 2, .2 + Math.exp(-((x - .2) ** 2) * 40), .15 + x ** 3 * 2];
    return Math.max(.05, (shapes[pattern % 10] ?? .5) * (.85 + Math.abs(Math.sin(seed * 12.3 + i * 7.1)) * .3));
  });
}
export function demoTiming(views: string, pattern: number, customHours?: string) {
  const v = Number(views);
  if (!views.trim() || !Number.isSafeInteger(v) || v < 0 || v > 1_000_000) throw new Error('Enter valid whole views first.');
  // A demo-only heuristic, not a real delivery estimate.
  const factor = [1, 1, 1.1, .9, 1.15, 1.1, 1.3, 1.2, .95, .85][pattern % 10] ?? 1;
  const hours = customHours === undefined ? Math.min(48, Math.max(1, Math.round((1.8 + v / 1250) * factor * 2) / 2)) : Number(customHours);
  if (customHours === '' || !Number.isFinite(hours) || hours < .5 || hours > 48) throw new Error('Demo timeframe must be between 0.5 and 48 hours.');
  const runs = Math.min(100, Math.max(1, Math.round(hours * 3)));
  return { hours, runs, intervalMinutes: Math.round(hours * 60 / runs) };
}
export function shapedQuantity(quantity: string, minimum: string, requestedRuns: number, pattern: number, seed: number, drawn: number[] = []) {
  const base = simulateQuantity(quantity, minimum, requestedRuns);
  if (base.error || !base.runs.length) return base;
  const total = Number(quantity), min = Number(minimum), count = base.runs.length;
  const weights = curveWeights(pattern, count, seed, drawn), sum = weights.reduce((a, b) => a + b, 0);
  const extra = total - min * count;
  const raw = weights.map(w => extra * w / sum), runs = raw.map(v => min + Math.floor(v));
  const remainder = total - runs.reduce((a, b) => a + b, 0);
  const ranked = raw.map((v, i) => ({ i, fraction: v % 1 })).sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i++) { const entry = ranked[i]; if (entry) runs[entry.i] = (runs[entry.i] ?? min) + 1; }
  return { error: null, runs };
}