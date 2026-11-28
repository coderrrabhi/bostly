export type PreviewRun = { scheduled_at: string; quantity_to_send: number; base_quantity?: number };

/** Placement validates the displayed plan; it must never silently repair it. */
export function exactPreview<T extends PreviewRun>(
  runs: T[], total: number, minimum: number, maximum = 0,
  fitsProvider: (quantity: number) => boolean = () => true,
): T[] {
  if (!runs.length || runs.reduce((sum, run) => sum + run.quantity_to_send, 0) !== total) {
    throw new Error('Preview is out of date. Refresh the preview before placing this order.');
  }
  let previous = -Infinity;
  for (const run of runs) {
    const at = Date.parse(run.scheduled_at);
    if (!Number.isFinite(at) || at < previous) throw new Error('Preview run order is invalid. Refresh the preview.');
    previous = at;
    if (!Number.isInteger(run.quantity_to_send) || run.quantity_to_send < minimum
      || (maximum > 0 && run.quantity_to_send > maximum) || !fitsProvider(run.quantity_to_send)) {
      throw new Error(`Preview no longer matches provider limits (minimum ${minimum}). Refresh the preview; no order was placed.`);
    }
  }
  return runs.map(run => ({ ...run, base_quantity: run.quantity_to_send }));
}