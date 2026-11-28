/** Average quantity of the most recent `count` completed runs (0 when none). */
export function averageLastCompletedRuns(
  runs: Array<{ scheduled_at: string; quantity_to_send: number | string; status?: string | null }>,
  count = 20,
): number {
  const done = runs
    .filter((r) => r.status === 'completed' && Number(r.quantity_to_send) > 0)
    .sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at))
    .slice(0, count);
  if (!done.length) return 0;
  return Math.round(done.reduce((a, r) => a + Number(r.quantity_to_send), 0) / done.length);
}
