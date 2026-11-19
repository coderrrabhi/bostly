export interface ProgressRun {
  id: string;
  run_number: number;
  scheduled_at: string;
  quantity_to_send: number;
  status: string;
  engagement_type: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  provider_remains?: number | null;
  provider_order_id?: string | null;
  drift_adjustment?: number | null;
}

export const ENGAGEMENT_ORDER = ['views', 'likes', 'comments', 'saves', 'shares', 'reposts'];

/** A cancelled/target-met run is not evidence of delivered quantity. */
export function confirmedDelivery(run: ProgressRun): number {
  if (!run.provider_order_id) return 0;
  const status = run.status.toLowerCase().trim();
  if (['pending', 'dispatching', 'merged', 'dispatch_uncertain'].includes(status)) return 0;
  if (typeof run.provider_remains === 'number' && Number.isFinite(run.provider_remains)) {
    return Math.max(0, run.quantity_to_send - run.provider_remains);
  }
  return status === 'completed' ? Math.max(0, run.quantity_to_send) : 0;
}

export type ProgressPoint = { timestamp: number; [key: string]: number | null };

/** Compare cumulative delivery with the saved schedule, using elapsed time only.
 * Actual series are normalized by adjusted quantity; the plan uses pre-drift
 * quantities. This compares timing/shape without counting add-ons as a new curve.
 * Partial readings are recorded at their update time, not backdated to dispatch.
 * Historical poll readings are unavailable, so this is a snapshot comparison.
 */
export function buildDeliveryProgress(runs: ProgressRun[], now = Date.now()) {
  const valid = runs.filter(r => Number.isFinite(Date.parse(r.scheduled_at)) && r.quantity_to_send > 0 && r.status !== 'merged');
  const types = [...new Set(valid.map(r => r.engagement_type))].sort((a, b) => {
    const rank = (t: string) => { const i = ENGAGEMENT_ORDER.indexOf(t); return i < 0 ? 99 : i; };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  if (!valid.length) return { chartData: [] as ProgressPoint[], types, score: null as number | null, scores: {} as Record<string, number | null>, delivered: {} as Record<string, number> };
  const totals: Record<string, number> = {};
  const baseTotals: Record<string, number> = {};
  const events: Array<{ at: number; type: string; planned: number; delivered: number }> = [];
  for (const run of valid) {
    const type = run.engagement_type;
    const base = Math.max(0, run.quantity_to_send - (run.drift_adjustment || 0));
    totals[type] = (totals[type] || 0) + run.quantity_to_send;
    baseTotals[type] = (baseTotals[type] || 0) + base;
    events.push({ at: Date.parse(run.scheduled_at), type, planned: base, delivered: 0 });
    const delivered = confirmedDelivery(run);
    const readingAt = Date.parse(run.completed_at || run.updated_at || run.started_at || '');
    if (delivered > 0 && Number.isFinite(readingAt) && readingAt <= now) {
      events.push({ at: readingAt, type, planned: 0, delivered });
    }
  }
  events.sort((a, b) => a.at - b.at);
  const first = events[0];
  if (!first) return { chartData: [], types, score: null, scores: {}, delivered: {} };
  const start = first.at - 1000;
  const times = [...new Set([start, ...events.map(e => e.at), now])].sort((a, b) => a - b);
  const planned: Record<string, number> = Object.fromEntries(types.map(t => [t, 0]));
  const delivered: Record<string, number> = { ...planned };
  const errors: Record<string, number> = { ...planned };
  const chartData: ProgressPoint[] = [];
  let index = 0;
  let previous = start;
  for (const at of times) {
    const elapsed = Math.max(0, Math.min(at, now) - Math.max(previous, start));
    for (const t of types) {
      errors[t] += elapsed * Math.abs(100 * planned[t] / (baseTotals[t] || 1) - 100 * delivered[t] / (totals[t] || 1));
    }
    while (events[index] && events[index].at <= at) {
      const event = events[index];
      planned[event.type] += event.planned;
      delivered[event.type] += event.delivered;
      index += 1;
    }
    const point: ProgressPoint = { timestamp: at };
    for (const t of types) {
      point[`plan_${t}`] = 100 * planned[t] / (baseTotals[t] || 1);
      point[t] = at <= now ? delivered[t] : null;
      point[`pct_${t}`] = at <= now ? 100 * delivered[t] / (totals[t] || 1) : null;
    }
    chartData.push(point);
    previous = at;
  }
  // Do not award a perfect score before delivery evidence exists.
  const duration = Math.max(1, now - start);
  const scores: Record<string, number | null> = {};
  const hasDelivery = Object.values(delivered).some(value => value > 0);
  for (const t of types) scores[t] = hasDelivery && valid.some(r => r.engagement_type === t && Date.parse(r.scheduled_at) <= now)
    ? Math.round(Math.max(0, Math.min(100, 100 - errors[t] / duration))) : null;
  const measured = Object.values(scores).filter((s): s is number => s !== null);
  const score = measured.length ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length) : null;
  return { chartData, types, score, scores, delivered };
}