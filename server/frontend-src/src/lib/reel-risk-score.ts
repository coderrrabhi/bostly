export type ReelRiskRun = {
  engagement_type?: string | null;
  quantity_to_send?: number | null;
  started_at?: string | null;
  provider_order_id?: string | null;
  provider_remains?: number | null;
  status?: string | null;
};

export type ReelRiskType = {
  type: string;
  target: number;
  delivered: number;
};

export type ReelRiskFactor = {
  key: "ratio" | "spikes" | "bursts" | "repeats" | "overdelivery";
  label: string;
  points: number;
};

export type ReelRiskScore = {
  score: number;
  level: "Low" | "Moderate" | "High" | "Very high";
  factors: ReelRiskFactor[];
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function reelRiskFromItems(items: Array<{
  engagement_type?: string | null;
  quantity?: number | null;
  runs?: ReelRiskRun[] | null;
}>): ReelRiskScore {
  const runs = items.flatMap((item) => (item.runs || []).map((run) => ({ ...run, engagement_type: item.engagement_type })));
  const types = items.map((item) => ({
    type: String(item.engagement_type || "").toLowerCase(),
    target: Number(item.quantity || 0),
    delivered: (item.runs || []).reduce((sum, run) => {
      const quantity = Number(run.quantity_to_send || 0);
      if (run.provider_remains !== null && run.provider_remains !== undefined && Number.isFinite(Number(run.provider_remains))) {
        return sum + Math.max(0, quantity - Number(run.provider_remains));
      }
      return sum + (["completed", "partial"].includes(String(run.status)) ? quantity : 0);
    }, 0),
  }));
  return reelRiskScore(runs, types);
}

/**
 * Transparent heuristic only: it describes patterns visible in this order's
 * schedule and provider-reported delivery. It is not Instagram's or Whop's
 * detection verdict and must never be presented as a guarantee of safety.
 */
export function reelRiskScore(runs: ReelRiskRun[], types: ReelRiskType[]): ReelRiskScore {
  const factors: ReelRiskFactor[] = [];
  const views = types.find((type) => type.type === "views");
  const engagementTypes = types.filter((type) => !["views", "comments"].includes(type.type));

  let ratioSeverity = 0;
  if (views && views.target > 0) {
    for (const type of engagementTypes) {
      if (!(type.delivered > 0) || !(type.target > 0)) continue;
      const expected = views.delivered * (type.target / views.target);
      const tolerance = Math.max(2, expected * 0.5);
      if (expected <= 0) ratioSeverity = 1;
      else if (type.delivered > expected + tolerance) {
        ratioSeverity = Math.max(ratioSeverity, clamp01((type.delivered - expected - tolerance) / Math.max(expected, 1)));
      }
    }
  }
  if (ratioSeverity > 0) factors.push({ key: "ratio", label: "Engagement delivered ahead of its views ratio", points: Math.round(30 * ratioSeverity) });

  let spikeSeverity = 0;
  let repeated = 0;
  let measured = 0;
  const byType = new Map<string, ReelRiskRun[]>();
  for (const run of runs) {
    const type = String(run.engagement_type || "").toLowerCase();
    if (!type) continue;
    byType.set(type, [...(byType.get(type) || []), run]);
  }
  for (const typeRuns of byType.values()) {
    const quantities = typeRuns.map((run) => Number(run.quantity_to_send)).filter((quantity) => Number.isFinite(quantity) && quantity > 0);
    if (quantities.length > 1) {
      const typical = median(quantities);
      const largest = Math.max(...quantities);
      const ratio = typical > 0 ? largest / typical : 1;
      if (ratio > 3 && largest - typical >= 10) spikeSeverity = Math.max(spikeSeverity, clamp01((ratio - 3) / 5));
      repeated += quantities.length - new Set(quantities).size;
      measured += quantities.length;
    }
  }
  if (spikeSeverity > 0) factors.push({ key: "spikes", label: "Unusually large run-size spikes", points: Math.round(20 * spikeSeverity) });

  let burstExtras = 0;
  for (const typeRuns of byType.values()) {
    const starts = typeRuns
      .filter((run) => run.provider_order_id && run.started_at)
      .map((run) => new Date(String(run.started_at)).getTime())
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    for (let index = 1; index < starts.length; index += 1) {
      if (starts[index] - starts[index - 1] <= 60_000) burstExtras += 1;
    }
  }
  if (burstExtras > 0) factors.push({ key: "bursts", label: "Multiple runs dispatched within one minute", points: Math.min(20, burstExtras * 5) });

  if (repeated > 0 && measured > 0) factors.push({ key: "repeats", label: "Repeated run quantities", points: Math.round(15 * repeated / measured) });

  let overdeliverySeverity = 0;
  for (const type of types) {
    if (!(type.target > 0) || type.delivered <= type.target) continue;
    const threshold = Math.max(type.target * 1.5, type.target + 10);
    if (type.delivered > threshold) overdeliverySeverity = Math.max(overdeliverySeverity, clamp01((type.delivered - threshold) / type.target));
  }
  if (overdeliverySeverity > 0) factors.push({ key: "overdelivery", label: "Delivery substantially above the ordered total", points: Math.round(15 * overdeliverySeverity) });

  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.points, 0));
  return {
    score,
    level: score >= 75 ? "Very high" : score >= 50 ? "High" : score >= 25 ? "Moderate" : "Low",
    factors: factors.sort((a, b) => b.points - a.points),
  };
}
