export interface PeakHoursRun {
  scheduled_at: string;
  quantity_to_send: number;
  base_quantity?: number;
  peak_multiplier?: number;
}

const hourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** New York hour used by the customer-facing Peak Hours (USA Time) switch. */
export function newYorkHour(scheduledAt: string): number {
  const date = new Date(scheduledAt);
  if (!Number.isFinite(date.getTime())) return 12;
  return Number(hourFormatter.format(date));
}

/** 6–11 PM gets a gentle boost; US night is slower; other hours are unchanged. */
export function peakHoursFactor(scheduledAt: string): number {
  const hour = newYorkHour(scheduledAt);
  if (hour >= 18 && hour <= 23) return 1.35;
  if (hour >= 0 && hour < 6) return 0.75;
  return 1;
}

/**
 * Optional peak weighting for an already planned curve. Run timestamps, run
 * count and exact total stay unchanged. Every run remains within My Bundles /
 * provider limits and within ±25% of its selected-curve quantity, so enabling
 * Peak Hours cannot create an unusual spike. OFF is a true no-op on quantities.
 */
export function applyPeakHours<T extends PeakHoursRun>(
  runs: T[],
  enabled: boolean,
  minimum: number,
  maximum = 0,
): T[] {
  if (!enabled) return runs.map((run) => ({ ...run, peak_multiplier: 1 }));
  if (!runs.length) return [];

  const total = runs.reduce((sum, run) => sum + run.quantity_to_send, 0);
  const suppliedBases = runs.map((run) => Math.max(1, Math.floor(run.base_quantity ?? run.quantity_to_send)));
  const baseTotal = suppliedBases.reduce((sum, quantity) => sum + quantity, 0);
  const bases = baseTotal === total ? suppliedBases : runs.map((run) => run.quantity_to_send);
  const factors = runs.map((run) => peakHoursFactor(run.scheduled_at));
  const weightedAverage = bases.reduce((sum, quantity, index) => sum + quantity * factors[index], 0) / Math.max(1, total);
  const min = Math.max(1, Math.floor(minimum) || 1);
  const lower = bases.map((base) => Math.max(min, Math.floor(base * 0.75)));
  const upper = bases.map((base) => Math.min(maximum > 0 ? maximum : Number.POSITIVE_INFINITY, Math.ceil(base * 1.25)));
  const targets = bases.map((base, index) => {
    const target = (base * factors[index]) / Math.max(0.0001, weightedAverage);
    return Math.max(lower[index], Math.min(upper[index], target));
  });
  const quantities = targets.map((target) => Math.floor(target));
  let difference = total - quantities.reduce((sum, quantity) => sum + quantity, 0);

  // Rounding and per-run caps can leave a remainder. Move only whole units
  // toward each run's target until the original curve total is restored.
  let guard = 0;
  while (difference !== 0 && guard < runs.length * 4 + 8) {
    const increasing = difference > 0;
    const candidates = quantities
      .map((quantity, index) => ({ index, room: increasing ? upper[index] - quantity : quantity - lower[index] }))
      .filter((entry) => entry.room > 0);
    if (!candidates.length) break;
    const weights = candidates.map((entry) => Math.max(0.0001, increasing
      ? targets[entry.index] - quantities[entry.index]
      : quantities[entry.index] - targets[entry.index]));
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    const before = Math.abs(difference);
    candidates.forEach((entry, candidateIndex) => {
      if (difference === 0) return;
      const amount = Math.min(
        entry.room,
        Math.abs(difference),
        Math.max(1, Math.floor((before * weights[candidateIndex]) / weightTotal)),
      );
      quantities[entry.index] += increasing ? amount : -amount;
      difference += increasing ? -amount : amount;
    });
    if (Math.abs(difference) === before) {
      const entry = candidates[0];
      quantities[entry.index] += increasing ? 1 : -1;
      difference += increasing ? -1 : 1;
    }
    guard += 1;
  }

  // The original quantities already fit these bounds, so a valid exact total
  // always exists. This fallback is only a defensive guard for malformed input.
  if (difference !== 0) return runs.map((run) => ({ ...run, peak_multiplier: 1 }));
  return runs.map((run, index) => ({
    ...run,
    quantity_to_send: quantities[index],
    peak_multiplier: factors[index],
  }));
}
