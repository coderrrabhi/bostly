export type LiveRunStatus = "pending" | "started" | "completed" | "failed";

export type RunLiveCount =
  | { kind: "scheduled" }
  | { kind: "counts"; startCount: number; endCount: number; delivered: number }
  | { kind: "delivery-only"; delivered: number };

/**
 * Only provider-supplied start counts may be rendered as public live counts.
 * Zero is valid (for example, a Reel's first likes); null/undefined is unknown.
 */
export function runLiveCount({
  status,
  providerStartCount,
  actualDelivered,
}: {
  status: LiveRunStatus;
  providerStartCount?: number | null;
  actualDelivered: number;
}): RunLiveCount {
  if (status === "pending") return { kind: "scheduled" };

  const delivered = Number.isFinite(actualDelivered) ? Math.max(0, actualDelivered) : 0;
  if (
    typeof providerStartCount === "number" &&
    Number.isFinite(providerStartCount) &&
    providerStartCount >= 0
  ) {
    return {
      kind: "counts",
      startCount: providerStartCount,
      endCount: providerStartCount + delivered,
      delivered,
    };
  }

  return { kind: "delivery-only", delivered };
}

export function driftAdjustmentSummary(adjustments: Array<number | null | undefined>) {
  return adjustments.reduce(
    (summary, value) => {
      const adjustment = Number.isFinite(value) ? Number(value) : 0;
      if (adjustment > 0) summary.added += adjustment;
      if (adjustment < 0) summary.removed += Math.abs(adjustment);
      return summary;
    },
    { added: 0, removed: 0 },
  );
}

export type ViewsLiveRun = {
  runNumber: number;
  quantity: number;
  startCount: number | null;
  completed: boolean;
  /** A dispatched run with a reliable provider-delivered quantity. */
  observed?: boolean;
  delivered?: number | null;
};

export type ViewsLiveSummary = {
  providerDelivered: number;
  /** Real Reel growth not explained by provider-delivered views; null until measurable. */
  extraViews: number | null;
  totalGrowth: number | null;
  latestCount: number | null;
};

const providerDelivered = (run: ViewsLiveRun): number => {
  if (typeof run.delivered === "number" && Number.isFinite(run.delivered)) return Math.max(0, run.delivered);
  return run.completed && Number.isFinite(run.quantity) ? Math.max(0, run.quantity) : 0;
};

/**
 * Separate provider-delivered views from extra/organic growth observed between
 * provider start-count readings. This mirrors the server's drift calculation:
 * odd readings contradicted by a later lower start count are ignored.
 */
export function viewsLiveSummary(runs: ViewsLiveRun[]): ViewsLiveSummary {
  const observed = runs.filter((run) => run.completed || run.observed).sort((a, b) => a.runNumber - b.runNumber);
  const allProviderDelivered = observed.reduce((sum, run) => sum + providerDelivered(run), 0);
  const empty = { providerDelivered: allProviderDelivered, extraViews: null, totalGrowth: null, latestCount: null };
  const counted = observed.filter((run) =>
    typeof run.startCount === "number" && Number.isFinite(run.startCount) && run.startCount >= 0);
  if (!counted.length) return empty;

  const first = counted[0];
  const before = observed.filter((run) => run.runNumber < first.runNumber)
    .reduce((sum, run) => sum + providerDelivered(run), 0);
  const baseline = Math.max(0, Number(first.startCount) - before);
  const trusted = counted.filter((run, index) =>
    !counted.slice(index + 1).some((next) => Number(next.startCount) < Number(run.startCount)));
  const lastRun = trusted[trusted.length - 1] ?? counted[counted.length - 1];
  const latestCount = Number(lastRun.startCount) + providerDelivered(lastRun);
  const deliveredThroughReading = observed.filter((run) => run.runNumber <= lastRun.runNumber)
    .reduce((sum, run) => sum + providerDelivered(run), 0);
  const extraViews = latestCount - baseline - deliveredThroughReading;

  return {
    providerDelivered: allProviderDelivered,
    extraViews,
    totalGrowth: allProviderDelivered + extraViews,
    latestCount,
  };
}

/** Times in Live Delivery Tracking are always shown in India (Asia/Kolkata). */
export function formatIST(value: string | number | Date, withDate = false): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true,
    ...(withDate ? { day: "numeric", month: "short" } : {}),
  }).format(d).replace(/\b(am|pm)\b/, (m) => m.toUpperCase()) + " IST";
}

export function formatGap(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/**
 * Gap before each run: the planned gap from the previous run's scheduled time,
 * and once both are known, the actual gap from previous run Done to this Start.
 */
export function runGaps(runs: Array<{ run_number: number; scheduled_at: string; started_at?: string | null; completed_at?: string | null }>) {
  const sorted = [...runs].sort((a, b) => a.run_number - b.run_number);
  const out: Record<number, { planned: number | null; actual: number | null }> = {};
  sorted.forEach((run, i) => {
    const prev = sorted[i - 1];
    if (!prev) { out[run.run_number] = { planned: null, actual: null }; return; }
    const planned = Date.parse(run.scheduled_at) - Date.parse(prev.scheduled_at);
    const actual = prev.completed_at && run.started_at ? Date.parse(run.started_at) - Date.parse(prev.completed_at) : NaN;
    out[run.run_number] = { planned: Number.isFinite(planned) ? planned : null, actual: Number.isFinite(actual) ? actual : null };
  });
  return out;
}

/**
 * Extra (non-provider) views gained after each views run: the next run's
 * provider start count minus (this run's start count + its delivered views).
 * Null until the next reading exists; a contradictory lower reading is null.
 */
export function extraViewsAfterRun(runs: Array<{ run_number: number; startCount: number | null; delivered: number }>) {
  const sorted = [...runs].sort((a, b) => a.run_number - b.run_number);
  const out: Record<number, number | null> = {};
  sorted.forEach((run, i) => {
    const next = sorted.slice(i + 1).find((r) => typeof r.startCount === "number");
    if (typeof run.startCount !== "number" || !next || i + 1 >= sorted.length || sorted[i + 1] !== next) { out[run.run_number] = null; return; }
    const extra = Number(next.startCount) - (run.startCount + run.delivered);
    out[run.run_number] = extra >= 0 ? extra : null;
  });
  return out;
}

/** Compact 24h India time for charts/labels, e.g. "22:24" or "17 Nov, 22:24". */
export function istClock(value: string | number | Date, withDate = false): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false,
    ...(withDate ? { day: "2-digit", month: "short" } : {}) }).format(d);
}
