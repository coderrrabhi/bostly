import { CURVE_PRESETS, type CurvePreset } from '@/lib/curve-to-schedule';

/**
 * Mass Order curve picker: the seven real-Reel-shaped curves, plus "auto"
 * (every reel keeps its own unique seeded curve, the previous behaviour).
 */
export const MASS_CURVE_IDS = [
  'smooth-s-curve',
  'early-peak',
  'logarithmic-fade',
  'sunrise-curve',
  'snowball',
  'zen-flow',
  'slow-steady',
] as const;

export const MASS_CURVE_AUTO = 'auto';

export function massCurveChoices(): CurvePreset[] {
  return CURVE_PRESETS.filter((p) => (MASS_CURVE_IDS as readonly string[]).includes(p.id));
}

export function massCurvePreset(id: string): CurvePreset | undefined {
  return CURVE_PRESETS.find((p) => p.id === id);
}

/**
 * Turn a preset's cumulative points (x = time %, y = delivered %) into a
 * monotonic time-warp compatible with applyCurveStyle: a run sitting at
 * original time fraction x is moved to the time where the curve has
 * delivered fraction x (the inverse of the cumulative curve), so the
 * delivery follows the selected curve's shape.
 */
export function warpForPreset(presetId: string): ((x: number) => number) | null {
  const preset = massCurvePreset(presetId);
  if (!preset) return null;
  const pts = preset
    .getPoints('views')
    .map((p) => ({ t: p.x / 100, c: p.y / 100 }))
    .sort((a, b) => a.c - b.c);
  if (pts.length < 2) return null;
  return (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    if (c <= pts[0].c) return pts[0].t;
    for (let i = 1; i < pts.length; i++) {
      if (c <= pts[i].c) {
        const { c: c0, t: t0 } = pts[i - 1];
        const { c: c1, t: t1 } = pts[i];
        const f = c1 > c0 ? (c - c0) / (c1 - c0) : 0;
        return t0 + f * (t1 - t0);
      }
    }
    return 1;
  };
}
