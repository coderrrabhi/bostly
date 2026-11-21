/**
 * Providers often deliver more (or fewer) views than a run asked for. The
 * Reel's real views come from each observed views run's provider start count.
 * Non-comment engagements follow that real figure: the engagement owes
 * ratio x (real views gained - views delivered so far), and each next run adds
 * (or removes) part of that debt. A single run moves by at most half its
 * planned size, including the final run, so the selected curve stays smooth
 * and whatever is left carries to the following runs instead of spiking.
 */
export type ViewsRun = {
  runNumber: number;
  quantity: number;
  startCount: number | null;
  completed: boolean;
  /** Dispatched in-progress/partial run with a reliable delivered quantity. */
  observed?: boolean;
  delivered?: number | null;
};

const deliveredFor = (run: ViewsRun): number => {
  if (typeof run.delivered === "number" && Number.isFinite(run.delivered)) return Math.max(0, run.delivered);
  return run.completed && Number.isFinite(run.quantity) ? Math.max(0, run.quantity) : 0;
};

/** Real views gained on the Reel and the provider views delivered for those runs. */
export function viewsDrift(runs: ViewsRun[]): { ordered: number; extra: number } | null {
  const done = runs.filter((r) => r.completed || r.observed).sort((a, b) => a.runNumber - b.runNumber);
  const counted = done.filter((r) =>
    typeof r.startCount === "number" && Number.isFinite(r.startCount) && r.startCount >= 0);
  if (!counted.length) return null;
  // Views on the Reel before our first run (estimated from the first reading).
  const first = counted[0];
  const before = done.filter((r) => r.runNumber < first.runNumber).reduce((a, r) => a + deliveredFor(r), 0);
  const baseline = Math.max(0, Number(first.startCount) - before);
  // A reading that a later run contradicts (later start count is lower) is a
  // provider's odd count and is ignored; the latest trusted reading is used.
  const trusted = counted.filter((r, i) => !counted.slice(i + 1).some((n) => Number(n.startCount) < Number(r.startCount)));
  const lastRun = trusted[trusted.length - 1] ?? counted[counted.length - 1];
  const latest = Number(lastRun.startCount) + deliveredFor(lastRun);
  const ordered = done.filter((r) => r.runNumber <= lastRun.runNumber).reduce((a, r) => a + deliveredFor(r), 0);
  return { ordered, extra: latest - baseline - ordered };
}

export function driftAdjustment(opts: {
  views: ViewsRun[]; viewsTotal: number; itemQuantity: number; appliedSoFar: number;
  runQuantity: number; min: number; max: number; lastRun: boolean;
  remainingBase?: number;
}): number {
  if (!(opts.viewsTotal > 0) || !(opts.itemQuantity > 0)) return 0;
  const d = viewsDrift(opts.views);
  if (!d) return 0;
  const owed = Math.round((opts.itemQuantity / opts.viewsTotal) * d.extra) - opts.appliedSoFar;
  // Never force the remaining debt into the final run: that created a sudden
  // 2x spike. Every run, final included, moves by at most half its curve size.
  const up = Math.floor(opts.runQuantity * 0.5);
  // Spread outstanding ratio debt in proportion to the remaining saved curve
  // quantities, rather than clearing all debt in the next (possibly tiny) run.
  // Round away from zero (bounded by the debt) so small runs still carry at
  // least 1 of an outstanding add-on instead of rounding it to 0 every run.
  const share = opts.remainingBase && opts.remainingBase > 0 ? owed * Math.min(1, opts.runQuantity / opts.remainingBase) : owed;
  const weighted = owed > 0 ? Math.min(owed, Math.max(1, Math.ceil(share)))
    : owed < 0 ? Math.max(owed, Math.min(-1, Math.floor(share))) : 0;
  let adj = Math.max(-Math.min(up, opts.runQuantity - Math.max(1, opts.min)), Math.min(up, weighted));
  if (opts.max > 0) adj = Math.min(adj, opts.max - opts.runQuantity);
  return adj;
}

/**
 * Closest quantity to `q` not already used by another run of the same
 * engagement (within min/max), so dispatch-time changes never create two
 * runs with the same quantity. Returns `q` if no free value exists.
 */
export function nearestUnused(q: number, used: number[], min: number, max: number, planned?: number): number {
  const taken = new Set(used);
  if (!taken.has(q)) return q;
  // An add-on must stay an add-on: search away from the planned quantity first,
  // so uniqueness never silently cancels an extra-views adjustment.
  if (planned !== undefined && q !== planned) {
    const dir = q > planned ? 1 : -1;
    for (let v = q + dir; dir > 0 ? (max <= 0 || v <= max) : v >= Math.max(1, min); v += dir) {
      if (!taken.has(v)) return v;
      if (Math.abs(v - q) > 10000) break;
    }
    for (let v = q - dir; v !== planned; v -= dir) if (!taken.has(v)) return v;
  }
  const lo = Math.max(1, min);
  for (let d = 1; d <= 10000; d += 1) {
    const up = q + d;
    if ((max <= 0 || up <= max) && !taken.has(up)) return up;
    const down = q - d;
    if (down >= lo && !taken.has(down)) return down;
    if (down < lo && max > 0 && up > max) break;
  }
  return q;
}
