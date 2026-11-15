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
