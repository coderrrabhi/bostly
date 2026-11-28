/** Final preview pacing; quantities and the selected curve's run order stay intact. */
export function pacePreviewToViews<T extends { scheduledAt: Date; quantity: number }>(
  schedules: Array<{ engagementType: string; runs: T[] }>,
): T[][] {
  const views = schedules.find((s) => /^views?$/i.test(s.engagementType));
  if (!views?.runs.length) return schedules.map((s) => s.runs);
  const v = [...views.runs].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  let sum = 0;
  const cumulative = v.map((r) => ({ at: r.scheduledAt.getTime(), quantity: (sum += r.quantity) }));
  if (sum <= 0) return schedules.map((s) => s.runs);
  return schedules.map((s) => {
    if (s === views) return s.runs;
    const total = s.runs.reduce((a, r) => a + r.quantity, 0);
    if (total <= 0) return s.runs;
    let sent = 0, previous = -Infinity;
    return [...s.runs].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime()).map((r) => {
      sent += r.quantity;
      const required = sent / total * sum;
      const slot = cumulative.find((p) => p.quantity + 1e-9 >= required) ?? cumulative[cumulative.length - 1];
      const at = Math.max(r.scheduledAt.getTime(), slot.at + 60_000, previous + 60_000);
      previous = at;
      return { ...r, scheduledAt: new Date(at) };
    });
  });
}