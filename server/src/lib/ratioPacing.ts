export type PacedRun = { scheduled_at: string; quantity_to_send: number };

/**
 * Keep every engagement in line with its % of views: a non-view run may only
 * go out once the views scheduled before it reach the same share of the
 * views total. Example: shares 37 of 8476 views -> a shares run that brings
 * the shares total to 20 waits until ~4582 views are scheduled.
 * Run quantities (provider minimums) and totals are never changed; only the
 * timing is delayed. Orders without views are left unchanged.
 */
export function paceRunsToViews<T extends PacedRun>(
  items: Array<{ type: string; quantity: number; runs: T[] }>,
): Array<T[]> {
  const views = items.find((i) => /views?$/i.test(i.type));
  if (!views || views.quantity <= 0) return items.map((i) => i.runs);
  const vRuns = [...views.runs].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  const vCum: Array<{ at: number; cum: number }> = [];
  let acc = 0;
  for (const r of vRuns) { acc += r.quantity_to_send; vCum.push({ at: Date.parse(r.scheduled_at), cum: acc }); }
  const viewsTotal = acc || views.quantity;

  return items.map((item) => {
    if (item === views || item.quantity <= 0) return item.runs;
    const sorted = [...item.runs].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
    let cum = 0;
    let prev = -Infinity;
    const paced = sorted.map((run) => {
      cum += run.quantity_to_send;
      const neededViews = Math.min(viewsTotal, (cum / item.quantity) * viewsTotal);
      const slot = vCum.find((v) => v.cum >= neededViews - 1e-9) ?? vCum[vCum.length - 1];
      let at = Math.max(Date.parse(run.scheduled_at), slot.at + 60_000);
      if (at <= prev) at = prev + 60_000;
      prev = at;
      return { ...run, scheduled_at: new Date(at).toISOString() };
    });
    return finishByViews(paced, vCum[vCum.length - 1].at);
  });
}

/** Latest an engagement run may be planned: shortly after the last Views run. */
export const FINISH_AFTER_VIEWS_MS = 10 * 60_000;

/**
 * Engagement runs planned after the last Views run (+10 min) are pulled into
 * the time before that limit, keeping their order and spacing them evenly,
 * so every engagement completes right after Views. Quantities never change.
 */
export function finishByViews<T extends PacedRun>(runs: T[], viewsEnd: number): T[] {
  const limit = viewsEnd + FINISH_AFTER_VIEWS_MS;
  const firstLate = runs.findIndex((r) => Date.parse(r.scheduled_at) > limit);
  if (firstLate < 0) return runs;
  const from = firstLate > 0 ? Date.parse(runs[firstLate - 1].scheduled_at) : Math.min(Date.parse(runs[0].scheduled_at), viewsEnd);
  const late = runs.length - firstLate;
  const step = Math.max(60_000, (limit - from) / (late + 0.5));
  return runs.map((r, i) => (i < firstLate ? r : { ...r, scheduled_at: new Date(from + step * (i - firstLate + 1)).toISOString() }));
}
