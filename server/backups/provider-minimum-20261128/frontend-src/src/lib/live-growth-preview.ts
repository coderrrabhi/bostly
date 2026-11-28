export interface LivePreviewRun {
  scheduled_at: string;
  quantity_to_send: number;
}

export type LivePreviewSchedules = Record<string, LivePreviewRun[]>;

export interface GrowthChartPoint {
  time: string;
  timestamp: number;
  total: number;
  [engagementType: string]: string | number;
}

export interface GrowthTypeTotal {
  type: string;
  quantity: number;
  runs: number;
}

export interface LiveGrowthPreviewData {
  chartData: GrowthChartPoint[];
  typeBreakdown: GrowthTypeTotal[];
  activeTypes: string[];
  stats: {
    totalRuns: number;
    totalEngagements: number;
    durationMs: number;
    startTime: number | null;
    endTime: number | null;
  };
}

const TYPE_PRIORITY = ["views", "comments", "likes", "saves", "shares", "reposts"];

const emptyResult = (): LiveGrowthPreviewData => ({
  chartData: [],
  typeBreakdown: [],
  activeTypes: [],
  stats: { totalRuns: 0, totalEngagements: 0, durationMs: 0, startTime: null, endTime: null },
});

/**
 * Build the growth chart from the exact runs that the order form will send.
 * No random template or second schedule is generated here: changing the
 * selected curve, quantity, run quantity or timeframe changes this data.
 */
export function buildLiveGrowthPreview(schedules: LivePreviewSchedules): LiveGrowthPreviewData {
  const events = Object.entries(schedules ?? {}).flatMap(([type, runs]) =>
    (runs ?? []).flatMap((run, index) => {
      const timestamp = new Date(run.scheduled_at).getTime();
      const quantity = Math.floor(Number(run.quantity_to_send));
      if (!Number.isFinite(timestamp) || !Number.isFinite(quantity) || quantity <= 0) return [];
      return [{ type, timestamp, quantity, runNumber: index + 1 }];
    }),
  );

  if (events.length === 0) return emptyResult();

  events.sort((a, b) => a.timestamp - b.timestamp || a.type.localeCompare(b.type) || a.runNumber - b.runNumber);
  const types = [...new Set(events.map((event) => event.type))];
  const activeTypes = [...types].sort((a, b) => {
    const ai = TYPE_PRIORITY.indexOf(a);
    const bi = TYPE_PRIORITY.indexOf(b);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.localeCompare(b);
  });

  const cumulative: Record<string, number> = Object.fromEntries(activeTypes.map((type) => [type, 0]));
  const runCounts: Record<string, number> = Object.fromEntries(activeTypes.map((type) => [type, 0]));
  const startTime = events[0].timestamp;
  const endTime = events[events.length - 1].timestamp;
  const chartData: GrowthChartPoint[] = [];

  const pushPoint = (timestamp: number) => {
    chartData.push({
      time: new Date(timestamp).toISOString(),
      timestamp,
      ...cumulative,
      total: Object.values(cumulative).reduce((sum, quantity) => sum + quantity, 0),
    });
  };

  // A zero baseline immediately before the first real run makes the first
  // delivery visible without inventing an extra run or quantity.
  pushPoint(startTime - 1000);
  for (const event of events) {
    cumulative[event.type] += event.quantity;
    runCounts[event.type] += 1;
    pushPoint(event.timestamp);
  }

  return {
    chartData,
    activeTypes,
    typeBreakdown: activeTypes.map((type) => ({ type, quantity: cumulative[type], runs: runCounts[type] })),
    stats: {
      totalRuns: events.length,
      totalEngagements: events.reduce((sum, event) => sum + event.quantity, 0),
      durationMs: Math.max(0, endTime - startTime),
      startTime,
      endTime,
    },
  };
}

export function formatPreviewDuration(durationMs: number): string {
  const totalMinutes = Math.max(0, Math.round(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
