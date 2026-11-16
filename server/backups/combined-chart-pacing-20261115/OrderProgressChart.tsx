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

    return {
      chartData,
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
const k = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K` : String(value);

/** Line-by-line: one compact chart row per engagement, Views first, each on its own scale. */
function ProgressLines({ chartData, types }: { chartData: Record<string, any>[]; types: string[]; height?: string }) {
  const sorted = [...types].sort((a, b) => rank(a) - rank(b));
  return (
    <div className="divide-y divide-border">
      {sorted.map((type, i) => {
        const color = TYPE_COLORS[type] || "#888";
        const cfg = ENGAGEMENT_CONFIG[type as EngagementType];
        const last = Number(chartData[chartData.length - 1]?.[type] ?? 0);
        const strong = HIGHLIGHT.has(type);
        const isLast = i === sorted.length - 1;
        return (
          <div key={type} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2 py-1">
            <div className="min-w-0 border-l-4 pl-2" style={{ borderColor: color }}>
              <div className="text-[11px] font-bold uppercase tracking-wide truncate" style={{ color }}>{cfg?.emoji} {cfg?.label || type}</div>
              <div className="text-sm font-extrabold text-foreground">{last.toLocaleString()}</div>
            </div>
            <div className={strong ? "h-[78px]" : "h-[62px]"}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`opc-${type}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} vertical={false} />
                  <XAxis dataKey="time" hide={!isLast} stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} minTickGap={28} height={isLast ? 16 : 0} />
                  <YAxis stroke={color} fontSize={9} width={36} tickLine={false} axisLine={false} tickCount={3} tickFormatter={k} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload;
                      return (
                        <div className="bg-background/95 border border-border rounded-md px-2 py-1 shadow-lg text-xs">
                          <span className="text-muted-foreground font-mono mr-2">{p?.displayTime}</span>
                          <span className="font-bold" style={{ color }}>{cfg?.label || type}: {Number(p?.[type] ?? 0).toLocaleString()}</span>
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey={type} stroke={color} strokeWidth={strong ? 3 : 2.2} fill={`url(#opc-${type})`} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
