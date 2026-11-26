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
  const secs = Math.round(ms / 1000);
  const mins = Math.floor(secs / 60), sec = secs % 60;
  const tail = sec ? ` ${String(sec).padStart(2, "0")}s` : "";
  if (mins < 60) return `${mins}m${tail}`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m${tail}`;
}

/**
 * Gap before each run: the planned gap from the previous run's scheduled time,
 * and once both are known, the actual gap from previous run Start to this Start.
 */
export type SpacedRun = { run_number: number; scheduled_at: string; planned_at?: string | null; planned_gap_seconds?: number | null; started_at?: string | null; completed_at?: string | null; status?: string; provider_order_id?: string | null; dispatch_uncertain?: boolean | null };

/** Late runs may catch up at this fraction of their planned gap, never faster. */
export const CATCH_UP_GAP_FRACTION = 0.5;

/**
 * Earliest dispatch time, the same rule the server queue uses: runs go in
 * order (an earlier run that is not yet sent/accepted blocks), but a slow
 * provider that has accepted a run no longer blocks — the next run goes at
 * its planned time to a provider not busy with this link. When behind plan,
 * runs catch up at no less than half their planned gap after the previous send.
 */
export function runTiming(run: SpacedRun, runs: SpacedRun[]) {
  if (run.provider_order_id || ['completed','partial','cancelled','canceled','merged','failed'].includes(run.status ?? '')) return { waitingForRun: null, earliestAt: Date.parse(run.scheduled_at) };
  const earlier = runs.filter((r) => r.run_number < run.run_number).sort((a,b) => a.run_number-b.run_number);
  const waiting = earlier.find((r) => r.dispatch_uncertain || (!r.provider_order_id && ['pending','dispatching','dispatch_uncertain'].includes(r.status ?? '')));
  if (waiting) return { waitingForRun: waiting.run_number, earliestAt: null };
  const previousSent = earlier.reduce((max,r) => Math.max(max, Date.parse(r.started_at ?? r.completed_at ?? r.scheduled_at)), -Infinity);
  const planned = Date.parse(run.planned_at ?? run.scheduled_at);
  const at = Math.max(planned, Date.parse(run.scheduled_at), previousSent + (run.planned_gap_seconds ?? 60)*1000*CATCH_UP_GAP_FRACTION);
  return { waitingForRun: null, earliestAt: Number.isFinite(at) ? at : null };
}

export function runGaps(runs: SpacedRun[]) {
  const sorted = [...runs].sort((a, b) => a.run_number - b.run_number);
  const out: Record<number, { planned: number | null; actual: number | null }> = {};
  sorted.forEach((run, i) => {
    const prev = sorted[i - 1];
    if (!prev) { out[run.run_number] = { planned: null, actual: null }; return; }
    const planned = run.planned_gap_seconds != null ? run.planned_gap_seconds*1000 : Date.parse(run.planned_at ?? run.scheduled_at) - Date.parse(prev.planned_at ?? prev.scheduled_at);
    const actual = prev.started_at && run.started_at ? Date.parse(run.started_at) - Date.parse(prev.started_at) : NaN;
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
