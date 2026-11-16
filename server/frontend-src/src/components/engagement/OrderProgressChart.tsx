import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { ENGAGEMENT_CONFIG, EngagementType } from "@/lib/engagement-types";
import { format } from "date-fns";
import { Activity, TrendingUp, Clock, CheckCircle2 } from "lucide-react";

interface Run {
  id: string;
  run_number: number;
  scheduled_at: string;
  quantity_to_send: number;
  status: string;
  engagement_type: string;
  started_at?: string;
  completed_at?: string;
  provider_remains?: number;
  provider_order_id?: string | null;
  error_message?: string | null;
}

interface OrderProgressChartProps {
  runs: Run[];
  perType: {
    type: string;
    target: number;
    delivered: number;
    scheduled: number;
  }[];
}

// Distinct vibrant colors for each engagement type - easily distinguishable
const TYPE_COLORS: Record<string, string> = {
  views: "#3b82f6",
  likes: "#ec4899",
  comments: "#10b981",
  saves: "#f59e0b",
  shares: "#8b5cf6",
  followers: "#06b6d4",
  subscribers: "#ef4444",
  watch_hours: "#f97316",
  retweets: "#14b8a6",
  reposts: "#84cc16",
};

export function OrderProgressChart({ runs, perType }: OrderProgressChartProps) {
  const isTargetCompleteCancelMessage = (message: string) => (
    message.startsWith('target met') ||
    message.startsWith('target count reached') ||
    message.includes('target count reached') ||
    message.includes('target reached') ||
    message.includes('cancelling remaining runs') ||
    message.startsWith('delivery reserved') ||
    message.includes('already delivered') ||
    message.includes('auto-cancelled') ||
    message.includes('auto completed') ||
    message.includes('auto-completed') ||
    message.includes('item completed')
  );

  const { chartData, stats, activeTypes } = useMemo(() => {
    if (!runs || runs.length === 0) {
      return { chartData: [], stats: null, activeTypes: [] };
    }

    // Get unique engagement types from actual runs
    const activeTypes = [...new Set(runs.map(r => r.engagement_type))].filter(Boolean);

    // Filter only runs that have ACTUAL delivery (completed or started with some delivery)
    const deliveredRuns = runs.filter(run => {
      const status = (run.status || '').toLowerCase().trim();
      const message = (run.error_message || '').toLowerCase().trim();
      const isTargetMetAutoCompleted = (status === 'cancelled' || status === 'canceled') && isTargetCompleteCancelMessage(message);

      if (run.status === 'completed' || isTargetMetAutoCompleted) return true;
      if ((run.status === 'started' || run.status === 'failed') && 
          run.provider_remains !== null && run.provider_remains !== undefined) {
        return run.quantity_to_send - run.provider_remains > 0;
      }
      return false;
    });

    // Sort by completed_at or scheduled_at (actual delivery time)
    const sortedRuns = [...deliveredRuns].sort((a, b) => {
      const timeA = new Date(a.completed_at || a.started_at || a.scheduled_at).getTime();
      const timeB = new Date(b.completed_at || b.started_at || b.scheduled_at).getTime();
      return timeA - timeB;
    });

    if (sortedRuns.length === 0) {
      return { chartData: [], stats: null, activeTypes: [] };
    }

    // Initialize cumulative counters for each type
    const cumulative: Record<string, number> = {};
    activeTypes.forEach(type => {
      cumulative[type] = 0;
    });

    // Build chart data - ONLY actual delivered quantities
    const chartData: Record<string, any>[] = [];

    // Add starting point at 0
    const firstRunTime = new Date(sortedRuns[0].completed_at || sortedRuns[0].started_at || sortedRuns[0].scheduled_at);
    const startPoint: Record<string, any> = {
      time: format(new Date(firstRunTime.getTime() - 60000), 'HH:mm'),
      timestamp: firstRunTime.getTime() - 60000,
      displayTime: format(new Date(firstRunTime.getTime() - 60000), 'MMM d, HH:mm'),
      total: 0,
    };
    activeTypes.forEach(type => {
      startPoint[type] = 0;
    });
    chartData.push(startPoint);

    // Add each delivered run
    sortedRuns.forEach((run) => {
      const runTime = new Date(run.completed_at || run.started_at || run.scheduled_at);
      const status = (run.status || '').toLowerCase().trim();
      const message = (run.error_message || '').toLowerCase().trim();
      const isTargetMetAutoCompleted = (status === 'cancelled' || status === 'canceled') && isTargetCompleteCancelMessage(message);
      
      // Calculate ACTUAL delivered quantity
      let deliveredQty = 0;
      if (run.status === 'completed' || isTargetMetAutoCompleted) {
        deliveredQty = run.quantity_to_send;
      } else if ((run.status === 'started' || run.status === 'failed') && 
                 run.provider_remains !== null && run.provider_remains !== undefined) {
        deliveredQty = Math.max(0, run.quantity_to_send - run.provider_remains);
      }

      // Update cumulative for this type
      if (run.engagement_type && deliveredQty > 0) {
        cumulative[run.engagement_type] = (cumulative[run.engagement_type] || 0) + deliveredQty;
      }

      const total = Object.values(cumulative).reduce((a, b) => a + b, 0);

      // Build data point
      const dataPoint: Record<string, any> = {
        time: format(runTime, 'HH:mm'),
        timestamp: runTime.getTime(),
        displayTime: format(runTime, 'MMM d, HH:mm'),
        total,
        runNumber: run.run_number,
        deliveredQty,
        engagementType: run.engagement_type,
      };
      
      // Add cumulative value for each active type
      activeTypes.forEach(type => {
        dataPoint[type] = cumulative[type] || 0;
      });

      chartData.push(dataPoint);
    });

    // Calculate stats
    const totalScheduled = perType.reduce((sum, t) => sum + t.scheduled, 0);
    const totalDelivered = perType.reduce((sum, t) => sum + t.delivered, 0);
    const completedRuns = runs.filter((r) => {
      const status = (r.status || '').toLowerCase().trim();
      const message = (r.error_message || '').toLowerCase().trim();
      const isTargetMetAutoCompleted = (status === 'cancelled' || status === 'canceled') && isTargetCompleteCancelMessage(message);
      return r.status === 'completed' || isTargetMetAutoCompleted;
    }).length;
    const pendingRuns = runs.filter(r => r.status === 'pending').length;
    const startedRuns = runs.filter(r => r.status === 'started').length;

    // Selected-curve plan: cumulative scheduled quantity of every run, as % of each type's total.
    const plannedTotals: Record<string, number> = {};
    runs.forEach(r => { plannedTotals[r.engagement_type] = (plannedTotals[r.engagement_type] || 0) + (r.quantity_to_send || 0); });
    const planCum: Record<string, number> = {};
    const planPoints = [...runs].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)).map(r => {
      planCum[r.engagement_type] = (planCum[r.engagement_type] || 0) + (r.quantity_to_send || 0);
      const ts = Date.parse(r.scheduled_at);
      const pt: Record<string, any> = { timestamp: ts, displayTime: format(new Date(ts), 'MMM d, HH:mm') };
      activeTypes.forEach(t => { pt[`plan_${t}`] = plannedTotals[t] ? (100 * (planCum[t] || 0)) / plannedTotals[t] : 0; });
      return pt;
    });
    const merged: Record<string, any>[] = [];
    let lastDel: Record<string, number> = Object.fromEntries(activeTypes.map(t => [t, 0]));
    let lastPlan: Record<string, number> = Object.fromEntries(activeTypes.map(t => [`plan_${t}`, 0]));
    const events = [
      ...chartData.map(d => ({ ts: d.timestamp as number, d, kind: 'del' as const })),
      ...planPoints.map(d => ({ ts: d.timestamp as number, d, kind: 'plan' as const })),
      { ts: Date.parse([...runs].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))[0].scheduled_at) - 60000, d: {}, kind: 'zero' as const },
    ].filter(e => Number.isFinite(e.ts)).sort((a, b) => a.ts - b.ts);
    const now = Date.now();
    for (const e of events) {
      if (e.kind === 'del') activeTypes.forEach(t => { lastDel[t] = Number(e.d[t] || 0); });
      if (e.kind === 'plan') activeTypes.forEach(t => { lastPlan[`plan_${t}`] = e.d[`plan_${t}`]; });
      const pt: Record<string, any> = { timestamp: e.ts, displayTime: format(new Date(e.ts), 'MMM d, HH:mm'), ...lastPlan };
      if (e.ts <= now || e.kind === 'del') activeTypes.forEach(t => {
        pt[t] = lastDel[t];
        pt[`pct_${t}`] = plannedTotals[t] ? (100 * lastDel[t]) / plannedTotals[t] : 0;
      });
      merged.push(pt);
    }

    return {
      chartData: merged,
      stats: { totalScheduled, totalDelivered, completedRuns, pendingRuns, startedRuns, totalRuns: runs.length },
      activeTypes,
    };
  }, [runs, perType]);

  if (chartData.length <= 1) {
    return null;
  }

  // Calculate progress percentage
  const progressPercent = stats ? Math.round((stats.totalDelivered / stats.totalScheduled) * 100) : 0;

  return (
    <Card className="border-2 border-border bg-gradient-to-br from-background to-secondary/20 overflow-hidden">
      <CardHeader className="pb-1 p-3 sm:p-4">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="text-foreground">Delivery Progress Chart</span>
              <p className="text-xs text-muted-foreground font-normal mt-0.5">
                Real-time • Updates with run edits
              </p>
            </div>
          </div>
          <Badge variant="outline" className="font-mono text-sm border-primary text-primary">
            {progressPercent}% Complete
          </Badge>
        </CardTitle>

        {/* Stats Row */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Badge className="bg-primary text-primary-foreground font-bold gap-1">
            <TrendingUp className="h-3 w-3" />
            {stats?.totalDelivered.toLocaleString()} / {stats?.totalScheduled.toLocaleString()}
          </Badge>
          <Badge variant="outline" className="border-border text-foreground gap-1">
            <CheckCircle2 className="h-3 w-3" />
            {stats?.completedRuns} / {stats?.totalRuns} runs
          </Badge>
          <Badge variant="outline" className="border-border text-foreground gap-1">
            <Clock className="h-3 w-3" />
            {stats?.pendingRuns} pending
          </Badge>
        </div>

        {/* Per-type breakdown badges - DYNAMIC based on actual services */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[...perType].sort((a, b) => rank(a.type) - rank(b.type)).map(({ type, delivered, scheduled }) => {
            const config = ENGAGEMENT_CONFIG[type as EngagementType];
            const percent = scheduled > 0 ? Math.round((delivered / scheduled) * 100) : 0;
            const color = TYPE_COLORS[type] || '#888';
            return (
              <div 
                key={type}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-secondary/50 border border-border"
              >
                <div 
                  className="w-2 h-2 rounded-full" 
                  style={{ backgroundColor: color }}
                />
                
                <span className="text-xs text-muted-foreground">{config?.label || type}</span>
                <span className="text-xs font-bold text-foreground">
                  {delivered.toLocaleString()}/{scheduled.toLocaleString()}
                </span>
                <span className="text-[10px] text-muted-foreground">({percent}%)</span>
              </div>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-2 sm:p-3">
        <ProgressLines chartData={chartData} types={activeTypes} height="h-[300px] w-full" />
      </CardContent>
    </Card>
  );
}

const HIGHLIGHT = new Set(["views", "likes", "comments"]);
const ORDER = ["views", "likes", "comments", "saves", "shares", "reposts"];
const rank = (t: string) => { const i = ORDER.indexOf(t); return i < 0 ? 99 : i; };
const DASH: Record<string, string | undefined> = { saves: "7 3", shares: "3 3", reposts: "10 3 2 3" };

/** One combined live chart: every engagement as % of its own total, solid = delivered, faint dashed = selected curve plan. */
function ProgressLines({ chartData, types }: { chartData: Record<string, any>[]; types: string[]; height?: string }) {
  const sorted = [...types].sort((a, b) => rank(a) - rank(b));
  const label = (t: string) => ENGAGEMENT_CONFIG[t as EngagementType]?.label || t;
  return (
    <div>
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} vertical={false} />
            <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} minTickGap={32} tickFormatter={(v) => format(new Date(Number(v)), "HH:mm")} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke="hsl(var(--muted-foreground))" fontSize={9} width={34} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload;
                return (
                  <div className="bg-background/95 border border-border rounded-md px-2 py-1.5 shadow-lg text-xs space-y-0.5">
                    <div className="text-muted-foreground font-mono">{p?.displayTime}</div>
                    {sorted.map((t) => (
                      <div key={t} className="flex gap-2 items-center">
                        <span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[t] || "#888" }} />
                        <span className="font-semibold" style={{ color: TYPE_COLORS[t] || "#888" }}>{label(t)}</span>
                        <span className="ml-auto font-bold text-foreground">{p?.[t] !== undefined ? Number(p[t]).toLocaleString() : "—"}</span>
                        <span className="text-muted-foreground">plan {Math.round(Number(p?.[`plan_${t}`] ?? 0))}%</span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {sorted.map((t) => (
              <Area key={`plan-${t}`} type="monotone" dataKey={`plan_${t}`} stroke={TYPE_COLORS[t] || "#888"} strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="2 4" fill="none" dot={false} activeDot={false} isAnimationActive={false} />
            ))}
            {[...sorted].reverse().map((t) => {
              const c = TYPE_COLORS[t] || "#888";
              const strong = HIGHLIGHT.has(t);
              return (
                <Area key={t} type="monotone" dataKey={`pct_${t}`} stroke={c} strokeWidth={t === "views" ? 4 : strong ? 3.2 : 2.2} strokeDasharray={DASH[t]} fill={c} fillOpacity={t === "views" ? 0.12 : 0.04} dot={false} activeDot={{ r: 4, stroke: c, fill: "hsl(var(--background))", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 text-[11px]">
        {sorted.map((t) => (
          <span key={t} className="flex items-center gap-1.5 font-semibold" style={{ color: TYPE_COLORS[t] || "#888" }}>
            <span className="inline-block w-5 rounded" style={{ height: HIGHLIGHT.has(t) ? 4 : 2, background: TYPE_COLORS[t] || "#888" }} />
            {label(t)} {Number([...chartData].reverse().find((d) => d[t] !== undefined)?.[t] ?? 0).toLocaleString()}
          </span>
        ))}
        <span className="text-muted-foreground">· · · selected curve plan</span>
      </div>
    </div>
  );
}
