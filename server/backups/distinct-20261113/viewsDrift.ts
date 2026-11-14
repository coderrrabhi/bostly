/**
 * Providers often deliver more (or fewer) views than a run asked for. The
 * Reel's real views come from each completed views run's provider start count.
 * Non-comment engagements follow that real figure: the engagement owes
 * ratio x (real views gained - views ordered so far), and each next run adds
 * (or removes) part of that debt. A single run moves by at most half its
 * planned size (the last run may double), so the curve stays smooth and
 * whatever is left carries to the following runs.
 */
export type ViewsRun = { runNumber: number; quantity: number; startCount: number | null; completed: boolean };

/** Real views gained on the Reel and the views ordered for those runs. */
export function viewsDrift(runs: ViewsRun[]): { ordered: number; extra: number } | null {
  const done = runs.filter((r) => r.completed).sort((a, b) => a.runNumber - b.runNumber);
  const counted = done.filter((r) => Number(r.startCount) > 0);
  if (!counted.length) return null;
  // Views on the Reel before our first run (estimated from the first reading).
  const first = counted[0];
  const before = done.filter((r) => r.runNumber < first.runNumber).reduce((a, r) => a + r.quantity, 0);
  const baseline = Math.max(0, Number(first.startCount) - before);
  // A reading that a later run contradicts (later start count is lower) is a
  // provider's odd count and is ignored; the latest trusted reading is used.
  const trusted = counted.filter((r, i) => !counted.slice(i + 1).some((n) => Number(n.startCount) < Number(r.startCount)));
  const lastRun = trusted[trusted.length - 1] ?? counted[counted.length - 1];
  const latest = Number(lastRun.startCount) + lastRun.quantity;
  const ordered = done.filter((r) => r.runNumber <= lastRun.runNumber).reduce((a, r) => a + r.quantity, 0);
  return { ordered, extra: latest - baseline - ordered };
}

export function driftAdjustment(opts: {
  views: ViewsRun[]; viewsTotal: number; itemQuantity: number; appliedSoFar: number;
  runQuantity: number; min: number; max: number; lastRun: boolean;
}): number {
  if (!(opts.viewsTotal > 0) || !(opts.itemQuantity > 0)) return 0;
  const d = viewsDrift(opts.views);
  if (!d) return 0;
  const owed = Math.round((opts.itemQuantity / opts.viewsTotal) * d.extra) - opts.appliedSoFar;
  const up = Math.max(1, Math.round(opts.runQuantity * (opts.lastRun ? 1 : 0.5)));
  let adj = Math.max(-(opts.runQuantity - Math.max(1, opts.min)), Math.min(up, owed));
  if (opts.max > 0) adj = Math.min(adj, opts.max - opts.runQuantity);
  return adj;
}
