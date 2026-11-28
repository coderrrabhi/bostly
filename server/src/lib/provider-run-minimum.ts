/** A bundle can raise a provider minimum, never lower it. */
export function planningMinimum(bundle: unknown, provider: unknown, fallback: unknown = 1): number {
  const positive = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
  const b = positive(bundle);
  return Math.max(1, b, positive(provider), b > 0 ? 0 : positive(fallback));
}

/** Keep the total and curve slots; rebalance small runs, reducing count only when necessary. */
export function minimumQuantities(values: number[], minimum: number): number[] {
  const min = Math.max(1, Math.ceil(minimum));
  const input = values.filter(q => q > 0).map(Math.floor);
  const total = input.reduce((sum, q) => sum + q, 0);
  if (!input.length) return [];
  if (total < min) throw new Error(`Order quantity ${total} is below provider minimum ${min}.`);
  const count = Math.min(input.length, Math.floor(total / min));
  const grouped = Array.from({ length: count }, () => 0);
  input.forEach((q, i) => {
    const index = Math.min(count - 1, Math.floor(i * count / input.length));
    grouped[index] = (grouped[index] ?? 0) + q;
  });
  const result = grouped.map(q => Math.max(min, q));
  let excess = result.reduce((sum, q) => sum + q, 0) - total;
  const donors = result.map((_, i) => i).sort((a, b) => (result[b] ?? 0) - (result[a] ?? 0));
  for (const i of donors) {
    const q = result[i];
    if (q === undefined) continue;
    const take = Math.min(excess, q - min);
    result[i] = q - take;
    excess -= take;
  }
  return result;
}

export function enforcePlanningMinimum<T extends { quantity_to_send: number; base_quantity?: number }>(runs: T[], min: number): T[] {
  const positive = runs.filter(r => r.quantity_to_send > 0);
  const quantities = minimumQuantities(positive.map(r => r.quantity_to_send), min);
  return quantities.map((q, i) => {
    // Preserve first/last times and intermediate curve positions when runs must be regrouped.
    const index = quantities.length === 1 ? 0 : Math.round(i * (positive.length - 1) / (quantities.length - 1));
    const run = positive[index];
    if (!run) throw new Error('Schedule slot missing.');
    return { ...run, quantity_to_send: q, base_quantity: q };
  });
}