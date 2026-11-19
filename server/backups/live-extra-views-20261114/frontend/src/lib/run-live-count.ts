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
