import { istClock } from "@/lib/run-live-count";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { ENGAGEMENT_CONFIG, EngagementType } from "@/lib/engagement-types";
import { buildDeliveryProgress, type ProgressRun, type ProgressPoint } from "@/lib/delivery-progress";
import { format } from "date-fns";
import { Activity, CheckCircle2, Clock } from "lucide-react";

interface OrderProgressChartProps {
  runs: ProgressRun[];
  perType: { type: string; target: number; delivered: number; scheduled: number }[];
}
const color = (t: string) => `var(--bb-chart-${t}, var(--bb-chart-other))`;
const label = (t: string) => ENGAGEMENT_CONFIG[t as EngagementType]?.label || t;
const DASH: Record<string, string | undefined> = { saves: "8 3", shares: "3 3", reposts: "10 3 2 3" };

export function OrderProgressChart({ runs, perType }: OrderProgressChartProps) {
  const now = Date.now();
  const data = useMemo(() => buildDeliveryProgress(runs, now), [runs, now]);
  if (!data.chartData.length) return null;
  const total = perType.reduce((sum, t) => sum + t.scheduled, 0);
  const delivered = Object.values(data.delivered).reduce((a, b) => a + b, 0);
  const first = data.types.filter(t => ["views", "likes", "comments"].includes(t));
  const rest = data.types.filter(t => !first.includes(t));
  return (
    <Card className="border-border overflow-hidden">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="flex flex-wrap gap-2 items-center justify-between text-base">
          <span className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Delivery Progress Chart</span>
          <Badge variant="outline" title="Time-weighted cumulative difference between the saved selected-curve schedule and provider-confirmed delivery. Snapshot estimate; not a botting or safety score.">
            Curve match {data.score === null ? "—" : `${data.score}/100`}
          </Badge>
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="secondary">{delivered.toLocaleString()} / {total.toLocaleString()}</Badge>
          <Badge variant="outline"><CheckCircle2 className="h-3 w-3 mr-1" />{runs.filter(r => r.status === "completed").length} / {runs.length} runs</Badge>
          <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />{runs.filter(r => r.status === "pending").length} pending</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {first.length > 0 && <ProgressLines chartData={data.chartData} types={first} scores={data.scores} delivered={data.delivered} now={now} title="Views · Likes · Comments" />}
        {rest.length > 0 && <ProgressLines chartData={data.chartData} types={rest} scores={data.scores} delivered={data.delivered} now={now} title="Saves · Shares · Reposts" />}
      </CardContent>
    </Card>
  );
}

function ProgressLines({ chartData, types, scores, delivered, now, title }: {
  chartData: ProgressPoint[]; types: string[]; scores: Record<string, number | null>;
  delivered: Record<string, number>; now: number; title: string;
}) {
  return <section className="min-w-0" aria-label={title}>
    <div className="flex flex-wrap gap-x-4 gap-y-1 items-center mb-1">
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      {types.map(t => <span key={t} className="bb-chart-label text-xs font-semibold" data-engagement={t}>
        <span className="bb-chart-key" />{label(t)} {Number(delivered[t] || 0).toLocaleString()}
        <span className="text-muted-foreground font-normal"> · {scores[t] === null ? "—" : `${scores[t]}/100`}</span>
      </span>)}
    </div>
    <div className="h-[220px] sm:h-[250px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin", "dataMax"]} stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={40} tickFormatter={v => istClock(Number(v))} />
          <YAxis domain={[0, (max: number) => Math.max(100, Math.ceil(max / 25) * 25)]} stroke="hsl(var(--muted-foreground))" fontSize={10} width={36} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
          <ReferenceLine x={now} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
          <Tooltip content={({ active, payload }) => {
            const point = payload?.[0]?.payload as ProgressPoint | undefined;
            if (!active || !point) return null;
            return <div className="bg-background border border-border rounded-md p-2 shadow-lg text-xs space-y-1">
              <div className="text-muted-foreground">{istClock(point.timestamp, true) + " IST"}</div>
              {types.map(t => <div key={t} className="bb-chart-label flex justify-between gap-3" data-engagement={t}>
                <strong>{label(t)}</strong>
                <span className="text-foreground">{point[t] === null ? "Not delivered yet" : Number(point[t]).toLocaleString()} · plan {Math.round(Number(point[`plan_${t}`]))}%</span>
              </div>)}
            </div>;
          }} />
          {types.map(t => <Line key={`plan-${t}`} dataKey={`plan_${t}`} type="stepAfter" stroke={color(t)} strokeWidth={1.8} strokeOpacity={0.55} strokeDasharray="2 5" dot={false} activeDot={false} isAnimationActive={false} />)}
          {types.map(t => <Line key={t} dataKey={`pct_${t}`} type="stepAfter" stroke={color(t)} strokeWidth={["views", "likes", "comments"].includes(t) ? 3.5 : 3} strokeDasharray={DASH[t]} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  </section>;
}
