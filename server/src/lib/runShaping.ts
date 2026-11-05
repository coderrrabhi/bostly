export type ShapedRun = {
  scheduled_at: string;
  quantity_to_send: number;
  base_quantity?: number;
  variance_applied?: number;
  peak_multiplier?: number;
};

/** Shift every run by the same offset so the earliest run starts at `firstRunAtMs`, keeping the curve's spacing. */
export function applyStartDelay<T extends ShapedRun>(runs: T[], firstRunAtMs: number): T[] {
  if (!runs.length) return runs;
  const earliest = Math.min(...runs.map((r) => new Date(r.scheduled_at).getTime()));
  if (!Number.isFinite(earliest)) return runs;
  const offset = firstRunAtMs - earliest;
  return runs.map((r) => ({ ...r, scheduled_at: new Date(new Date(r.scheduled_at).getTime() + offset).toISOString() }));
}

/**
 * Merge runs so every run sent to a provider is at least `min`.
 * Small runs are carried forward into the next run; leftover is added to the last run.
 * The total quantity is preserved.
 */
export function enforceMinimumRuns<T extends ShapedRun>(runs: T[], min: number): T[] {
  if (min <= 1 || !runs.length) return runs;
  const sorted = [...runs].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const out: T[] = [];
  let carry = 0;
  for (const run of sorted) {
    const qty = run.quantity_to_send + carry;
    if (qty >= min) {
      out.push({ ...run, quantity_to_send: qty, base_quantity: qty });
      carry = 0;
    } else {
      carry = qty;
    }
  }
  if (carry > 0) {
    if (out.length) {
      const last = out[out.length - 1];
      out[out.length - 1] = { ...last, quantity_to_send: last.quantity_to_send + carry, base_quantity: last.quantity_to_send + carry };
    } else {
      const first = sorted[0];
      out.push({ ...first, quantity_to_send: carry, base_quantity: carry });
    }
  }
  return out;
}
