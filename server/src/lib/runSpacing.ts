/** Immutable curve timing: provider retry timestamps must never become run gaps. */
export function runSpacing<T extends { scheduled_at: string }>(runs: T[]): Array<T & { planned_at: string; planned_gap_seconds: number }> {
  const seen = new Set<number>();
  let last = 0;
  return runs.map((run, index) => {
    const original = Date.parse(run.scheduled_at);
    if (!Number.isFinite(original)) throw new Error('Invalid run time.');
    let gap = index ? Math.max(60, Math.round((original - Date.parse(runs[index - 1]?.scheduled_at ?? run.scheduled_at)) / 1000)) : 0;
    while (index && seen.has(gap)) gap += 1;
    if (index) seen.add(gap);
    const time = index ? last + gap * 1000 : original;
    last = time;
    const planned = new Date(time).toISOString();
    return { ...run, scheduled_at: planned, planned_at: planned, planned_gap_seconds: gap };
  });
}
